// programs/agentproof/src/instructions/witness_sign.rs
use anchor_lang::prelude::*;
use crate::state::{AgentRecord, TaskProof};
use crate::errors::AgentProofError;

#[derive(Accounts)]
#[instruction(task_id: [u8; 32])]
pub struct WitnessSign<'info> {
    #[account(
        mut,
        seeds = [b"proof", task_id.as_ref()],
        bump = task_proof.bump,
        constraint = task_proof.status == 0 @ AgentProofError::ProofAlreadySettled,
    )]
    pub task_proof: Account<'info, TaskProof>,

    #[account(
        mut,
        seeds = [b"agent", task_proof.agent_pubkey.as_ref()],
        bump = agent_record.bump,
    )]
    pub agent_record: Account<'info, AgentRecord>,

    /// 见证节点签名者
    pub witness: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<WitnessSign>,
    task_id: [u8; 32],
    approved: bool,
    _rejection_reason: Option<String>,
) -> Result<()> {
    let clock = Clock::get()?;
    let proof = &mut ctx.accounts.task_proof;
    let witness_key = ctx.accounts.witness.key();

    // 找到该见证节点在列表中的位置
    let witness_idx = proof.witnesses
        .iter()
        .position(|w| *w == witness_key)
        .ok_or(AgentProofError::UnauthorizedWitness)?;

    // 防止重复签名
    require!(
        proof.witness_status[witness_idx] == 0,
        AgentProofError::AlreadySigned
    );

    proof.witness_status[witness_idx] = if approved { 1 } else { 2 };

    if approved {
        proof.signature_count += 1;
    }

    // 检查是否达到 2-of-3 阈值
    if proof.signature_count >= 2 {
        // 验证通过
        proof.status = 1;
        proof.settled_at = clock.unix_timestamp;

        // 更新 Agent 声誉
        ctx.accounts.agent_record.record_task_result(true, &clock);

        emit!(ProofVerified {
            task_id,
            agent_pubkey: proof.agent_pubkey,
            witness_count: proof.signature_count,
            timestamp: clock.unix_timestamp,
        });

        msg!("Proof verified! Task: {:?}", task_id);
    }

    // 检查是否有 2 个拒绝 → 验证失败
    let reject_count = proof.witness_status.iter().filter(|&&s| s == 2).count();
    if reject_count >= 2 {
        proof.status = 2; // rejected
        proof.settled_at = clock.unix_timestamp;

        // 更新 Agent 声誉（失败）
        ctx.accounts.agent_record.record_task_result(false, &clock);

        emit!(ProofRejected {
            task_id,
            agent_pubkey: proof.agent_pubkey,
            timestamp: clock.unix_timestamp,
        });

        msg!("Proof rejected! Task: {:?}", task_id);
    }

    Ok(())
}

#[event]
pub struct ProofVerified {
    pub task_id: [u8; 32],
    pub agent_pubkey: Pubkey,
    pub witness_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct ProofRejected {
    pub task_id: [u8; 32],
    pub agent_pubkey: Pubkey,
    pub timestamp: i64,
}
