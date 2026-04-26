import asyncio
import dataclasses
import hashlib
import json
import logging
import time
import os
from pathlib import Path
from typing import Any, List, Optional, Dict

import aiohttp
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from solders.pubkey import Pubkey
from solders.signature import Signature

from models.risk_model import AgentRiskMonitor
from models.detectors import ProofRecord, RiskScore, ChainStats
from models.score_engine import ReputationScoreEngine, ScoreBreakdown
from chain_reader import get_chain_reader
from chain_freezer import get_freezer
import db as _db

logger = logging.getLogger(__name__)
router = APIRouter()
risk_monitor = AgentRiskMonitor()
reputation_engine = ReputationScoreEngine()

# In-memory cache backed by SQLite — populated on startup from DB
reputation_cache: Dict[str, ScoreBreakdown] = {}

# score history in-memory (backed by DB)
score_history_store: Dict[str, List[Dict[str, Any]]] = {}

# leaderboard response cache: "all" → (entries, expires_at)
_leaderboard_cache: Dict[str, Any] = {}
_LEADERBOARD_TTL = 600        # seconds between full re-scores
_LEADERBOARD_STALE_TTL = 86400  # serve DB snapshot up to 24h if re-score fails
_LEADERBOARD_BATCH_SIZE = 50  # concurrent RPC calls per batch

# 内存存储：仅用于实时展示，不参与风险评分
agent_proofs: Dict[str, List[ProofRecord]] = {}
risk_cache: Dict[str, RiskScore] = {}
freeze_queue: List[str] = []

# agents list cache
_agents_cache: Dict[str, Any] = {}
_AGENTS_TTL = 30  # seconds

# insurance policies backed by DB (in-memory list rebuilt on startup)
_insurance_policies: List[Dict[str, Any]] = []

# ── Manifest store: agent_pubkey → manifest dict ──────────────────────────────
# Persisted to disk so scraped agents survive service restarts.
_MANIFEST_PATH = Path(os.getenv("MANIFEST_STORE_PATH", "data/manifests.json"))


def _load_manifest_store() -> Dict[str, Dict[str, Any]]:
    try:
        _MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        if _MANIFEST_PATH.exists():
            with open(_MANIFEST_PATH) as f:
                data = json.load(f)
            logger.info(f"Loaded {len(data)} manifests from {_MANIFEST_PATH}")
            return data
    except Exception as e:
        logger.warning(f"Could not load manifest store: {e}")
    return {}


def _save_manifest_store(store: Dict[str, Dict[str, Any]]) -> None:
    try:
        _MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_MANIFEST_PATH, "w") as f:
            json.dump(store, f)
    except Exception as e:
        logger.warning(f"Could not save manifest store: {e}")


manifest_store: Dict[str, Dict[str, Any]] = _load_manifest_store()


# ── Signature verification ────────────────────────────────────────────────────

def _proof_message(agent_id: str, task_id: str, output_hash: str) -> bytes:
    """构造需要 Agent 私钥签名的消息（确定性，不含时间戳）"""
    return hashlib.sha256(f"{agent_id}:{task_id}:{output_hash}".encode()).digest()


def _verify_agent_signature(agent_id: str, task_id: str, output_hash: str, signature_b58: str) -> bool:
    try:
        pubkey = Pubkey.from_string(agent_id)
        sig = Signature.from_string(signature_b58)
        message = _proof_message(agent_id, task_id, output_hash)
        # solders Signature.verify(pubkey, message) -> bool
        return sig.verify(pubkey, message)
    except Exception as e:
        logger.debug(f"Signature verification failed: {e}")
        return False


# ── Request / Response schemas ────────────────────────────────────────────────

class ProofSubmitRequest(BaseModel):
    agent_id: str
    task_id: str
    success: bool
    output_hash: str
    input_hash: str
    signature: str          # ed25519 signature by agent keypair (base58)
    ata_created: int = 0
    sol_delta: float = 0.0
    slot: int = 0


class AnalyzeRequest(BaseModel):
    agent_id: str


class RiskScoreResponse(BaseModel):
    agent_id: str
    score: float
    level: str
    reasons: List[str]
    should_freeze: bool
    breakdown: Dict[str, float]
    timestamp: float
    data_source: str = "chain"


# ── Helper：仅从链上读取数据（风险评分的唯一可信来源）────────────────────────

