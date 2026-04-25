// agentproof/programs/agentproof/src/state/agent_record.rs
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct AgentRecord {
    pub agent_pubkey: Pubkey,
    pub capability_hash: [u8; 32],
    pub staked_lamports: u64,
    /// EWMA credit score 0–100 (replaces reputation_score 0–1000)
    pub credit_score: u64,
    /// Safety index from audit-engine 0–100
    pub safety_index: u64,
    pub tasks_completed: u64,
    pub tasks_failed: u64,
    pub success_rate_bps: u16,
    pub is_frozen: bool,
    pub registered_at: i64,
    pub last_active_at: i64,
    pub bump: u8,
}

impl AgentRecord {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 8 + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 8 + 1;

    /// EWMA: new = 0.80 * old + 0.20 * task_score (integer arithmetic × 100)
    pub fn update_ewma(&mut self, task_score: u64, clock: &Clock) {
        let task_score = task_score.min(100);
        self.credit_score = (self.credit_score * 80 + task_score * 20) / 100;
        self.last_active_at = clock.unix_timestamp;

        if task_score >= 50 {
            self.tasks_completed += 1;
        } else {
            self.tasks_failed += 1;
        }
        let total = self.tasks_completed + self.tasks_failed;
        if total > 0 {
            self.success_rate_bps = ((self.tasks_completed * 10000) / total) as u16;
        }
    }

    /// Stake-weighted initial credit score
    pub fn initial_credit(stake_lamports: u64) -> u64 {
        let base = 50u64;
        if stake_lamports >= 5_000_000_000 {
            base + 10
        } else if stake_lamports >= 1_000_000_000 {
            base + 5
        } else {
            base
        }
    }

    /// Kept for backward compat — delegates to update_ewma
    pub fn record_task_result(&mut self, success: bool, clock: &Clock) {
        self.update_ewma(if success { 100 } else { 0 }, clock);
    }
}
