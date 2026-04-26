from typing import List, Dict, Optional
from .detectors import (
    ProofRecord, RiskScore, ChainStats,
    FailureRateDetector, ReplayAttackDetector,
    ATACreationDetector, SOLDrainDetector,
    OutputDriftDetector, ChainStatsDetector,
)
import time


class AgentRiskMonitor:
    """
    AI Agent 行为风险监控主模型

    风险评分组成：
    - 链上失败率（ChainStats）：最高 40 分  ← 真实链上数据，最优先
    - 实时失败率（ProofRecord）：最高 40 分  ← 与上面取较高值，不叠加
    - 重放攻击：最高 30 分
    - ATA 账户爆炸：最高 40 分（Solana 特有）
    - SOL 余额耗尽：最高 30 分
    - 输出偏移：最高 20 分
    总分上限：100 分

    阈值：
    - 0-40：safe（绿色）
    - 40-80：warning（黄色）
    - >80：danger（红色，自动冻结）
    """

    FREEZE_THRESHOLD = 80.0

    def __init__(self) -> None:
        self.failure_detector = FailureRateDetector()
        self.replay_detector = ReplayAttackDetector()
        self.ata_detector = ATACreationDetector()
        self.sol_drain_detector = SOLDrainDetector()
        self.output_drift_detector = OutputDriftDetector()
        self.chain_stats_detector = ChainStatsDetector()

    def analyze(
        self,
        agent_id: str,
        recent_proofs: List[ProofRecord],
        chain_stats: Optional[ChainStats] = None,
    ) -> RiskScore:
        """
        分析 Agent 风险评分。

        chain_stats 来自链上 AgentRecord（已结算的真实数据）。
        recent_proofs 来自链上 TaskProof 列表 + 内存实时事件（合并后）。
        """
        reasons: List[str] = []

        # 1. 链上汇总失败率（最可信）
        chain_fail_score, chain_reasons = self.chain_stats_detector.analyze(chain_stats)
        reasons.extend(chain_reasons)

        # 2. 实时 ProofRecord 失败率（与链上取较高值）
        rt_fail_score = self.failure_detector.analyze(recent_proofs)

        # 取两者较高值，避免双重叠加
        failure_score = max(chain_fail_score, rt_fail_score)
        if rt_fail_score > chain_fail_score and rt_fail_score > 10:
            rt_fail_rate = self._calc_fail_rate(recent_proofs)
            reasons.append(f"Recent failure rate: {rt_fail_rate:.1%}")

        # 3. 其他检测器
        replay_score = self.replay_detector.analyze(recent_proofs)
        ata_score = self.ata_detector.analyze(recent_proofs)
        sol_drain_score = self.sol_drain_detector.analyze(recent_proofs)
        drift_score = self.output_drift_detector.analyze(recent_proofs)

        if replay_score > 10:
            reasons.append("Duplicate output hash detected (possible replay attack)")
        if ata_score > 10:
            reasons.append("Abnormal ATA account creation rate (may drain SOL)")
        if sol_drain_score > 10:
            reasons.append("SOL balance draining rapidly")
        if drift_score > 10:
            reasons.append("Output deviates from historical distribution")

        total_score = min(100.0, failure_score + replay_score + ata_score + sol_drain_score + drift_score)

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
            timestamp=time.time(),
        )

    @staticmethod
    def _calc_fail_rate(proofs: List[ProofRecord]) -> float:
        if not proofs:
            return 0.0
        recent = proofs[-20:]
        return sum(1 for p in recent if not p.success) / len(recent)

    def get_score_breakdown(
        self,
        recent_proofs: List[ProofRecord],
        chain_stats: Optional[ChainStats] = None,
    ) -> Dict[str, float]:
        """获取各检测器详细评分（用于 Dashboard 显示）"""
        chain_fail, _ = self.chain_stats_detector.analyze(chain_stats)
        rt_fail = self.failure_detector.analyze(recent_proofs)
        return {
            "failure_rate": max(chain_fail, rt_fail),
            "replay_attack": self.replay_detector.analyze(recent_proofs),
            "ata_explosion": self.ata_detector.analyze(recent_proofs),
            "sol_drain": self.sol_drain_detector.analyze(recent_proofs),
            "output_drift": self.output_drift_detector.analyze(recent_proofs),
        }
