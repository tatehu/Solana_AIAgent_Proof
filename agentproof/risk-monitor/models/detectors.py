from dataclasses import dataclass, field
from typing import List
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
