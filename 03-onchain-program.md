# 03 — Solana 链上程序（Anchor）

## 初始化项目

```bash
# 前置条件
# - Rust 1.75+
# - Solana CLI 1.18+
# - Anchor CLI 0.30+
# - Node.js 20+

anchor init agentproof
cd agentproof

# 更新 Anchor.toml
# [features]
# seeds = true
# skip-lint = false
```

---

## Cargo.toml

```toml
# programs/agentproof/Cargo.toml
[package]
name = "agentproof"
version = "0.1.0"
description = "AgentProof - Verifiable AI Agent Behavior Oracle on Solana"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "agentproof"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.30.0", features = ["init-if-needed"] }
anchor-spl = { version = "0.30.0", features = ["token_2022", "metadata"] }
spl-token-2022 = { version = "3.0.0", features = ["no-entrypoint"] }
```

---

## lib.rs（程序入口）

```rust
// programs/agentproof/src/lib.rs
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("AgPr111111111111111111111111111111111111111"); // 替换为实际 Program ID

#[program]
pub mod agentproof {
    use super::*;

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
```

---

## state/agent_record.rs

```rust
// programs/agentproof/src/state/agent_record.rs
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct AgentRecord {
    /// Agent 钱包公钥
    pub agent_pubkey: Pubkey,      // 32
    /// 能力声明哈希（对应链下 JSON capability manifest）
    pub capability_hash: [u8; 32], // 32
    /// 质押 lamports（保证金）
    pub staked_lamports: u64,      // 8
    /// 声誉积分（0-1000，不可转让 SBT 同步）
    pub reputation_score: u64,     // 8
    /// 总完成任务数
    pub tasks_completed: u64,      // 8
    /// 总失败任务数
    pub tasks_failed: u64,         // 8
    /// 成功率（basis points，10000 = 100%）
    pub success_rate_bps: u16,     // 2
    /// 是否被冻结
    pub is_frozen: bool,           // 1
    /// 注册时间戳
    pub registered_at: i64,        // 8
    /// 最后活跃时间戳
    pub last_active_at: i64,       // 8
    /// PDA bump
    pub bump: u8,                  // 1
}

impl AgentRecord {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 8 + 1;

    /// 更新任务完成统计
    pub fn record_task_result(&mut self, success: bool, clock: &Clock) {
        if success {
            self.tasks_completed += 1;
            // 成功：声誉 +1，最多 1000
            self.reputation_score = (self.reputation_score + 1).min(1000);
        } else {
            self.tasks_failed += 1;
            // 失败：声誉 -5，最少 0
            self.reputation_score = self.reputation_score.saturating_sub(5);
        }
        self.last_active_at = clock.unix_timestamp;

        let total = self.tasks_completed + self.tasks_failed;
        if total > 0 {
            self.success_rate_bps = ((self.tasks_completed * 10000) / total) as u16;
        }
    }
}
```

---

## state/task_proof.rs

```rust
// programs/agentproof/src/state/task_proof.rs
use anchor_lang::prelude::*;

#[account]
pub struct TaskProof {
    /// 唯一任务 ID（32字节，由 Agent 生成）
    pub task_id: [u8; 32],          // 32
    /// 执行 Agent 公钥
    pub agent_pubkey: Pubkey,       // 32
    /// 用户原始指令哈希（防提示词注入）
    pub instruction_hash: [u8; 32], // 32
    /// 输入参数哈希
    pub input_hash: [u8; 32],       // 32
    /// 输出结果哈希
    pub output_hash: [u8; 32],      // 32
    /// 关联链上交易签名（核心可信锚点）
    pub tx_signature: [u8; 64],     // 64
    /// 执行时 Slot
    pub slot: u64,                  // 8
    /// 任务类型（枚举字节）
    pub task_type: u8,              // 1
    /// 见证节点公钥（最多3个）
    pub witnesses: [Pubkey; 3],     // 96
    /// 见证节点签名
    pub witness_signatures: [[u8; 64]; 3], // 192
    /// 见证节点签名状态（0=待签 1=通过 2=拒绝）
    pub witness_status: [u8; 3],    // 3
    /// 已收到的有效签名数
    pub signature_count: u8,        // 1
    /// 验证状态（0=pending 1=verified 2=rejected 3=timeout）
    pub status: u8,                 // 1
    /// 提交时间戳
    pub submitted_at: i64,          // 8
    /// 结算时间戳
    pub settled_at: i64,            // 8
    /// PDA bump
    pub bump: u8,                   // 1
}

impl TaskProof {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 32 + 32 + 32 + 64 + 8 + 1 + 96 + 192 + 3 + 1 + 1 + 8 + 8 + 1;

    pub fn is_verified(&self) -> bool {
        self.status == 1
    }

    pub fn is_rejected(&self) -> bool {
        self.status == 2
    }

    /// 检查是否达到 2-of-3 阈值
    pub fn has_threshold(&self) -> bool {
        self.signature_count >= 2
    }
}

/// 任务类型枚举
pub mod task_type {
    pub const SOLANA_SWAP: u8 = 1;
    pub const DATA_ANALYSIS: u8 = 2;
    pub const REPORT_GENERATION: u8 = 3;
    pub const DEFI_OPERATION: u8 = 4;
    pub const CUSTOM: u8 = 255;
}
```

