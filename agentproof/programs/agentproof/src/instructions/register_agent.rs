// programs/agentproof/src/instructions/register_agent.rs
use anchor_lang::prelude::*;
use crate::state::AgentRecord;
use crate::errors::AgentProofError;

pub const MIN_STAKE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = payer,
        space = AgentRecord::LEN,
        seeds = [b"agent", agent.key().as_ref()],
        bump
    )]
    pub agent_record: Account<'info, AgentRecord>,

    /// The agent being registered — does NOT need to sign; any pubkey can be registered
    /// CHECK: arbitrary agent pubkey; uniqueness enforced by PDA init
    pub agent: UncheckedAccount<'info>,

    /// The wallet paying rent + stake (the marketplace operator or owner wallet)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: stake vault PDA for this agent
    #[account(
        mut,
        seeds = [b"stake_vault", agent.key().as_ref()],
        bump
    )]
    pub stake_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    capability_hash: [u8; 32],
    stake_lamports: u64,
) -> Result<()> {
    require!(
        stake_lamports >= MIN_STAKE_LAMPORTS,
        AgentProofError::InsufficientStake
    );

    let clock = Clock::get()?;
    let record = &mut ctx.accounts.agent_record;

    record.agent_pubkey = ctx.accounts.agent.key();
    record.capability_hash = capability_hash;
    record.staked_lamports = stake_lamports;
    record.credit_score = AgentRecord::initial_credit(stake_lamports);
    record.safety_index = 50; // neutral until audit-engine updates
    record.tasks_completed = 0;
    record.tasks_failed = 0;
    record.success_rate_bps = 10000; // 初始 100%
    record.is_frozen = false;
    record.registered_at = clock.unix_timestamp;
    record.last_active_at = clock.unix_timestamp;
    record.bump = ctx.bumps.agent_record;

    // 转移质押 SOL 到 vault（payer 出资）
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.payer.key(),
        &ctx.accounts.stake_vault.key(),
        stake_lamports,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.stake_vault.to_account_info(),
        ],
    )?;

    emit!(AgentRegistered {
        agent_pubkey: record.agent_pubkey,
        payer_pubkey: ctx.accounts.payer.key(),
        capability_hash,
        stake_lamports,
        timestamp: clock.unix_timestamp,
    });

    msg!("Agent registered: {} (staked by {})", record.agent_pubkey, ctx.accounts.payer.key());
    Ok(())
}

#[event]
pub struct AgentRegistered {
    pub agent_pubkey: Pubkey,
    pub payer_pubkey: Pubkey,
    pub capability_hash: [u8; 32],
    pub stake_lamports: u64,
    pub timestamp: i64,
}
