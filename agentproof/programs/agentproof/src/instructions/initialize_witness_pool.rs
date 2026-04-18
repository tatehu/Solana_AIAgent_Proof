// programs/agentproof/src/instructions/initialize_witness_pool.rs
use anchor_lang::prelude::*;
use crate::state::WitnessPool;

#[derive(Accounts)]
pub struct InitializeWitnessPool<'info> {
    #[account(
        init,
        payer = authority,
        space = WitnessPool::LEN,
        seeds = [b"witness_pool"],
        bump
    )]
    pub witness_pool: Account<'info, WitnessPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeWitnessPool>) -> Result<()> {
    let pool = &mut ctx.accounts.witness_pool;

    pool.authority = ctx.accounts.authority.key();
    pool.min_stake_lamports = 100_000_000; // 0.1 SOL
    pool.witness_count = 0;
    pool.bump = ctx.bumps.witness_pool;

    msg!("WitnessPool initialized by {}", pool.authority);
    Ok(())
}