---

## state/witness_pool.rs

```rust
// programs/agentproof/src/state/witness_pool.rs
use anchor_lang::prelude::*;

#[account]
pub struct WitnessPool {
    /// 管理员公钥
    pub authority: Pubkey,         // 32
    /// 最低质押要求（lamports）
    pub min_stake_lamports: u64,   // 8
    /// 注册见证节点数量
    pub witness_count: u32,        // 4
    /// PDA bump
    pub bump: u8,                  // 1
}

impl WitnessPool {
    pub const LEN: usize = 8 + 32 + 8 + 4 + 1;
}

#[account]
pub struct WitnessRecord {
    /// 见证节点公钥
    pub witness_pubkey: Pubkey,    // 32
    /// 质押 lamports
    pub staked_lamports: u64,      // 8
    /// 验证次数
    pub verifications: u64,        // 8
    /// 诚实验证次数
    pub honest_count: u64,         // 8
    /// 是否活跃
    pub is_active: bool,           // 1
    /// 注册时间戳
    pub registered_at: i64,        // 8
    /// PDA bump
    pub bump: u8,                  // 1
}

impl WitnessRecord {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1 + 8 + 1;
}
```

---

## instructions/register_agent.rs

```rust
// programs/agentproof/src/instructions/register_agent.rs
use anchor_lang::prelude::*;
use crate::state::AgentRecord;
use crate::errors::AgentProofError;

pub const MIN_STAKE_LAMPORTS: u64 = 100_000_000; // 0.1 SOL

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = agent,
        space = AgentRecord::LEN,
        seeds = [b"agent", agent.key().as_ref()],
        bump
    )]
    pub agent_record: Account<'info, AgentRecord>,

    #[account(mut)]
    pub agent: Signer<'info>,

    /// CHECK: 质押金存储账户（系统程序 PDA）
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
    record.reputation_score = 100; // 初始声誉 100
    record.tasks_completed = 0;
    record.tasks_failed = 0;
    record.success_rate_bps = 10000; // 初始 100%
    record.is_frozen = false;
    record.registered_at = clock.unix_timestamp;
    record.last_active_at = clock.unix_timestamp;
    record.bump = ctx.bumps.agent_record;

    // 转移质押 SOL 到 vault
    let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
        &ctx.accounts.agent.key(),
        &ctx.accounts.stake_vault.key(),
        stake_lamports,
    );
    anchor_lang::solana_program::program::invoke(
        &transfer_ix,
        &[
            ctx.accounts.agent.to_account_info(),
            ctx.accounts.stake_vault.to_account_info(),
        ],
    )?;

    emit!(AgentRegistered {
        agent_pubkey: record.agent_pubkey,
        capability_hash,
        stake_lamports,
        timestamp: clock.unix_timestamp,
    });

    msg!("Agent registered: {}", record.agent_pubkey);
    Ok(())
}

#[event]
pub struct AgentRegistered {
    pub agent_pubkey: Pubkey,
    pub capability_hash: [u8; 32],
    pub stake_lamports: u64,
    pub timestamp: i64,
}
```

---

## instructions/submit_proof.rs

```rust
// programs/agentproof/src/instructions/submit_proof.rs
use anchor_lang::prelude::*;
use crate::state::{AgentRecord, TaskProof, WitnessPool, WitnessRecord};
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
```

---

## instructions/witness_sign.rs

```rust
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
```

---

## instructions/freeze_agent.rs

```rust
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
```

---

## errors.rs

