// agentproof/programs/agentproof/src/state/task_escrow.rs
use anchor_lang::prelude::*;

#[account]
pub struct TaskEscrow {
    pub task_id: [u8; 32],
    pub user: Pubkey,
    pub agent: Pubkey,
    pub amount_lamports: u64,
    pub capability_hash: [u8; 32],
    pub deadline: i64,
    pub status: u8,       // 0=locked 1=released 2=refunded
    pub created_at: i64,
    pub bump: u8,
}

impl TaskEscrow {
    pub const LEN: usize = 8      // discriminator
        + 32   // task_id
        + 32   // user
        + 32   // agent
        + 8    // amount_lamports
        + 32   // capability_hash
        + 8    // deadline
        + 1    // status
        + 8    // created_at
        + 1;   // bump
}