async def _build_chain_data(
    agent_id: str,
) -> tuple[List[ProofRecord], str, Optional[ChainStats]]:
    """
    从链上读取 AgentRecord + TaskProof，作为风险评分的唯一数据源。
    链上数据由 Solana 程序验证，无法被第三方伪造。
    返回 (chain_proofs, data_source, chain_stats)。
    """
    reader = get_chain_reader()

    agent_record, chain_proofs = await asyncio.gather(
        reader.fetch_agent_record(agent_id),
        reader.fetch_task_proofs(agent_id),
    )

    chain_records = reader.build_proof_records(agent_record, chain_proofs)
    source = "chain" if chain_records else "empty"
    logger.info(f"[{agent_id[:8]}] chain={len(chain_records)}")

    chain_stats: Optional[ChainStats] = None
    if agent_record is not None:
        chain_stats = ChainStats(
            tasks_completed=agent_record.tasks_completed,
            tasks_failed=agent_record.tasks_failed,
            reputation_score=agent_record.reputation_score,
            is_frozen=agent_record.is_frozen,
            staked_lamports=agent_record.staked_lamports,
        )

    return chain_records, source, chain_stats


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/api/v1/proof_event")
async def receive_proof_event(
    req: ProofSubmitRequest,
    background_tasks: BackgroundTasks,
):
    """
    接收 Agent 推送的实时任务事件（仅用于实时展示，不参与风险评分）。
    必须附带 Agent 私钥对 sha256(agent_id:task_id:output_hash) 的签名，
    防止第三方伪造其他 Agent 的事件。
    """
    if not _verify_agent_signature(req.agent_id, req.task_id, req.output_hash, req.signature):
        raise HTTPException(status_code=401, detail="Invalid agent signature")

    proof = ProofRecord(
        task_id=req.task_id,
        success=req.success,
        output_hash=req.output_hash,
        input_hash=req.input_hash,
        submitted_at=time.time(),
        ata_created=req.ata_created,
        sol_delta=req.sol_delta,
        slot=req.slot,
    )
    bucket = agent_proofs.setdefault(req.agent_id, [])
    bucket.append(proof)
    agent_proofs[req.agent_id] = bucket[-100:]
    _agents_cache.clear()  # invalidate so next /agents call is fresh

    # 后台刷新风险评分（仅基于链上数据）
    background_tasks.add_task(analyze_and_maybe_freeze, req.agent_id)
    return {"status": "received", "agent_id": req.agent_id}


@router.post("/api/v1/analyze")
async def analyze_agent(req: AnalyzeRequest) -> RiskScoreResponse:
    """分析指定 Agent 风险评分（仅基于链上数据，防止评分被伪造）"""
    proofs, source, chain_stats = await _build_chain_data(req.agent_id)
    score = risk_monitor.analyze(req.agent_id, proofs, chain_stats)
    breakdown = risk_monitor.get_score_breakdown(proofs, chain_stats)
    risk_cache[req.agent_id] = score

    return RiskScoreResponse(
        agent_id=score.agent_id,
        score=score.score,
        level=score.level,
        reasons=score.reasons,
        should_freeze=score.should_freeze,
        breakdown=breakdown,
        timestamp=score.timestamp,
        data_source=source,
    )


@router.get("/api/v1/risk/{agent_id}")
async def get_risk_score(agent_id: str) -> RiskScoreResponse:
    """获取风险评分（仅基于链上数据）"""
    proofs, source, chain_stats = await _build_chain_data(agent_id)
    score = risk_monitor.analyze(agent_id, proofs, chain_stats)
    breakdown = risk_monitor.get_score_breakdown(proofs, chain_stats)
    risk_cache[agent_id] = score

    return RiskScoreResponse(
        agent_id=score.agent_id,
        score=score.score,
        level=score.level,
        reasons=score.reasons,
        should_freeze=score.should_freeze,
        breakdown=breakdown,
        timestamp=score.timestamp,
        data_source=source,
    )


@router.get("/api/v1/alerts")
async def get_alerts():
    """获取所有高风险告警"""
    alerts = [
        {
            "agent_id": agent_id,
            "score": score.score,
            "level": score.level,
            "reasons": score.reasons,
            "timestamp": score.timestamp,
        }
        for agent_id, score in risk_cache.items()
        if score.level in ("warning", "danger")
    ]
    return {"alerts": alerts, "count": len(alerts)}


@router.get("/api/v1/agents")
async def list_agents():
    """列出所有被监控的 Agent（链上 + manifest 注册）"""
    import time as _time
    cached = _agents_cache.get("all")
    if cached and _time.time() < cached["expires_at"]:
        return cached["data"]

    reader = get_chain_reader()
    chain_agents = await reader.fetch_all_agents()
    chain_ids = {a.agent_pubkey for a in chain_agents}

    # Union: on-chain + manifest-only + any that submitted proof events
    all_ids = chain_ids | set(manifest_store.keys()) | set(agent_proofs.keys())

    agents = []
    for agent_id in all_ids:
        score = risk_cache.get(agent_id)
        manifest = manifest_store.get(agent_id)
        agents.append({
            "agent_id": agent_id,
            "proof_count": len(agent_proofs.get(agent_id, [])),
            "risk_score": score.score if score else 0,
            "risk_level": score.level if score else "safe",
            "name": manifest.get("name") if manifest else None,
            "framework": manifest.get("framework") if manifest else None,
            "external_url": manifest.get("external_url") if manifest else None,
            "owner_wallet": manifest.get("owner_wallet") if manifest else None,
            "created_at": manifest.get("created_at") if manifest else None,
            "on_chain": agent_id in chain_ids,
        })
    result = {"agents": agents, "total": len(agents)}
    _agents_cache["all"] = {"data": result, "expires_at": _time.time() + _AGENTS_TTL}
    return result


# ── Manifest routes ──────────────────────────────────────────────────────────

class CapabilityConstraint(BaseModel):
    task_type: str
    description: str = ""


