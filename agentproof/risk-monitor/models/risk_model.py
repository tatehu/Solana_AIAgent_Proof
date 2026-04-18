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
