// programs/agentproof/src/state/witness_pool.rs
use anchor_lang::prelude::*;

#[account]
pub struct WitnessPool {
    /// 管理员公钥
    pub authority: Pubkey,         // 32
    /// 最低质押要求（lamports）
    pub min_stake_lamports: u64,   // 8
    /// 注册见证节点数量
    pub witness_count: u32,        // 4
    /// PDA bump
    pub bump: u8,                  // 1
}

impl WitnessPool {
    pub const LEN: usize = 8 + 32 + 8 + 4 + 1;
}

#[account]
pub struct WitnessRecord {
    /// 见证节点公钥
    pub witness_pubkey: Pubkey,    // 32
    /// 质押 lamports
    pub staked_lamports: u64,      // 8
    /// 验证次数
    pub verifications: u64,        // 8
    /// 诚实验证次数
    pub honest_count: u64,         // 8
    /// 是否活跃
    pub is_active: bool,           // 1
    /// 注册时间戳
    pub registered_at: i64,        // 8
    /// PDA bump
    pub bump: u8,                  // 1
}

impl WitnessRecord {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1 + 8 + 1;
}
