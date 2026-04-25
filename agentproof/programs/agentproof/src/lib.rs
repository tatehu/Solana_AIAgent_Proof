// programs/agentproof/src/lib.rs
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Re-export __client_accounts modules to crate root for #[program] macro
pub use instructions::create_task::*;
pub use instructions::freeze_agent::*;
pub use instructions::initialize_witness_pool::*;
pub use instructions::register_agent::*;
pub use instructions::register_witness::*;
pub use instructions::submit_proof::*;
pub use instructions::witness_sign::*;

declare_id!("GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG"); // 替换为实际 Program ID

/// 风控系统权限账户（部署后替换为实际风控公钥）
pub const RISK_MONITOR_AUTHORITY: Pubkey = pubkey!("RMon111111111111111111111111111111111111111");

#[program]
pub mod agentproof {
    use super::*;

    /// User locks SOL into task escrow for an agent execution
    pub fn create_task(
        ctx: Context<CreateTask>,
        task_id: [u8; 32],
        amount_lamports: u64,
        capability_hash: [u8; 32],
        deadline: i64,
    ) -> Result<()> {
        instructions::create_task::handler(ctx, task_id, amount_lamports, capability_hash, deadline)
    }

    /// 注册 Agent 身份，声明能力，质押 SOL
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        capability_hash: [u8; 32],
        stake_lamports: u64,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, capability_hash, stake_lamports)
    }

    /// Agent 提交任务证明（构建证据包）
    pub fn submit_proof(
        ctx: Context<SubmitProof>,
        params: SubmitProofParams,
    ) -> Result<()> {
        instructions::submit_proof::handler(ctx, params)
    }

    /// 见证节点提交签名（2-of-3 达成后自动结算）
    pub fn witness_sign(
        ctx: Context<WitnessSign>,
        task_id: [u8; 32],
        approved: bool,
        rejection_reason: Option<String>,
    ) -> Result<()> {
        instructions::witness_sign::handler(ctx, task_id, approved, rejection_reason)
    }

    /// AI 风控：冻结恶意 Agent
    pub fn freeze_agent(
        ctx: Context<FreezeAgent>,
        agent_pubkey: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::freeze_agent::handler(ctx, agent_pubkey, reason)
    }

    /// 注册见证节点（质押 SOL）
    pub fn register_witness(
        ctx: Context<RegisterWitness>,
        stake_lamports: u64,
    ) -> Result<()> {
        instructions::register_witness::handler(ctx, stake_lamports)
    }

    /// 初始化见证节点池（管理员操作）
    pub fn initialize_witness_pool(
        ctx: Context<InitializeWitnessPool>,
    ) -> Result<()> {
        instructions::initialize_witness_pool::handler(ctx)
    }
}