class ManifestSaveRequest(BaseModel):
    agent_pubkey: str
    name: str
    description: str          # required — used for intent recognition
    capabilities: List[CapabilityConstraint]
    version: str = "1.0"
    framework: str = "unknown"   # elizaos | agent_kit | goat | unknown
    external_url: str = ""       # agent's official use link
    owner_wallet: str = ""       # connected wallet that paid the registration fee


@router.post("/manifest")
async def save_manifest(req: ManifestSaveRequest) -> Dict[str, Any]:
    """注册时保存 Agent 能力清单（意图引擎读取此数据进行验证）"""
    entry = req.model_dump()
    entry["created_at"] = time.time()  # server-side timestamp
    manifest_store[req.agent_pubkey] = entry
    _save_manifest_store(manifest_store)
    # Invalidate leaderboard cache so new agent appears immediately
    _leaderboard_cache.pop("all", None)
    logger.info(f"Manifest saved for {req.agent_pubkey[:8]}: {[c.task_type for c in req.capabilities]}")
    return {"status": "saved", "agent_pubkey": req.agent_pubkey}


@router.get("/manifest/pubkey/{agent_pubkey}")
async def get_manifest(agent_pubkey: str) -> Dict[str, Any]:
    """意图引擎查询 Agent manifest"""
    manifest = manifest_store.get(agent_pubkey)
    if not manifest:
        raise HTTPException(status_code=404, detail="Manifest not found")
    return {"manifest": manifest}


# ── Leaderboard / Reputation Score API ───────────────────────────────────────

class ReputationScoreResponse(BaseModel):
    agent_id: str
    total_score: int
    grade: str
    behavior_safety: int
    completion_rate: int
    fund_risk: int
    compliance: int
    activity_decay: int
    premium_multiplier: Optional[float]
    has_manifest: bool
    name: Optional[str] = None
    description: Optional[str] = None
    framework: Optional[str] = None
    external_url: Optional[str] = None
    owner_wallet: Optional[str] = None
    created_at: Optional[float] = None
    # tx stats
    tx_count: int = 0
    anomaly_count: int = 0
    max_single_sol: float = 0.0


async def _compute_reputation(agent_id: str) -> ReputationScoreResponse:
    """Compute or return cached reputation score for an agent."""
    proofs, _, chain_stats = await _build_chain_data(agent_id)
    manifest = manifest_store.get(agent_id)
    has_manifest = manifest is not None
    is_registered = True  # if we have chain data, it's registered

    bd = reputation_engine.compute(
        proofs=proofs,
        chain_stats=chain_stats,
        is_sdk_registered=is_registered,
        has_manifest=has_manifest,
    )
    reputation_cache[agent_id] = bd

    # Persist score to DB
    await _db.save_reputation(agent_id, dataclasses.asdict(bd))
    await _db.append_score_history(agent_id, bd.total)

    # Keep in-memory history too (last 90)
    import time as _time
    history = score_history_store.setdefault(agent_id, [])
    history.append({"total_score": bd.total, "scored_at": _time.time()})
    score_history_store[agent_id] = history[-90:]

    # Compute tx stats from proofs
    tx_count = len(proofs)
    anomaly_count = sum(1 for p in proofs if not p.success)
    max_single_sol = max((abs(getattr(p, "sol_delta", 0.0)) for p in proofs), default=0.0)

    return ReputationScoreResponse(
        agent_id=agent_id,
        total_score=bd.total,
        grade=bd.grade,
        behavior_safety=bd.behavior_safety,
        completion_rate=bd.completion_rate,
        fund_risk=bd.fund_risk,
        compliance=bd.compliance,
        activity_decay=bd.activity_decay,
        premium_multiplier=bd.premium_multiplier,
        has_manifest=has_manifest,
        name=manifest.get("name") if manifest else None,
        description=manifest.get("description") if manifest else None,
        framework=manifest.get("framework") if manifest else None,
        external_url=manifest.get("external_url") if manifest else None,
        owner_wallet=manifest.get("owner_wallet") if manifest else None,
        created_at=manifest.get("created_at") if manifest else None,
        tx_count=tx_count,
        anomaly_count=anomaly_count,
        max_single_sol=round(max_single_sol, 4),
    )


@router.get("/api/v1/reputation/{agent_id}")
async def get_reputation_score(agent_id: str) -> ReputationScoreResponse:
    """Get positive reputation score (0-100) for a registered agent."""
    return await _compute_reputation(agent_id)


@router.get("/api/v1/reputation/{agent_id}/history")
async def get_score_history(agent_id: str) -> Dict[str, Any]:
    """Return 90-day score history for trend chart."""
    # Try in-memory first, fall back to DB
    history = score_history_store.get(agent_id)
    if not history:
        history = await _db.load_score_history(agent_id)
        if history:
            score_history_store[agent_id] = history
    return {"agent_id": agent_id, "history": history or []}


