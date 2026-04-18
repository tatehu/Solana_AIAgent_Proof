# 05 — AI 风控服务（Python/FastAPI）

## 初始化项目

```bash
mkdir risk-monitor && cd risk-monitor
python3 -m venv venv
source venv/bin/activate

pip install fastapi uvicorn scikit-learn numpy pandas solana anchorpy \
  python-dotenv aiohttp prometheus-client websockets
```

---

## requirements.txt

```
fastapi==0.111.0
uvicorn[standard]==0.30.0
scikit-learn==1.5.0
numpy==1.26.4
pandas==2.2.2
solana==0.34.0
anchorpy==0.20.0
python-dotenv==1.0.1
aiohttp==3.9.5
prometheus-client==0.20.0
websockets==12.0
pydantic==2.7.0
```

---

## models/detectors.py（各类异常检测器）

```python
from dataclasses import dataclass, field
from typing import List, Optional
from collections import deque
import time


@dataclass
class ProofRecord:
    """单次任务证明记录"""
    task_id: str
    success: bool
    output_hash: str
    input_hash: str
    submitted_at: float
    ata_created: int = 0          # 本次任务创建的 ATA 账户数
    sol_delta: float = 0.0        # SOL 余额变化（负数=减少）
    slot: int = 0


@dataclass
class RiskScore:
    """风险评分结果"""
    agent_id: str
    score: float                   # 0-100，>80 触发自动冻结
    level: str                     # "safe" | "warning" | "danger"
    reasons: List[str]
    should_freeze: bool
    timestamp: float = field(default_factory=time.time)


class FailureRateDetector:
    """失败率异常检测"""
    WINDOW_SIZE = 20               # 最近20次任务
    THRESHOLD = 0.5                # 失败率>50% 触发

    def analyze(self, proofs: List[ProofRecord]) -> float:
        """返回风险贡献分 0-40"""
        if not proofs:
            return 0.0
        recent = proofs[-self.WINDOW_SIZE:]
        if len(recent) < 3:
            return 0.0
        fail_rate = sum(1 for p in recent if not p.success) / len(recent)
        if fail_rate > self.THRESHOLD:
            return min(40.0, fail_rate * 60)
        return 0.0


class ReplayAttackDetector:
    """重放攻击检测（相同 output_hash 重复提交）"""

    def analyze(self, proofs: List[ProofRecord]) -> float:
        """返回风险贡献分 0-30"""
        if len(proofs) < 2:
            return 0.0
        recent = proofs[-20:]
        hashes = [p.output_hash for p in recent]
        unique_count = len(set(hashes))
        total_count = len(hashes)
        if total_count == 0:
            return 0.0
        duplicate_rate = 1 - (unique_count / total_count)
        if duplicate_rate > 0.3:
            return min(30.0, duplicate_rate * 50)
        return 0.0


class ATACreationDetector:
    """ATA 账户爆炸检测（Solana 特有风险）"""
    WINDOW_MINUTES = 10
    THRESHOLD = 20                 # 10分钟内创建>20个 ATA → 风险+40

    def analyze(self, proofs: List[ProofRecord]) -> float:
        """返回风险贡献分 0-40"""
        now = time.time()
        window_start = now - self.WINDOW_MINUTES * 60
        recent = [p for p in proofs if p.submitted_at >= window_start]
        total_ata = sum(p.ata_created for p in recent)
        if total_ata > self.THRESHOLD:
            return min(40.0, (total_ata - self.THRESHOLD) * 2)
        return 0.0


class SOLDrainDetector:
    """SOL 余额异常快速减少检测"""
    DRAIN_THRESHOLD = -2.0         # 2 SOL 以上快速减少 → 风险+30
    WINDOW_MINUTES = 5

    def analyze(self, proofs: List[ProofRecord]) -> float:
        """返回风险贡献分 0-30"""
        now = time.time()
        window_start = now - self.WINDOW_MINUTES * 60
        recent = [p for p in proofs if p.submitted_at >= window_start]
        total_delta = sum(p.sol_delta for p in recent)
        if total_delta < self.DRAIN_THRESHOLD:
            return min(30.0, abs(total_delta) * 10)
        return 0.0


class OutputDriftDetector:
    """输出结果偏移检测（输出分布异常）"""

    def analyze(self, proofs: List[ProofRecord]) -> float:
        """返回风险贡献分 0-20"""
        if len(proofs) < 10:
            return 0.0
        recent = proofs[-30:]
        hashes = [p.output_hash for p in recent]
        # 简单统计：如果最近10次输出都是全新哈希（无规律），可能异常
        # 实际生产中可用向量化嵌入 + 聚类算法
        recent_10 = set(hashes[-10:])
        historical = set(hashes[:-10])
        overlap = len(recent_10 & historical)
        if overlap == 0 and len(recent_10) > 5:
            return 15.0
        return 0.0
```

