// programs/agentproof/src/instructions/submit_proof.rs
use anchor_lang::prelude::*;
use crate::state::{AgentRecord, TaskProof, WitnessPool};
use crate::errors::AgentProofError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitProofParams {
    pub task_id: [u8; 32],
    pub instruction_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub tx_signature: [u8; 64],
    pub slot: u64,
    pub task_type: u8,
    /// 选定的 3 个见证节点公钥
    pub witnesses: [Pubkey; 3],
}

#[derive(Accounts)]
#[instruction(params: SubmitProofParams)]
pub struct SubmitProof<'info> {
    #[account(
        init,
        payer = agent,
        space = TaskProof::LEN,
        seeds = [b"proof", params.task_id.as_ref()],
        bump
    )]
    pub task_proof: Account<'info, TaskProof>,

    #[account(
        mut,
        seeds = [b"agent", agent.key().as_ref()],
        bump = agent_record.bump,
        constraint = !agent_record.is_frozen @ AgentProofError::AgentFrozen,
    )]
    pub agent_record: Account<'info, AgentRecord>,

    #[account(
        seeds = [b"witness_pool"],
        bump = witness_pool.bump,
    )]
    pub witness_pool: Account<'info, WitnessPool>,

    #[account(mut)]
    pub agent: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SubmitProof>, params: SubmitProofParams) -> Result<()> {
    let clock = Clock::get()?;
    let proof = &mut ctx.accounts.task_proof;

    proof.task_id = params.task_id;
    proof.agent_pubkey = ctx.accounts.agent.key();
    proof.instruction_hash = params.instruction_hash;
    proof.input_hash = params.input_hash;
    proof.output_hash = params.output_hash;
    proof.tx_signature = params.tx_signature;
    proof.slot = params.slot;
    proof.task_type = params.task_type;
    proof.witnesses = params.witnesses;
    proof.witness_signatures = [[0u8; 64]; 3];
    proof.witness_status = [0u8; 3];
    proof.signature_count = 0;
    proof.status = 0; // pending
    proof.submitted_at = clock.unix_timestamp;
    proof.settled_at = 0;
    proof.bump = ctx.bumps.task_proof;

    emit!(ProofSubmitted {
        task_id: params.task_id,
        agent_pubkey: ctx.accounts.agent.key(),
        tx_signature: params.tx_signature,
        witnesses: params.witnesses,
        timestamp: clock.unix_timestamp,
    });

    msg!("Proof submitted for task: {:?}", params.task_id);
    Ok(())
}

#[event]
pub struct ProofSubmitted {
    pub task_id: [u8; 32],
    pub agent_pubkey: Pubkey,
    pub tx_signature: [u8; 64],
    pub witnesses: [Pubkey; 3],
    pub timestamp: i64,
}
