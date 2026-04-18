// programs/agentproof/src/instructions/freeze_agent.rs
use anchor_lang::prelude::*;
use crate::state::AgentRecord;
use crate::errors::AgentProofError;

#[derive(Accounts)]
#[instruction(agent_pubkey: Pubkey)]
pub struct FreezeAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent_pubkey.as_ref()],
        bump = agent_record.bump,
    )]
    pub agent_record: Account<'info, AgentRecord>,

    /// 风控系统权限账户（预设为部署者）
    /// 生产环境应替换为多签或 DAO
    #[account(
        constraint = authority.key() == crate::RISK_MONITOR_AUTHORITY
            @ AgentProofError::UnauthorizedFreezeAuthority
    )]
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<FreezeAgent>,
    agent_pubkey: Pubkey,
    reason: String,
) -> Result<()> {
    let clock = Clock::get()?;
    let record = &mut ctx.accounts.agent_record;

    require!(!record.is_frozen, AgentProofError::AgentAlreadyFrozen);

    record.is_frozen = true;
    record.last_active_at = clock.unix_timestamp;

    emit!(AgentFrozen {
        agent_pubkey,
        reason: reason.clone(),
        timestamp: clock.unix_timestamp,
    });

    msg!("Agent frozen: {} - Reason: {}", agent_pubkey, reason);
    Ok(())
}

#[event]
pub struct AgentFrozen {
    pub agent_pubkey: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}
