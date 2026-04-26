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
class ChainStats:
    """来自链上 AgentRecord 的汇总统计（已结算的真实数据）"""
    tasks_completed: int = 0
    tasks_failed: int = 0
    reputation_score: int = 100
    is_frozen: bool = False
    staked_lamports: int = 0


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
        recent_10 = set(hashes[-10:])
        historical = set(hashes[:-10])
        overlap = len(recent_10 & historical)
        if overlap == 0 and len(recent_10) > 5:
            return 15.0
        return 0.0


class ChainStatsDetector:
    """
    基于链上 AgentRecord 汇总数据的基线风险检测。
    弥补 TaskProof 数量不足时其他检测器无数据可分析的缺陷。
    """

    def analyze(self, stats: Optional[ChainStats]) -> tuple[float, List[str]]:
        """返回 (风险贡献分 0-40, reasons)"""
        if stats is None:
            return 0.0, []

        reasons: List[str] = []
        score = 0.0

        total = stats.tasks_completed + stats.tasks_failed
        if total >= 5:
            fail_rate = stats.tasks_failed / total
            if fail_rate > 0.5:
                score += min(40.0, fail_rate * 60)
                reasons.append(f"链上失败率: {fail_rate:.1%} ({stats.tasks_failed}/{total})")
            elif fail_rate > 0.3:
                score += min(20.0, fail_rate * 40)
                reasons.append(f"链上失败率偏高: {fail_rate:.1%}")

        if stats.reputation_score < 50:
            score += min(20.0, (50 - stats.reputation_score) * 0.5)
            reasons.append(f"声誉分偏低: {stats.reputation_score}/1000")

        if stats.staked_lamports == 0 and total > 0:
            score += 15.0
            reasons.append("质押已清零（可能被 slash）")

        return score, reasons