def _score_from_chain_record(
    chain_record: "ChainAgentRecord",  # type: ignore[name-defined]
    manifest: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build a leaderboard entry directly from an already-fetched ChainAgentRecord.

    Avoids the per-agent RPC round-trips that make bulk scoring prohibitively slow.
    """
    reader = get_chain_reader()
    # Build proof records from chain record's summary stats (no extra RPC)
    chain_stats = ChainStats(
        tasks_completed=chain_record.tasks_completed,
        tasks_failed=chain_record.tasks_failed,
        reputation_score=chain_record.reputation_score,
        is_frozen=chain_record.is_frozen,
        staked_lamports=chain_record.staked_lamports,
    )
    # Synthesise proof list from summary (same as build_proof_records with empty proofs)
    proofs = reader.build_proof_records(chain_record, [])

    has_manifest = manifest is not None
    bd = reputation_engine.compute(
        proofs=proofs,
        chain_stats=chain_stats,
        is_sdk_registered=True,
        has_manifest=has_manifest,
    )
    reputation_cache[chain_record.agent_pubkey] = bd

    return {
        "agent_id": chain_record.agent_pubkey,
        "total_score": bd.total,
        "grade": bd.grade,
        "behavior_safety": bd.behavior_safety,
        "completion_rate": bd.completion_rate,
        "fund_risk": bd.fund_risk,
        "compliance": bd.compliance,
        "activity_decay": bd.activity_decay,
        "premium_multiplier": bd.premium_multiplier,
        "has_manifest": has_manifest,
        "name": manifest.get("name") if manifest else None,
        "description": manifest.get("description") if manifest else None,
        "framework": manifest.get("framework") if manifest else None,
        "external_url": manifest.get("external_url") if manifest else None,
        "owner_wallet": manifest.get("owner_wallet") if manifest else None,
        "created_at": manifest.get("created_at") if manifest else None,
        "tx_count": chain_record.tasks_completed + chain_record.tasks_failed,
        "anomaly_count": chain_record.tasks_failed,
        "max_single_sol": 0.0,
    }


async def _build_leaderboard_entries() -> List[Dict[str, Any]]:
    """Build leaderboard using a single bulk fetch — no per-agent RPC calls."""
    reader = get_chain_reader()
    chain_agents = await reader.fetch_all_agents()
    chain_agent_ids = {a.agent_pubkey for a in chain_agents}
    chain_map = {a.agent_pubkey: a for a in chain_agents}

    entries: List[Dict[str, Any]] = []

    # Score all on-chain agents using already-fetched data (zero extra RPCs)
    for record in chain_agents:
        try:
            manifest = manifest_store.get(record.agent_pubkey)
            entry = _score_from_chain_record(record, manifest)
            entries.append(entry)
        except Exception as exc:
            logger.warning(f"Failed to score {record.agent_pubkey[:8]}: {exc}")

    # Manifest-only or reputation-cache-only agents that are NOT on-chain
    manifest_only_ids = (set(manifest_store.keys()) | set(reputation_cache.keys())) - chain_agent_ids
    for aid in manifest_only_ids:
        cached_bd = reputation_cache.get(aid)
        manifest = manifest_store.get(aid)
        # Compute a baseline score if not yet cached (no RPC needed for manifest-only agents)
        if not cached_bd:
            cached_bd = reputation_engine.compute(
                proofs=[],
                chain_stats=None,
                is_sdk_registered=False,
                has_manifest=manifest is not None,
            )
            reputation_cache[aid] = cached_bd
        entry = {
            "agent_id": aid,
            "total_score": cached_bd.total,
            "grade": cached_bd.grade,
            "behavior_safety": cached_bd.behavior_safety,
            "completion_rate": cached_bd.completion_rate,
            "fund_risk": cached_bd.fund_risk,
            "compliance": cached_bd.compliance,
            "activity_decay": cached_bd.activity_decay,
            "premium_multiplier": cached_bd.premium_multiplier,
            "has_manifest": manifest is not None,
            "name": manifest.get("name") if manifest else None,
            "description": manifest.get("description") if manifest else None,
            "framework": manifest.get("framework") if manifest else None,
            "external_url": manifest.get("external_url") if manifest else None,
            "owner_wallet": manifest.get("owner_wallet") if manifest else None,
            "created_at": manifest.get("created_at") if manifest else None,
            "tx_count": 0,
            "anomaly_count": 0,
            "max_single_sol": 0.0,
        }
        entries.append(entry)

    entries.sort(key=lambda e: e.get("total_score", 0), reverse=True)
    logger.info(f"Built leaderboard: {len(entries)} entries")
    return entries


async def _warm_leaderboard_cache() -> None:
    """Background task: pre-compute leaderboard cache on startup."""
    import time as _time
    try:
        logger.info("Warming leaderboard cache...")
        entries = await _build_leaderboard_entries()
        _leaderboard_cache["all"] = {"entries": entries, "expires_at": _time.time() + _LEADERBOARD_TTL}
        await _db.save_leaderboard_snapshot(entries)
        logger.info(f"Leaderboard cache warmed: {len(entries)} agents")
    except Exception as e:
        logger.error(f"Leaderboard cache warm-up failed: {e}")
        # Fall back to DB snapshot so the endpoint is still usable
        snapshot = await _db.load_leaderboard_snapshot()
        if snapshot:
            logger.info(f"Loaded {len(snapshot)} leaderboard entries from DB snapshot")
            _leaderboard_cache["all"] = {
                "entries": snapshot,
                "expires_at": _time.time() + _LEADERBOARD_TTL,
            }


@router.on_event("startup")
async def startup_warm_cache() -> None:
    await _db.init_db()

    # Restore reputation cache from DB
    stored = await _db.load_all_reputations()
    for agent_id, d in stored.items():
        try:
            reputation_cache[agent_id] = ScoreBreakdown(**d)
        except Exception:
            pass
    logger.info(f"Restored {len(stored)} reputation scores from DB")

    # Restore insurance policies from DB
    global _insurance_policies
    _insurance_policies = await _db.load_policies()
    logger.info(f"Restored {len(_insurance_policies)} insurance policies from DB")

    # Serve stale DB snapshot immediately, then refresh in background
    snapshot = await _db.load_leaderboard_snapshot()
    age = await _db.load_leaderboard_snapshot_age()
    if snapshot and age is not None and age < _LEADERBOARD_STALE_TTL:
        import time as _time
        _leaderboard_cache["all"] = {
            "entries": snapshot,
            "expires_at": _time.time() + _LEADERBOARD_TTL,
        }
        logger.info(f"Loaded {len(snapshot)} leaderboard entries from DB (age {age:.0f}s)")

    asyncio.create_task(_warm_leaderboard_cache())


@router.get("/api/v1/leaderboard")
async def get_leaderboard(
    grade: Optional[str] = None,
    framework: Optional[str] = None,
    search: Optional[str] = None,
    min_score: Optional[int] = None,
    max_score: Optional[int] = None,
    owner_wallet: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Public agent reputation leaderboard.
    All agents are scored in parallel batches and cached for 300 seconds.
    All filters (grade, framework, search, score range, owner_wallet) are applied post-cache.
    """
    import time as _time
    cached = _leaderboard_cache.get("all")
    if cached and _time.time() < cached["expires_at"]:
        entries = cached["entries"]
    else:
        try:
            entries = await _build_leaderboard_entries()
            await _db.save_leaderboard_snapshot(entries)
        except Exception as e:
            logger.error(f"Leaderboard rebuild failed: {e}")
            entries = await _db.load_leaderboard_snapshot()
        _leaderboard_cache["all"] = {"entries": entries, "expires_at": _time.time() + _LEADERBOARD_TTL}

    # Apply all filters post-cache
    filtered = entries
    if grade:
        filtered = [e for e in filtered if e.get("grade") == grade]
    if framework:
        filtered = [e for e in filtered if e.get("framework") == framework]
    if search:
        q = search.lower()
        filtered = [
            e for e in filtered
            if q in e.get("agent_id", "").lower() or q in (e.get("name") or "").lower()
        ]
    if min_score is not None:
        filtered = [e for e in filtered if e.get("total_score", 0) >= min_score]
    if max_score is not None:
        filtered = [e for e in filtered if e.get("total_score", 0) <= max_score]
    if owner_wallet:
        filtered = [e for e in filtered if e.get("owner_wallet") == owner_wallet]

    total = len(filtered)
    return {"agents": filtered[offset: offset + limit], "total": total, "offset": offset, "limit": limit}


# insurance policies are now persisted to DB; _insurance_policies is an in-memory
# mirror rebuilt on startup. The variable below is kept for reference only.
_insurance_policies: List[Dict[str, Any]] = []


class InsuranceBuyRequest(BaseModel):
    buyer_wallet: str
    agent_wallet: str
    policy_type: int   # 0=fund, 1=execution, 2=bundle
    coverage_sol: float
    duration_days: int = 30
    tx_sig: str = ""   # SOL transfer signature from buyer → treasury


# Treasury wallet that receives insurance premiums
TREASURY_WALLET = os.getenv("TREASURY_WALLET", "71MW7PhDSehYup5GDbvceZeyuyYBYuEUvk2Sfc12cMM2")
_SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
_LAMPORTS_PER_SOL = 1_000_000_000


async def _verify_premium_transfer(tx_sig: str, buyer_wallet: str, expected_sol: float) -> None:
    """Verify on-chain that buyer sent at least expected_sol to TREASURY_WALLET."""
    url = _SOLANA_RPC_URL
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getTransaction",
        "params": [tx_sig, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}],
    }
    ssl_ctx = False  # devnet — skip SSL verification (avoids local cert store issues)
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(connector=connector) as session:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            data = await resp.json()

    result = data.get("result")
    if not result:
        raise HTTPException(status_code=400, detail=f"Transaction {tx_sig[:16]}… not found or not confirmed yet. Please wait a moment and retry.")

    if result.get("meta", {}).get("err"):
        raise HTTPException(status_code=400, detail="Transaction failed on-chain.")

    # Walk pre/post balances to find treasury credit
    account_keys = result["transaction"]["message"].get("accountKeys", [])
    pre_balances  = result["meta"]["preBalances"]
    post_balances = result["meta"]["postBalances"]

    treasury_idx  = None
    buyer_idx     = None
    for i, key in enumerate(account_keys):
        k = key if isinstance(key, str) else key.get("pubkey", "")
        if k == TREASURY_WALLET:
            treasury_idx = i
        if k == buyer_wallet:
            buyer_idx = i

    if treasury_idx is None:
        raise HTTPException(status_code=400, detail="Transaction does not send SOL to the AgentProof treasury.")
    if buyer_idx is None:
        raise HTTPException(status_code=400, detail="Transaction sender does not match connected wallet.")

    credited_lamports = post_balances[treasury_idx] - pre_balances[treasury_idx]
    expected_lamports = int(expected_sol * _LAMPORTS_PER_SOL)
    if credited_lamports < expected_lamports - 1000:  # 1000 lamport tolerance for rounding
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient payment: expected {expected_sol} SOL, got {credited_lamports / _LAMPORTS_PER_SOL:.6f} SOL.",
        )


