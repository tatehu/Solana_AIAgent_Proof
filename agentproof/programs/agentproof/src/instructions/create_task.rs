// agentproof/programs/agentproof/src/instructions/create_task.rs
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{AgentRecord, TaskEscrow};
use crate::errors::AgentProofError;

#[derive(Accounts)]
#[instruction(task_id: [u8; 32])]
pub struct CreateTask<'info> {
    #[account(
        init,
        payer = user,
        space = TaskEscrow::LEN,
        seeds = [b"escrow", task_id.as_ref()],
        bump,
    )]
    pub task_escrow: Account<'info, TaskEscrow>,

    #[account(
        seeds = [b"agent", agent_record.agent_pubkey.as_ref()],
        bump = agent_record.bump,
        constraint = !agent_record.is_frozen @ AgentProofError::AgentFrozen,
    )]
    pub agent_record: Account<'info, AgentRecord>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateTask>,
    task_id: [u8; 32],
    agent_pubkey: Pubkey,
    amount_lamports: u64,
    capability_hash: [u8; 32],
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(amount_lamports > 0, AgentProofError::InvalidAmount);
    require!(deadline > clock.unix_timestamp, AgentProofError::TaskExpired);
    require!(
        ctx.accounts.agent_record.capability_hash == capability_hash,
        AgentProofError::CapabilityMismatch
    );

    // Transfer SOL from user to task_escrow PDA
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.user.to_account_info(),
            to: ctx.accounts.task_escrow.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, amount_lamports)?;

    let escrow = &mut ctx.accounts.task_escrow;
    escrow.task_id = task_id;
    escrow.user = ctx.accounts.user.key();
    escrow.agent = agent_pubkey;
    escrow.amount_lamports = amount_lamports;
    escrow.capability_hash = capability_hash;
    escrow.deadline = deadline;
    escrow.status = 0; // locked
    escrow.created_at = clock.unix_timestamp;
    escrow.bump = ctx.bumps.task_escrow;

    emit!(TaskCreated {
        task_id,
        user: escrow.user,
        agent: agent_pubkey,
        amount_lamports,
    });

    Ok(())
}

#[event]
pub struct TaskCreated {
    pub task_id: [u8; 32],
    pub user: Pubkey,
    pub agent: Pubkey,
    pub amount_lamports: u64,
}
