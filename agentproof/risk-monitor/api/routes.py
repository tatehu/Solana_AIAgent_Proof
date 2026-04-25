import asyncio
import hashlib
import logging
import time
import os
from typing import List, Optional, Dict

import aiohttp
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from solders.pubkey import Pubkey
from solders.signature import Signature

from models.risk_model import AgentRiskMonitor
from models.detectors import ProofRecord, RiskScore, ChainStats
from chain_reader import get_chain_reader
from chain_freezer import get_freezer

logger = logging.getLogger(__name__)
router = APIRouter()
risk_monitor = AgentRiskMonitor()

# 内存存储：仅用于实时展示，不参与风险评分
agent_proofs: Dict[str, List[ProofRecord]] = {}
risk_cache: Dict[str, RiskScore] = {}
freeze_queue: List[str] = []


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
    """列出所有被监控的 Agent"""
    agents = []
    for agent_id in agent_proofs:
        score = risk_cache.get(agent_id)
        agents.append({
            "agent_id": agent_id,
            "proof_count": len(agent_proofs[agent_id]),
            "risk_score": score.score if score else 0,
            "risk_level": score.level if score else "safe",
        })
    return {"agents": agents}


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
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{freeze_api_url}/api/v1/freeze",
                    json={
                        "agent_id": agent_id,
                        "reason": "; ".join(score.reasons),
                        "risk_score": score.score,
                    },
                    timeout=aiohttp.ClientTimeout(total=10),
                )
            try:
                freezer = get_freezer()
                tx_sig = await freezer.freeze_on_chain(agent_id, f"Risk score {score.score:.1f}")
                logger.info(f"Froze agent {agent_id} on-chain: {tx_sig}")
            except Exception as freeze_err:
                logger.error(f"On-chain freeze failed for {agent_id}: {freeze_err}")
    except Exception as e:
        logger.error(f"analyze_and_maybe_freeze({agent_id}): {e}")
