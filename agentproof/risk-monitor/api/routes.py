from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
import time

from models.risk_model import AgentRiskMonitor
from models.detectors import ProofRecord, RiskScore

router = APIRouter()
risk_monitor = AgentRiskMonitor()

# 内存存储（生产环境换成 Redis/PostgreSQL）
agent_proofs: Dict[str, List[ProofRecord]] = {}
risk_cache: Dict[str, RiskScore] = {}
freeze_queue: List[str] = []


class ProofSubmitRequest(BaseModel):
    agent_id: str
    task_id: str
    success: bool
    output_hash: str
    input_hash: str
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


@router.post("/api/v1/proof_event")
async def receive_proof_event(
    req: ProofSubmitRequest,
    background_tasks: BackgroundTasks
):
    """接收任务证明事件，更新行为记录"""
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

    if req.agent_id not in agent_proofs:
        agent_proofs[req.agent_id] = []

    agent_proofs[req.agent_id].append(proof)
    # 只保留最近 100 条记录
    agent_proofs[req.agent_id] = agent_proofs[req.agent_id][-100:]

    # 后台异步分析风险
    background_tasks.add_task(analyze_and_maybe_freeze, req.agent_id)

    return {"status": "received", "agent_id": req.agent_id}


@router.post("/api/v1/analyze")
async def analyze_agent(req: AnalyzeRequest) -> RiskScoreResponse:
    """分析指定 Agent 的风险评分"""
    proofs = agent_proofs.get(req.agent_id, [])
    score = risk_monitor.analyze(req.agent_id, proofs)
    breakdown = risk_monitor.get_score_breakdown(proofs)

    risk_cache[req.agent_id] = score

    return RiskScoreResponse(
        agent_id=score.agent_id,
        score=score.score,
        level=score.level,
        reasons=score.reasons,
        should_freeze=score.should_freeze,
        breakdown=breakdown,
        timestamp=score.timestamp,
    )


@router.get("/api/v1/risk/{agent_id}")
async def get_risk_score(agent_id: str) -> RiskScoreResponse:
    """获取缓存的风险评分"""
    if agent_id in risk_cache:
        score = risk_cache[agent_id]
        proofs = agent_proofs.get(agent_id, [])
        breakdown = risk_monitor.get_score_breakdown(proofs)
        return RiskScoreResponse(
            agent_id=score.agent_id,
            score=score.score,
            level=score.level,
            reasons=score.reasons,
            should_freeze=score.should_freeze,
            breakdown=breakdown,
            timestamp=score.timestamp,
        )

    # 没有缓存，实时分析
    proofs = agent_proofs.get(agent_id, [])
    score = risk_monitor.analyze(agent_id, proofs)
    breakdown = risk_monitor.get_score_breakdown(proofs)
    return RiskScoreResponse(
        agent_id=score.agent_id,
        score=score.score,
        level=score.level,
        reasons=score.reasons,
        should_freeze=score.should_freeze,
        breakdown=breakdown,
        timestamp=score.timestamp,
    )


@router.get("/api/v1/alerts")
async def get_alerts():
    """获取所有高风险告警"""
    alerts = []
    for agent_id, score in risk_cache.items():
        if score.level in ["warning", "danger"]:
            alerts.append({
                "agent_id": agent_id,
                "score": score.score,
                "level": score.level,
                "reasons": score.reasons,
                "timestamp": score.timestamp,
            })
    return {"alerts": alerts, "count": len(alerts)}


@router.get("/api/v1/agents")
async def list_agents():
    """列出所有被监控的 Agent"""
    agents = []
    for agent_id in agent_proofs:
        proofs = agent_proofs[agent_id]
        score = risk_cache.get(agent_id)
        agents.append({
            "agent_id": agent_id,
            "proof_count": len(proofs),
            "risk_score": score.score if score else 0,
            "risk_level": score.level if score else "safe",
        })
    return {"agents": agents}


async def analyze_and_maybe_freeze(agent_id: str):
    """后台任务：分析风险并在需要时触发冻结"""
    import os
    import aiohttp

    proofs = agent_proofs.get(agent_id, [])
    score = risk_monitor.analyze(agent_id, proofs)
    risk_cache[agent_id] = score

    if score.should_freeze and agent_id not in freeze_queue:
        freeze_queue.append(agent_id)
        print(f"🚨 FREEZE TRIGGERED for {agent_id} - Score: {score.score} - Reasons: {score.reasons}")

        # 调用链上冻结（通过 Proof Engine 或直接调用 Solana 程序）
        freeze_api_url = os.getenv("PROOF_ENGINE_URL", "http://localhost:3001")
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{freeze_api_url}/api/v1/freeze",
                    json={
                        "agent_id": agent_id,
                        "reason": "; ".join(score.reasons),
                        "risk_score": score.score,
                    },
                    timeout=aiohttp.ClientTimeout(total=10)
                )
        except Exception as e:
            print(f"Failed to call freeze API: {e}")
