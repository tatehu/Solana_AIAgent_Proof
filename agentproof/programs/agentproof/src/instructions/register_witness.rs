// programs/agentproof/src/instructions/register_witness.rs
use anchor_lang::prelude::*;
use crate::state::{WitnessPool, WitnessRecord};
use crate::errors::AgentProofError;

#[derive(Accounts)]
pub struct RegisterWitness<'info> {
    #[account(
        init,
        payer = witness,
        space = WitnessRecord::LEN,
        seeds = [b"witness", witness.key().as_ref()],
        bump
    )]
    pub witness_record: Account<'info, WitnessRecord>,

    #[account(
        mut,
        seeds = [b"witness_pool"],
        bump = witness_pool.bump,
    )]
    pub witness_pool: Account<'info, WitnessPool>,

    #[account(mut)]
    pub witness: Signer<'info>,

    /// CHECK: 质押金 vault
    #[account(
        mut,
        seeds = [b"witness_stake", witness.key().as_ref()],
        bump
    )]
    pub stake_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterWitness>, stake_lamports: u64) -> Result<()> {
    let pool = &ctx.accounts.witness_pool;
    require!(
        stake_lamports >= pool.min_stake_lamports,
        AgentProofError::InsufficientStake
    );

    let clock = Clock::get()?;
    let record = &mut ctx.accounts.witness_record;

    record.witness_pubkey = ctx.accounts.witness.key();
    record.staked_lamports = stake_lamports;
    record.verifications = 0;
    record.honest_count = 0;
    record.is_active = true;
    record.registered_at = clock.unix_timestamp;
    record.bump = ctx.bumps.witness_record;

    // 转移质押
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.witness.key(),
        &ctx.accounts.stake_vault.key(),
        stake_lamports,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.witness.to_account_info(),
            ctx.accounts.stake_vault.to_account_info(),
        ],
    )?;

    // 更新池计数
    ctx.accounts.witness_pool.witness_count += 1;

    msg!("Witness registered: {}", record.witness_pubkey);
    Ok(())
}