class InsuranceClaimRequest(BaseModel):
    policy_id: int
    buyer_wallet: str
    failed_tx_sig: str
    description: str = ""


class TxPreviewRequest(BaseModel):
    tx_sig: str
    agent_wallet: str
    buyer_wallet: str


async def _fetch_tx(tx_sig: str) -> dict:
    """Fetch a confirmed Solana transaction via JSON-RPC."""
    payload = {
        "jsonrpc": "2.0", "id": 1,
        "method": "getTransaction",
        "params": [tx_sig, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}],
    }
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        async with session.post(_SOLANA_RPC_URL, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            return await resp.json()


def _balance_delta(result: dict, wallet: str) -> float:
    """Return SOL balance change for wallet (positive = received, negative = sent)."""
    keys = result["transaction"]["message"].get("accountKeys", [])
    pre  = result["meta"]["preBalances"]
    post = result["meta"]["postBalances"]
    for i, key in enumerate(keys):
        k = key if isinstance(key, str) else key.get("pubkey", "")
        if k == wallet:
            return (post[i] - pre[i]) / _LAMPORTS_PER_SOL
    return 0.0


@router.post("/api/v1/insurance/tx_preview")
async def tx_preview(req: TxPreviewRequest) -> Dict[str, Any]:
    """Look up a Solana tx and return SOL flow between agent and buyer."""
    data = await _fetch_tx(req.tx_sig)
    result = data.get("result")
    if not result:
        raise HTTPException(status_code=400, detail="Transaction not found or not confirmed yet.")
    if result.get("meta", {}).get("err"):
        raise HTTPException(status_code=400, detail="Transaction failed on-chain — no funds moved.")

    agent_delta = _balance_delta(result, req.agent_wallet)
    buyer_delta = _balance_delta(result, req.buyer_wallet)

    agent_out = round(max(agent_delta, 0.0), 6)   # SOL into agent wallet
    agent_in  = round(max(buyer_delta, 0.0), 6)   # SOL back to buyer
    net_loss  = round(max(agent_out - agent_in, 0.0), 6)

    return {"agentOut": agent_out, "agentIn": agent_in, "net": net_loss, "ok": net_loss > 0}


@router.post("/api/v1/insurance/buy")
async def buy_insurance(req: InsuranceBuyRequest) -> Dict[str, Any]:
    """Record insurance purchase after verifying on-chain SOL transfer to treasury."""
    cached = reputation_cache.get(req.agent_wallet)
    multiplier = cached.premium_multiplier if (cached and cached.premium_multiplier) else 1.0

    # Same formula as frontend InsuranceModal:
    # base_rates: fund=1%, execution=2%, bundle=(1%+2%)*0.8=2.4%
    # duration_factor: one-time=0.08, 7d=0.28, 30d=1.0, 90d=2.7
    BASE_RATES = {0: 0.01, 1: 0.02, 2: 0.024}
    DURATION_FACTORS = {0: 0.08, 7: 0.28, 30: 1.0, 90: 2.7}
    base_rate = BASE_RATES.get(req.policy_type, 0.01)
    duration_factor = DURATION_FACTORS.get(req.duration_days, 1.0)
    premium_sol = round(req.coverage_sol * base_rate * multiplier * duration_factor, 4)

    # Verify real SOL payment before creating policy
    if not req.tx_sig:
        raise HTTPException(status_code=400, detail="tx_sig is required — pay the premium first.")
    await _verify_premium_transfer(req.tx_sig, req.buyer_wallet, premium_sol)

    import time as _time
    policy: Dict[str, Any] = {
        "buyer_wallet": req.buyer_wallet,
        "agent_wallet": req.agent_wallet,
        "policy_type": req.policy_type,
        "coverage_sol": req.coverage_sol,
        "premium_sol": premium_sol,
        "multiplier": multiplier,
        "status": "active",
        "tx_sig": req.tx_sig,
        # one-time (duration_days=0) gets a 24h claim window; periodic uses full duration
        "expires_at": _time.time() + (86400 if req.duration_days == 0 else req.duration_days * 86400),
        "created_at": _time.time(),
        "one_time": req.duration_days == 0,
        "claimed_sol": 0.0,   # track cumulative payout for periodic policies
    }
    db_id = await _db.save_policy(policy)
    policy["id"] = db_id - 1

    _insurance_policies.append(policy)

    return {
        "policy_id": policy["id"],
        "premium_sol": premium_sol,
        "coverage_sol": req.coverage_sol,
        "multiplier": multiplier,
        "expires_days": req.duration_days,
        "status": "active",
    }


@router.get("/api/v1/insurance/policies/{buyer_wallet}")
async def list_policies(buyer_wallet: str) -> Dict[str, Any]:
    """List all insurance policies for a buyer wallet."""
    policies = await _db.load_policies(buyer_wallet)
    return {"policies": policies, "total": len(policies)}


@router.post("/api/v1/insurance/claim")
async def submit_claim(req: InsuranceClaimRequest) -> Dict[str, Any]:
    """Submit an insurance claim — loss is verified from the Solana ledger.

    One-time policies: single claim allowed, policy closes after.
    Periodic policies: multiple claims allowed within validity, total payout capped at coverage_sol.
    """
    all_policies = await _db.load_policies()
    matches = [p for p in all_policies if p["id"] == req.policy_id and p["buyer_wallet"] == req.buyer_wallet]
    if not matches:
        raise HTTPException(status_code=404, detail="Policy not found")
    policy = matches[0]
    if policy["status"] != "active":
        raise HTTPException(status_code=400, detail=f"Policy is already {policy['status']}")

    import time as _time
    if _time.time() > policy["expires_at"]:
        await _db.update_policy_status(req.policy_id, "expired")
        raise HTTPException(status_code=400, detail="Policy has expired")

    is_one_time    = policy.get("one_time", False) or (policy["expires_at"] - policy["created_at"]) < 90000
    coverage       = policy["coverage_sol"]
    claimed_so_far = policy.get("claimed_sol", 0.0)
    remaining      = round(coverage - claimed_so_far, 6)

    if remaining <= 0:
        await _db.update_policy_status(req.policy_id, "claimed")
        await _db.append_claim_record(req.policy_id, {
            "failed_tx_sig": req.failed_tx_sig,
            "net_loss_sol":  0.0,
            "payout_sol":    0.0,
            "loss_ratio":    0.0,
            "description":   "[Auto-rejected] Coverage exhausted",
            "claimed_at":    _time.time(),
        })
        raise HTTPException(status_code=400, detail="Coverage exhausted — all available payout has already been claimed.")

    # Reject duplicate tx signatures across all policies
    for p in all_policies:
        for c in p.get("claims", []):
            if c.get("failed_tx_sig") == req.failed_tx_sig:
                raise HTTPException(
                    status_code=400,
                    detail="This transaction has already been submitted in a previous claim and cannot be used again.",
                )

    # Verify failed tx on-chain and compute actual loss from ledger
    data = await _fetch_tx(req.failed_tx_sig)
    result = data.get("result")
    if not result:
        raise HTTPException(status_code=400, detail="Failed transaction not found on-chain. Ensure the tx is confirmed and paste the correct signature.")

    # Verify agent wallet participated in this transaction
    account_keys = result.get("transaction", {}).get("message", {}).get("accountKeys", [])
    agent_in_tx = any(
        (k if isinstance(k, str) else k.get("pubkey", "")) == policy["agent_wallet"]
        for k in account_keys
    )
    if not agent_in_tx:
        detail = f"This transaction does not involve the insured agent ({policy['agent_wallet'][:12]}…). Submit a tx where the agent actually executed the task."
        if is_one_time:
            await _db.append_claim_record(req.policy_id, {
                "failed_tx_sig": req.failed_tx_sig,
                "net_loss_sol":  0.0,
                "payout_sol":    0.0,
                "loss_ratio":    0.0,
                "description":   f"[Auto-rejected] {detail}",
                "claimed_at":    _time.time(),
            })
            await _db.update_policy_status(req.policy_id, "claimed")
        raise HTTPException(status_code=400, detail=detail)

    # Verify tx blockTime falls within policy validity period
    block_time = result.get("blockTime")
    if block_time is None:
        raise HTTPException(status_code=400, detail="Transaction blockTime unavailable — cannot verify timing.")
    if block_time < policy["created_at"]:
        detail = f"Transaction occurred before this policy was purchased ({_time.strftime('%Y-%m-%d %H:%M UTC', _time.gmtime(block_time))}). Only transactions after policy activation are covered."
        if is_one_time:
            await _db.append_claim_record(req.policy_id, {
                "failed_tx_sig": req.failed_tx_sig,
                "net_loss_sol":  0.0,
                "payout_sol":    0.0,
                "loss_ratio":    0.0,
                "description":   f"[Auto-rejected] {detail}",
                "claimed_at":    _time.time(),
            })
            await _db.update_policy_status(req.policy_id, "claimed")
        raise HTTPException(status_code=400, detail=detail)
    if block_time > policy["expires_at"]:
        detail = f"Transaction occurred after policy expiry ({_time.strftime('%Y-%m-%d %H:%M UTC', _time.gmtime(policy['expires_at']))}). Only transactions within the coverage period are eligible."
        if is_one_time:
            await _db.append_claim_record(req.policy_id, {
                "failed_tx_sig": req.failed_tx_sig,
                "net_loss_sol":  0.0,
                "payout_sol":    0.0,
                "loss_ratio":    0.0,
                "description":   f"[Auto-rejected] {detail}",
                "claimed_at":    _time.time(),
            })
            await _db.update_policy_status(req.policy_id, "claimed")
        raise HTTPException(status_code=400, detail=detail)

    agent_delta  = _balance_delta(result, policy["agent_wallet"])
    buyer_delta  = _balance_delta(result, req.buyer_wallet)
    agent_out    = round(max(agent_delta, 0.0), 6)
    net_loss_sol = round(max(agent_out - max(buyer_delta, 0.0), 0.0), 6)

    if agent_out == 0.0:
        if is_one_time:
            await _db.update_policy_status(req.policy_id, "claimed")
        await _db.append_claim_record(req.policy_id, {
            "failed_tx_sig": req.failed_tx_sig,
            "net_loss_sol":  0.0,
            "payout_sol":    0.0,
            "loss_ratio":    0.0,
            "description":   req.description,
            "claimed_at":    _time.time(),
        })
        return {"approved": False, "reason": "No SOL flow to the agent was detected in this transaction — cannot verify a loss."}

    loss_ratio = net_loss_sol / agent_out if agent_out > 0 else 0.0
    if loss_ratio < 0.10:
        if is_one_time:
            await _db.update_policy_status(req.policy_id, "claimed")
        await _db.append_claim_record(req.policy_id, {
            "failed_tx_sig": req.failed_tx_sig,
            "net_loss_sol":  net_loss_sol,
            "payout_sol":    0.0,
            "loss_ratio":    round(loss_ratio, 4),
            "description":   req.description,
            "claimed_at":    _time.time(),
        })
        return {"approved": False, "reason": f"Loss ratio {loss_ratio:.1%} is below the 10% minimum threshold (net loss: {net_loss_sol:.4f} SOL)."}

    payout_sol  = round(min(net_loss_sol, remaining), 6)
    new_claimed = round(claimed_so_far + payout_sol, 6)

    # One-time: close after first claim. Periodic: close only when coverage exhausted.
    if is_one_time or new_claimed >= coverage:
        await _db.update_policy_status(req.policy_id, "claimed")
        new_status = "claimed"
    else:
        await _db.update_claimed_sol(req.policy_id, new_claimed)
        new_status = "active"

    await _db.append_claim_record(req.policy_id, {
        "failed_tx_sig": req.failed_tx_sig,
        "net_loss_sol":  net_loss_sol,
        "payout_sol":    payout_sol,
        "loss_ratio":    round(loss_ratio, 4),
        "description":   req.description,
        "claimed_at":    _time.time(),
    })

    logger.info(
        f"Claim policy={req.policy_id} buyer={req.buyer_wallet[:8]} "
        f"loss={net_loss_sol:.4f} payout={payout_sol:.4f} remaining_after={round(remaining-payout_sol,6):.4f}"
    )
    remaining_after = round(remaining - payout_sol, 6)
    return {
        "approved":           True,
        "payout_sol":         payout_sol,
        "loss_ratio":         round(loss_ratio, 4),
        "net_loss_sol":       net_loss_sol,
        "remaining_coverage": remaining_after,
        "policy_status":      new_status,
        "reason": (
            f"On-chain verified: agent received {agent_out:.4f} SOL, returned {round(max(buyer_delta,0),6):.4f} SOL. "
            f"Net loss {net_loss_sol:.4f} SOL ({loss_ratio:.1%}). "
            f"Payout = full net loss, capped at remaining {remaining} SOL. "
            + (f"Remaining coverage: {remaining_after} SOL." if new_status == "active" else "Policy closed.")
        ),
    }


# ── Background task ───────────────────────────────────────────────────────────
async def analyze_and_maybe_freeze(agent_id: str) -> None:
    """后台：基于链上数据分析风险，必要时触发冻结"""
    try:
        proofs, _, chain_stats = await _build_chain_data(agent_id)
        score = risk_monitor.analyze(agent_id, proofs, chain_stats)
        risk_cache[agent_id] = score

        if score.should_freeze and agent_id not in freeze_queue:
            freeze_queue.append(agent_id)
            logger.warning(
                f"🚨 FREEZE TRIGGERED {agent_id} score={score.score:.1f} reasons={score.reasons}"
            )
            freeze_api_url = os.getenv("PROOF_ENGINE_URL", "http://localhost:3001")
            try:
                async with aiohttp.ClientSession() as session:
                    resp = await session.post(
                        f"{freeze_api_url}/api/v1/freeze",
                        json={
                            "agent_id": agent_id,
                            "reason": "; ".join(score.reasons),
                            "risk_score": score.score,
                        },
                        timeout=aiohttp.ClientTimeout(total=10),
                    )
                    if resp.status >= 400:
                        logger.error(f"Freeze API returned {resp.status} for {agent_id}")
            except aiohttp.ClientError as e:
                logger.error(f"Freeze API unreachable for {agent_id}: {type(e).__name__}")
            except Exception as e:
                logger.error(f"Freeze API call failed for {agent_id}: {type(e).__name__}")
            try:
                freezer = get_freezer()
                tx_sig = await freezer.freeze_on_chain(agent_id, f"Risk score {score.score:.1f}")
                logger.info(f"Froze agent {agent_id} on-chain: {tx_sig}")
            except Exception as freeze_err:
                logger.error(f"On-chain freeze failed for {agent_id}: {freeze_err}")
    except Exception as e:
        logger.error(f"analyze_and_maybe_freeze({agent_id}): {e}")