---

## models/risk_model.py（风险评分模型）

```python
from typing import List, Dict
from .detectors import (
    ProofRecord, RiskScore,
    FailureRateDetector, ReplayAttackDetector,
    ATACreationDetector, SOLDrainDetector,
    OutputDriftDetector
)
import time


class AgentRiskMonitor:
    """
    AI Agent 行为风险监控主模型

    风险评分组成：
    - 失败率异常：最高 40 分
    - 重放攻击：最高 30 分
    - ATA 账户爆炸：最高 40 分（Solana 特有）
    - SOL 余额耗尽：最高 30 分
    - 输出偏移：最高 20 分
    总分上限：100 分（取加权平均后 clip 到 100）

    阈值：
    - 0-40：safe（绿色）
    - 40-80：warning（黄色）
    - >80：danger（红色，自动冻结）
    """

    FREEZE_THRESHOLD = 80.0

    def __init__(self):
        self.failure_detector = FailureRateDetector()
        self.replay_detector = ReplayAttackDetector()
        self.ata_detector = ATACreationDetector()
        self.sol_drain_detector = SOLDrainDetector()
        self.output_drift_detector = OutputDriftDetector()

    def analyze(
        self,
        agent_id: str,
        recent_proofs: List[ProofRecord]
    ) -> RiskScore:
        """
        分析 Agent 风险评分

        Args:
            agent_id: Agent 公钥
            recent_proofs: 最近100次行为记录

        Returns:
            RiskScore: 风险评分结果
        """
        scores: Dict[str, float] = {
            "failure_rate": self.failure_detector.analyze(recent_proofs),
            "replay_attack": self.replay_detector.analyze(recent_proofs),
            "ata_explosion": self.ata_detector.analyze(recent_proofs),
            "sol_drain": self.sol_drain_detector.analyze(recent_proofs),
            "output_drift": self.output_drift_detector.analyze(recent_proofs),
        }

        total_score = min(100.0, sum(scores.values()))

        reasons = []
        if scores["failure_rate"] > 10:
            fail_rate = self._calc_fail_rate(recent_proofs)
            reasons.append(f"高失败率: {fail_rate:.1%}")
        if scores["replay_attack"] > 10:
            reasons.append("检测到重复输出哈希（疑似重放攻击）")
        if scores["ata_explosion"] > 10:
            reasons.append("ATA账户创建速率异常（可能耗尽SOL）")
        if scores["sol_drain"] > 10:
            reasons.append("SOL余额快速减少")
        if scores["output_drift"] > 10:
            reasons.append("输出结果偏离历史分布")

        level = (
            "danger" if total_score > 80
            else "warning" if total_score > 40
            else "safe"
        )

        return RiskScore(
            agent_id=agent_id,
            score=total_score,
            level=level,
            reasons=reasons,
            should_freeze=total_score > self.FREEZE_THRESHOLD,
            timestamp=time.time()
        )

    @staticmethod
    def _calc_fail_rate(proofs: List[ProofRecord]) -> float:
        if not proofs:
            return 0.0
        recent = proofs[-20:]
        return sum(1 for p in recent if not p.success) / len(recent)

    def get_score_breakdown(
        self,
        recent_proofs: List[ProofRecord]
    ) -> Dict[str, float]:
        """获取各检测器详细评分（用于 Dashboard 显示）"""
        return {
            "failure_rate": self.failure_detector.analyze(recent_proofs),
            "replay_attack": self.replay_detector.analyze(recent_proofs),
            "ata_explosion": self.ata_detector.analyze(recent_proofs),
            "sol_drain": self.sol_drain_detector.analyze(recent_proofs),
            "output_drift": self.output_drift_detector.analyze(recent_proofs),
        }
```

