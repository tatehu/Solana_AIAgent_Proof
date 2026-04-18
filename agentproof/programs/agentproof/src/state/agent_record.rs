// programs/agentproof/src/state/agent_record.rs
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct AgentRecord {
    /// Agent 钱包公钥
    pub agent_pubkey: Pubkey,      // 32
    /// 能力声明哈希（对应链下 JSON capability manifest）
    pub capability_hash: [u8; 32], // 32
    /// 质押 lamports（保证金）
    pub staked_lamports: u64,      // 8
    /// 声誉积分（0-1000，不可转让 SBT 同步）
    pub reputation_score: u64,     // 8
    /// 总完成任务数
    pub tasks_completed: u64,      // 8
    /// 总失败任务数
    pub tasks_failed: u64,         // 8
    /// 成功率（basis points，10000 = 100%）
    pub success_rate_bps: u16,     // 2
    /// 是否被冻结
    pub is_frozen: bool,           // 1
    /// 注册时间戳
    pub registered_at: i64,        // 8
    /// 最后活跃时间戳
    pub last_active_at: i64,       // 8
    /// PDA bump
    pub bump: u8,                  // 1
}

impl AgentRecord {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 8 + 1;

    /// 更新任务完成统计
    pub fn record_task_result(&mut self, success: bool, clock: &Clock) {
        if success {
            self.tasks_completed += 1;
            // 成功：声誉 +1，最多 1000
            self.reputation_score = (self.reputation_score + 1).min(1000);
        } else {
            self.tasks_failed += 1;
            // 失败：声誉 -5，最少 0
            self.reputation_score = self.reputation_score.saturating_sub(5);
        }
        self.last_active_at = clock.unix_timestamp;

        let total = self.tasks_completed + self.tasks_failed;
        if total > 0 {
            self.success_rate_bps = ((self.tasks_completed * 10000) / total) as u16;
        }
    }
}
