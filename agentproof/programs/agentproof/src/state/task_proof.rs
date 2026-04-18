// programs/agentproof/src/state/task_proof.rs
use anchor_lang::prelude::*;

#[account]
pub struct TaskProof {
    /// 唯一任务 ID（32字节，由 Agent 生成）
    pub task_id: [u8; 32],          // 32
    /// 执行 Agent 公钥
    pub agent_pubkey: Pubkey,       // 32
    /// 用户原始指令哈希（防提示词注入）
    pub instruction_hash: [u8; 32], // 32
    /// 输入参数哈希
    pub input_hash: [u8; 32],       // 32
    /// 输出结果哈希
    pub output_hash: [u8; 32],      // 32
    /// 关联链上交易签名（核心可信锚点）
    pub tx_signature: [u8; 64],     // 64
    /// 执行时 Slot
    pub slot: u64,                  // 8
    /// 任务类型（枚举字节）
    pub task_type: u8,              // 1
    /// 见证节点公钥（最多3个）
    pub witnesses: [Pubkey; 3],     // 96
    /// 见证节点签名
    pub witness_signatures: [[u8; 64]; 3], // 192
    /// 见证节点签名状态（0=待签 1=通过 2=拒绝）
    pub witness_status: [u8; 3],    // 3
    /// 已收到的有效签名数
    pub signature_count: u8,        // 1
    /// 验证状态（0=pending 1=verified 2=rejected 3=timeout）
    pub status: u8,                 // 1
    /// 提交时间戳
    pub submitted_at: i64,          // 8
    /// 结算时间戳
    pub settled_at: i64,            // 8
    /// PDA bump
    pub bump: u8,                   // 1
}

impl TaskProof {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 32 + 32 + 32 + 64 + 8 + 1 + 96 + 192 + 3 + 1 + 1 + 8 + 8 + 1;

    pub fn is_verified(&self) -> bool {
        self.status == 1
    }

    pub fn is_rejected(&self) -> bool {
        self.status == 2
    }

    /// 检查是否达到 2-of-3 阈值
    pub fn has_threshold(&self) -> bool {
        self.signature_count >= 2
    }
}

/// 任务类型枚举
pub mod task_type {
    pub const SOLANA_SWAP: u8 = 1;
    pub const DATA_ANALYSIS: u8 = 2;
    pub const REPORT_GENERATION: u8 = 3;
    pub const DEFI_OPERATION: u8 = 4;
    pub const CUSTOM: u8 = 255;
}