---

## api/routes.py（FastAPI 路由）

```python
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from models.risk_model import AgentRiskMonitor
from models.detectors import ProofRecord, RiskScore

router = APIRouter()
risk_monitor = AgentRiskMonitor()

# 内存存储（生产环境换成 Redis/PostgreSQL）
agent_proofs: dict[str, list[ProofRecord]] = {}
risk_cache: dict[str, RiskScore] = {}
freeze_queue: list[str] = []


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
    breakdown: dict
    timestamp: float


@router.post("/api/v1/proof_event")
async def receive_proof_event(
    req: ProofSubmitRequest,
    background_tasks: BackgroundTasks
):
    """接收任务证明事件，更新行为记录"""
    import time

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
```

---

## main.py（FastAPI 应用入口）

```python
import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from api.routes import router

app = FastAPI(
    title="AgentProof Risk Monitor",
    description="AI-powered real-time risk scoring for Solana AI Agents",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# Prometheus 指标端点
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "AgentProof Risk Monitor",
        "version": "0.1.0",
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("ENV", "production") == "development",
        log_level="info",
    )
```

---

## Demo 数据生成脚本（模拟恶意 Agent 场景）

```python
# scripts/simulate_malicious_agent.py
import requests
import random
import time
import hashlib


RISK_MONITOR_URL = "http://localhost:8000"
AGENT_ID = "MaliciousAgent111111111111111111111111111"


def random_hash() -> str:
    return hashlib.sha256(str(random.random()).encode()).hexdigest()


def simulate_normal_behavior(n: int = 10):
    """模拟正常行为"""
    for i in range(n):
        requests.post(f"{RISK_MONITOR_URL}/api/v1/proof_event", json={
            "agent_id": AGENT_ID,
            "task_id": random_hash(),
            "success": True,
            "output_hash": random_hash(),
            "input_hash": random_hash(),
            "ata_created": random.randint(0, 2),
            "sol_delta": -random.uniform(0, 0.01),
            "slot": 1000 + i,
        })
        print(f"  ✓ Normal task {i+1}/{n}")
        time.sleep(0.1)


def simulate_attack_behavior():
    """模拟攻击行为：重放攻击 + 高失败率"""
    fixed_hash = random_hash()  # 重复使用同一个 output_hash

    for i in range(15):
        requests.post(f"{RISK_MONITOR_URL}/api/v1/proof_event", json={
            "agent_id": AGENT_ID,
            "task_id": random_hash(),
            "success": random.random() > 0.6,  # 40% 失败率
            "output_hash": fixed_hash,           # 重放：相同 output_hash
            "input_hash": random_hash(),
            "ata_created": random.randint(5, 10),  # ATA 疯狂创建
            "sol_delta": -random.uniform(0.1, 0.5),  # SOL 快速减少
            "slot": 2000 + i,
        })
        print(f"  ⚠️  Attack task {i+1}/15")
        time.sleep(0.1)


def check_risk():
    """查询风险评分"""
    response = requests.post(f"{RISK_MONITOR_URL}/api/v1/analyze", json={
        "agent_id": AGENT_ID
    })
    data = response.json()
    print(f"\n📊 Risk Score: {data['score']:.1f} ({data['level'].upper()})")
    if data['reasons']:
        for reason in data['reasons']:
            print(f"   ⚠️  {reason}")
    return data['score']


if __name__ == "__main__":
    print("Phase 1: Normal behavior (10 tasks)")
    simulate_normal_behavior(10)
    score = check_risk()

    print(f"\nPhase 2: Attack behavior (15 tasks)")
    simulate_attack_behavior()
    score = check_risk()

    if score > 80:
        print(f"\n🚨 FREEZE TRIGGERED! Agent should be frozen on-chain")
    else:
        print(f"\n Score: {score} - threshold 80 not reached yet")
```

---

## 启动命令

```bash
cd risk-monitor
source venv/bin/activate
cp .env.example .env

# 开发模式
python main.py

# 或使用 uvicorn
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 运行 Demo 模拟
python scripts/simulate_malicious_agent.py
```
