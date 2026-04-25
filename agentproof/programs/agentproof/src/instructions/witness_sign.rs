// agentproof/programs/agentproof/src/instructions/witness_sign.rs
use anchor_lang::prelude::*;
use crate::state::{AgentRecord, TaskEscrow, TaskProof};
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

    /// Optional: TaskEscrow for fund settlement (may not exist for all tasks)
    #[account(
        mut,
        seeds = [b"escrow", task_id.as_ref()],
        bump,
    )]
    pub task_escrow: Option<Account<'info, TaskEscrow>>,

    /// Agent wallet to receive funds on approval
    /// CHECK: destination wallet, verified against task_escrow.agent
    #[account(mut)]
    pub agent_wallet: Option<AccountInfo<'info>>,

    /// User wallet to receive refund on rejection
    /// CHECK: destination wallet, verified against task_escrow.user
    #[account(mut)]
    pub user_wallet: Option<AccountInfo<'info>>,

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

    let witness_idx = proof.witnesses
        .iter()
        .position(|w| *w == witness_key)
        .ok_or(AgentProofError::UnauthorizedWitness)?;

    require!(
        proof.witness_status[witness_idx] == 0,
        AgentProofError::AlreadySigned
    );

    proof.witness_status[witness_idx] = if approved { 1 } else { 2 };

    if approved {
        proof.signature_count += 1;
    }

    // Check 2-of-3 approval threshold
    if proof.signature_count >= 2 {
        proof.status = 1;
        proof.settled_at = clock.unix_timestamp;

        ctx.accounts.agent_record.update_ewma(100, &clock);

        // Settle escrow if present
        if let (Some(escrow), Some(agent_wallet), Some(_user_wallet)) = (
            ctx.accounts.task_escrow.as_mut(),
            ctx.accounts.agent_wallet.as_ref(),
            ctx.accounts.user_wallet.as_ref(),
        ) {
            require!(escrow.status == 0, AgentProofError::TaskAlreadySettled);
            let amount = escrow.amount_lamports;
            **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
            **agent_wallet.try_borrow_mut_lamports()? += amount;
            escrow.status = 1;

            emit!(crate::instructions::settle_task::TaskSettled {
                task_id,
                approved: true,
                amount_lamports: amount,
            });
        }

        emit!(ProofVerified {
            task_id,
            agent_pubkey: proof.agent_pubkey,
            witness_count: proof.signature_count,
            timestamp: clock.unix_timestamp,
        });

        msg!("Proof verified! Task: {:?}", task_id);
    }

    // Check 2-of-3 rejection threshold
    let reject_count = proof.witness_status.iter().filter(|&&s| s == 2).count();
    if reject_count >= 2 {
        proof.status = 2;
        proof.settled_at = clock.unix_timestamp;

        ctx.accounts.agent_record.update_ewma(0, &clock);

        // Refund escrow if present
        if let (Some(escrow), Some(_agent_wallet), Some(user_wallet)) = (
            ctx.accounts.task_escrow.as_mut(),
            ctx.accounts.agent_wallet.as_ref(),
            ctx.accounts.user_wallet.as_ref(),
        ) {
            require!(escrow.status == 0, AgentProofError::TaskAlreadySettled);
            let amount = escrow.amount_lamports;
            **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
            **user_wallet.try_borrow_mut_lamports()? += amount;
            escrow.status = 2;

            emit!(crate::instructions::settle_task::TaskSettled {
                task_id,
                approved: false,
                amount_lamports: amount,
            });
        }

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
