"""
5-dimension positive reputation scoring engine.
Output: 0-100 score (higher = more trustworthy), grade A-C.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .detectors import ProofRecord, ChainStats


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ScoreBreakdown:
    behavior_safety: int   # 0-35
    completion_rate: int   # 0-25
    fund_risk: int         # 0-20
    compliance: int        # 0-12
    activity_decay: int    # 0-8
    total: int             # 0-100
    grade: str             # AAA | AA | A | B | C
    premium_multiplier: Optional[float]  # None for grade C (uninsurable)


# ── Grade helpers ─────────────────────────────────────────────────────────────

def score_to_grade(total: int) -> str:
    if total >= 90:
        return "AAA"
    if total >= 75:
        return "AA"
    if total >= 60:
        return "A"
    if total >= 45:
        return "B"
    return "C"


def grade_to_premium_multiplier(grade: str) -> Optional[float]:
    return {"AAA": 0.5, "AA": 0.8, "A": 1.0, "B": 1.5, "C": None}[grade]


# ── Dimension scorers ─────────────────────────────────────────────────────────

def _score_behavior_safety(proofs: List[ProofRecord]) -> int:
    """Dimension 1: Historical behavior safety (0-35)."""
    if not proofs:
        return 18

    failure_ratio = sum(1 for p in proofs if not p.success) / len(proofs)
    failure_penalty = min(failure_ratio * 50, 20)
    return max(0, min(35, int(35 - failure_penalty)))


def _score_completion_rate(proofs: List[ProofRecord], chain_stats: Optional[ChainStats]) -> int:
    """Dimension 2: Task completion rate (0-25)."""
    # Prefer on-chain aggregate stats (verified data)
    if chain_stats is not None:
        total = chain_stats.tasks_completed + chain_stats.tasks_failed
        if total > 0:
            rate = chain_stats.tasks_completed / total
            return int(rate * 25)
    if not proofs:
        return 12
    success_count = sum(1 for p in proofs if p.success)
    rate = success_count / len(proofs)
    return int(rate * 25)


def _score_fund_risk(proofs: List[ProofRecord]) -> int:
    """Dimension 3: Fund risk exposure (0-20)."""
    if not proofs:
        return 10

    max_sol = max((abs(p.sol_delta) for p in proofs), default=0.0)
    if max_sol <= 2.0:
        return 20
    if max_sol <= 5.0:
        ratio = (max_sol - 2.0) / 3.0
        return int(20 - ratio * 10)
    return max(0, int(10 - (max_sol - 5.0) * 2))


def _score_compliance(
    is_sdk_registered: bool,
    has_manifest: bool,
) -> int:
    """Dimension 4: Framework compliance (0-12)."""
    score = 0
    if is_sdk_registered:
        score += 10
    if has_manifest:
        score += 2
    return score


def _score_activity_decay(proofs: List[ProofRecord], chain_stats: Optional[ChainStats]) -> int:
    """Dimension 5: Activity decay (0-8)."""
    import time

    if not proofs and (chain_stats is None or chain_stats.tasks_completed == 0):
        return 4

    # Use latest proof timestamp; fall back to full score if no timestamp info
    if not proofs:
        return 6

    now_ts = time.time()
    latest_ts = max(getattr(p, "submitted_at", 0) for p in proofs)
    if latest_ts == 0:
        return 6

    days_since = (now_ts - latest_ts) / 86400
    if days_since <= 30:
        return 8
    extra_months = (days_since - 30) / 30
    decayed = 8 * (1 - 0.1 * extra_months)
    return max(0, int(decayed))


# ── Main engine ───────────────────────────────────────────────────────────────

class ReputationScoreEngine:
    """Compute a 100-point positive reputation score from on-chain data."""

    def compute(
        self,
        proofs: List[ProofRecord],
        chain_stats: Optional[ChainStats],
        is_sdk_registered: bool = True,
        has_manifest: bool = False,
    ) -> ScoreBreakdown:
        if not proofs and chain_stats is None:
            grade = "B"
            return ScoreBreakdown(
                behavior_safety=18,
                completion_rate=12,
                fund_risk=10,
                compliance=_score_compliance(is_sdk_registered, has_manifest),
                activity_decay=4,
                total=50,
                grade=grade,
                premium_multiplier=grade_to_premium_multiplier(grade),
            )

        bs = _score_behavior_safety(proofs)
        cr = _score_completion_rate(proofs, chain_stats)
        fr = _score_fund_risk(proofs)
        co = _score_compliance(is_sdk_registered, has_manifest)
        ad = _score_activity_decay(proofs, chain_stats)

        total = bs + cr + fr + co + ad
        grade = score_to_grade(total)

        return ScoreBreakdown(
            behavior_safety=bs,
            completion_rate=cr,
            fund_risk=fr,
            compliance=co,
            activity_decay=ad,
            total=total,
            grade=grade,
            premium_multiplier=grade_to_premium_multiplier(grade),
        )