```rust
// programs/agentproof/src/errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum AgentProofError {
    #[msg("Agent is frozen and cannot perform actions")]
    AgentFrozen,

    #[msg("Agent is already frozen")]
    AgentAlreadyFrozen,

    #[msg("Insufficient stake amount (minimum 0.1 SOL)")]
    InsufficientStake,

    #[msg("Proof has already been settled")]
    ProofAlreadySettled,

    #[msg("Witness is not authorized for this task")]
    UnauthorizedWitness,

    #[msg("Witness has already signed this proof")]
    AlreadySigned,

    #[msg("Unauthorized freeze authority")]
    UnauthorizedFreezeAuthority,

    #[msg("Witness pool is full")]
    WitnessPoolFull,

    #[msg("Task proof not found")]
    ProofNotFound,

    #[msg("Invalid task type")]
    InvalidTaskType,
}
```

---

## lib.rs 补充常量

```rust
// 在 lib.rs 顶部添加
pub const RISK_MONITOR_AUTHORITY: Pubkey = anchor_lang::solana_program::pubkey!(
    "RMon111111111111111111111111111111111111111" // 替换为实际风控权限公钥
);
```

---

## 构建与部署

```bash
# 构建
anchor build

# 获取 Program ID
solana address -k target/deploy/agentproof-keypair.json

# 更新 declare_id! 和 Anchor.toml 中的 program id

# 部署到 Devnet
anchor deploy --provider.cluster devnet

# 运行测试
anchor test
```

---

## tests/agentproof.ts（Anchor 集成测试）

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Agentproof } from "../target/types/agentproof";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

describe("agentproof", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Agentproof as Program<Agentproof>;

  const agent = Keypair.generate();
  const witness1 = Keypair.generate();
  const witness2 = Keypair.generate();
  const witness3 = Keypair.generate();

  const taskId = crypto.randomBytes(32);
  const capabilityHash = crypto.randomBytes(32);

  before(async () => {
    // 给测试账户充值
    for (const kp of [agent, witness1, witness2, witness3]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  it("registers an agent", async () => {
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );
    const [stakeVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault"), agent.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerAgent(
        Array.from(capabilityHash),
        new anchor.BN(0.1 * LAMPORTS_PER_SOL)
      )
      .accounts({
        agentRecord,
        agent: agent.publicKey,
        stakeVault,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    const record = await program.account.agentRecord.fetch(agentRecord);
    expect(record.agentPubkey.toString()).to.equal(agent.publicKey.toString());
    expect(record.reputationScore.toNumber()).to.equal(100);
    expect(record.isFrozen).to.equal(false);
    console.log("✓ Agent registered with reputation:", record.reputationScore.toNumber());
  });

  it("submits a task proof", async () => {
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );
    const [taskProof] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskId],
      program.programId
    );
    const [witnessPool] = PublicKey.findProgramAddressSync(
      [Buffer.from("witness_pool")],
      program.programId
    );

    const params = {
      taskId: Array.from(taskId),
      instructionHash: Array.from(crypto.randomBytes(32)),
      inputHash: Array.from(crypto.randomBytes(32)),
      outputHash: Array.from(crypto.randomBytes(32)),
      txSignature: Array.from(crypto.randomBytes(64)),
      slot: new anchor.BN(1000),
      taskType: 1, // SOLANA_SWAP
      witnesses: [witness1.publicKey, witness2.publicKey, witness3.publicKey],
    };

    await program.methods
      .submitProof(params)
      .accounts({
        taskProof,
        agentRecord,
        witnessPool,
        agent: agent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();

    const proof = await program.account.taskProof.fetch(taskProof);
    expect(proof.status).to.equal(0); // pending
    console.log("✓ Proof submitted, status: pending");
  });

  it("witnesses sign and proof reaches threshold", async () => {
    const [taskProof] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskId],
      program.programId
    );
    const [agentRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), agent.publicKey.toBuffer()],
      program.programId
    );

    // witness1 签名
    await program.methods
      .witnessSign(Array.from(taskId), true, null)
      .accounts({ taskProof, agentRecord, witness: witness1.publicKey })
      .signers([witness1])
      .rpc();

    // witness2 签名 → 达到 2-of-3 阈值
    await program.methods
      .witnessSign(Array.from(taskId), true, null)
      .accounts({ taskProof, agentRecord, witness: witness2.publicKey })
      .signers([witness2])
      .rpc();

    const proof = await program.account.taskProof.fetch(taskProof);
    expect(proof.status).to.equal(1); // verified
    expect(proof.signatureCount).to.equal(2);

    const record = await program.account.agentRecord.fetch(agentRecord);
    expect(record.tasksCompleted.toNumber()).to.equal(1);
    console.log("✓ Proof verified! Agent reputation:", record.reputationScore.toNumber());
  });
});
```
