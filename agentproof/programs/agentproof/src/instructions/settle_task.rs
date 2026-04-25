// agentproof/programs/agentproof/src/instructions/settle_task.rs
use anchor_lang::prelude::*;
use crate::state::TaskEscrow;
use crate::errors::AgentProofError;

/// Transfer lamports out of TaskEscrow PDA (uses PDA signer seeds)
pub fn release_escrow<'info>(
    task_escrow: &mut Account<'info, TaskEscrow>,
    destination: &AccountInfo<'info>,
    _seeds: &[&[&[u8]]],
) -> Result<()> {
    let amount = task_escrow.amount_lamports;
    **task_escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **destination.try_borrow_mut_lamports()? += amount;
    Ok(())
}

/// Called inline from witness_sign after threshold is reached
pub fn settle_task_inline(
    task_escrow: &mut Account<TaskEscrow>,
    agent_wallet: &AccountInfo,
    user_wallet: &AccountInfo,
    approved: bool,
    _bump: u8,
    task_id: [u8; 32],
) -> Result<()> {
    require!(task_escrow.status == 0, AgentProofError::TaskAlreadySettled);

    let amount = task_escrow.amount_lamports;

    if approved {
        // Release to agent
        **task_escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **agent_wallet.try_borrow_mut_lamports()? += amount;
        task_escrow.status = 1;
    } else {
        // Refund to user
        **task_escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **user_wallet.try_borrow_mut_lamports()? += amount;
        task_escrow.status = 2;
    }

    emit!(TaskSettled {
        task_id,
        approved,
        amount_lamports: amount,
    });

    Ok(())
}

#[event]
pub struct TaskSettled {
    pub task_id: [u8; 32],
    pub approved: bool,
    pub amount_lamports: u64,
}
