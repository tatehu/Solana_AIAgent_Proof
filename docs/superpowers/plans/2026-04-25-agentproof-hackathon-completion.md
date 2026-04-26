# AgentProof Hackathon Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the minimum viable demo loop: TaskEscrow escrow → Helius+Claude registration audit → LLM intent verification → EWMA credit scoring → on-chain freeze, proving AgentProof's full lifecycle trust value proposition.

**Architecture:** P0 contract changes (TaskEscrow + EWMA) enable fund lockup and new credit scoring. P1 audit-engine (new Node.js service, port 3002) audits agent history at registration using Helius + Claude. P2 IntentVerifier layer in witness-node adds Claude judgment after on-chain verification. P3 ChainFreezer makes risk-monitor actually call freeze_agent on-chain. P4 frontend surfaces all results.

**Tech Stack:** Rust/Anchor (Solana contract), Node.js/TypeScript (witness-node, audit-engine), Python/FastAPI (risk-monitor), Next.js/React (frontend), Claude API (via ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL proxy), Helius API

---

## File Map

### New Files
- `agentproof/programs/agentproof/src/state/task_escrow.rs` — TaskEscrow PDA account definition
- `agentproof/programs/agentproof/src/instructions/create_task.rs` — create_task instruction
- `agentproof/programs/agentproof/src/instructions/settle_task.rs` — settle_task logic (called from witness_sign)
- `agentproof/audit-engine/src/index.ts` — Express entry point, port 3002
- `agentproof/audit-engine/src/helius-fetcher.ts` — Helius historical tx fetch
- `agentproof/audit-engine/src/tx-summarizer.ts` — parse txs into structured summary
- `agentproof/audit-engine/src/claude-auditor.ts` — Claude API audit call
- `agentproof/audit-engine/src/manifest-store.ts` — capability_manifest storage (memory + file)
- `agentproof/audit-engine/src/routes.ts` — API routes (/audit, /manifest)
- `agentproof/audit-engine/package.json`
- `agentproof/audit-engine/tsconfig.json`
- `agentproof/audit-engine/.env.example`
- `agentproof/witness-node/src/intent-verifier.ts` — IntentVerifier class
- `agentproof/risk-monitor/chain_freezer.py` — ChainFreezer class

### Modified Files
- `agentproof/programs/agentproof/src/state/agent_record.rs` — add credit_score(0-100 EWMA), safety_index, remove reputation_score
- `agentproof/programs/agentproof/src/state/mod.rs` — export TaskEscrow
- `agentproof/programs/agentproof/src/instructions/mod.rs` — export create_task, settle_task
- `agentproof/programs/agentproof/src/instructions/witness_sign.rs` — call settle_task on threshold
- `agentproof/programs/agentproof/src/errors.rs` — add 6 new error codes
- `agentproof/programs/agentproof/src/lib.rs` — register create_task instruction
- `agentproof/witness-node/src/types.ts` — add IntentResult, IntentVerifyParams
- `agentproof/witness-node/src/verifier.ts` — return txSummary in verify result
- `agentproof/witness-node/src/api.ts` — integrate IntentVerifier after ChainVerifier
- `agentproof/risk-monitor/api/routes.py` — call ChainFreezer.freeze_on_chain()
- `agentproof/app/src/app/register/page.tsx` — show audit results after registration
- `agentproof/app/src/app/verify/page.tsx` — show intent judgment result
- `agentproof/app/src/app/agent/[pubkey]/page.tsx` — show credit_score instead of reputation_score

---

## Task 1: TaskEscrow PDA State (P0)

**Files:**
- Create: `agentproof/programs/agentproof/src/state/task_escrow.rs`
- Modify: `agentproof/programs/agentproof/src/state/mod.rs`

- [ ] **Step 1: Create task_escrow.rs**

```rust
// agentproof/programs/agentproof/src/state/task_escrow.rs
use anchor_lang::prelude::*;

#[account]
pub struct TaskEscrow {
    pub task_id: [u8; 32],
    pub user: Pubkey,
    pub agent: Pubkey,
    pub amount_lamports: u64,
    pub capability_hash: [u8; 32],
    pub deadline: i64,
    pub status: u8,       // 0=locked 1=released 2=refunded
    pub created_at: i64,
    pub bump: u8,
}

impl TaskEscrow {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 32 + 8 + 1 + 8 + 1;
}
```

- [ ] **Step 2: Add to state/mod.rs**

Replace the content of `agentproof/programs/agentproof/src/state/mod.rs`:
```rust
pub mod agent_record;
pub mod task_escrow;
pub mod task_proof;
pub mod witness_pool;

pub use agent_record::AgentRecord;
pub use task_escrow::TaskEscrow;
pub use task_proof::{TaskProof, task_type};
pub use witness_pool::{WitnessPool, WitnessRecord};
```

- [ ] **Step 3: Verify the contract still compiles**

Run: `cd agentproof && cargo build-sbf 2>&1 | tail -5`
Expected: `Finished` or only warnings, no errors

- [ ] **Step 4: Commit**

```bash
cd agentproof
git add programs/agentproof/src/state/task_escrow.rs programs/agentproof/src/state/mod.rs
git commit -m "feat: add TaskEscrow PDA state"
```

---

## Task 2: EWMA Credit Score in AgentRecord (P0)

**Files:**
- Modify: `agentproof/programs/agentproof/src/state/agent_record.rs`

- [ ] **Step 1: Replace agent_record.rs with EWMA logic**

Replace the full content of `agentproof/programs/agentproof/src/state/agent_record.rs`:

```rust
// agentproof/programs/agentproof/src/state/agent_record.rs
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct AgentRecord {
    pub agent_pubkey: Pubkey,
    pub capability_hash: [u8; 32],
    pub staked_lamports: u64,
    /// EWMA credit score 0–100 (replaces reputation_score 0–1000)
    pub credit_score: u64,
    /// Safety index from audit-engine 0–100
    pub safety_index: u64,
    pub tasks_completed: u64,
    pub tasks_failed: u64,
    pub success_rate_bps: u16,
    pub is_frozen: bool,
    pub registered_at: i64,
    pub last_active_at: i64,
    pub bump: u8,
}

impl AgentRecord {
    pub const LEN: usize = 8 + // discriminator
        32 + 32 + 8 + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 8 + 1;

    /// EWMA: new = 0.80 * old + 0.20 * task_score (integer arithmetic × 100)
    pub fn update_ewma(&mut self, task_score: u64, clock: &Clock) {
        self.credit_score = (self.credit_score * 80 + task_score * 20) / 100;
        self.last_active_at = clock.unix_timestamp;

        if task_score >= 50 {
            self.tasks_completed += 1;
        } else {
            self.tasks_failed += 1;
        }
        let total = self.tasks_completed + self.tasks_failed;
        if total > 0 {
            self.success_rate_bps = ((self.tasks_completed * 10000) / total) as u16;
        }
    }

    /// Stake-weighted initial credit score
    pub fn initial_credit(stake_lamports: u64) -> u64 {
        let base = 50u64;
        if stake_lamports >= 5_000_000_000 {
            base + 10
        } else if stake_lamports >= 1_000_000_000 {
            base + 5
        } else {
            base
        }
    }

    /// Kept for backward compat — delegates to update_ewma
    pub fn record_task_result(&mut self, success: bool, clock: &Clock) {
        self.update_ewma(if success { 100 } else { 0 }, clock);
    }
}
```

- [ ] **Step 2: Update register_agent.rs to set initial credit_score**

Open `agentproof/programs/agentproof/src/instructions/register_agent.rs`. Find the line that sets `reputation_score` and replace it:

Old:
```rust
agent_record.reputation_score = 100;
```

New:
```rust
agent_record.credit_score = AgentRecord::initial_credit(stake_lamports);
agent_record.safety_index = 50; // neutral until audit-engine updates
```

- [ ] **Step 3: Verify build**

Run: `cd agentproof && cargo build-sbf 2>&1 | grep -E 'error|warning.*unused' | head -20`
Expected: No `error` lines. There may be warnings about unused `reputation_score` references — fix any compile errors.

- [ ] **Step 4: Fix any remaining reputation_score references**

Run: `grep -r "reputation_score" agentproof/programs/ --include="*.rs"`

Replace any remaining references:
- `agent_record.reputation_score` → `agent_record.credit_score`

- [ ] **Step 5: Commit**

```bash
cd agentproof
git add programs/agentproof/src/state/agent_record.rs programs/agentproof/src/instructions/register_agent.rs
git commit -m "feat: replace reputation_score with EWMA credit_score (0-100)"
```

---

## Task 3: New Error Codes (P0)

**Files:**
- Modify: `agentproof/programs/agentproof/src/errors.rs`

- [ ] **Step 1: Add 6 new error codes to errors.rs**

Append to the existing `AgentProofError` enum (before the closing `}`):

```rust
    #[msg("Task not found")]
    TaskNotFound,

    #[msg("Task has already been settled")]
    TaskAlreadySettled,

    #[msg("Task deadline has passed")]
    TaskExpired,

    #[msg("Task deadline has not passed yet")]
    TaskNotExpired,

    #[msg("Capability hash does not match agent record")]
    CapabilityMismatch,

    #[msg("Amount must be greater than zero")]
    InvalidAmount,
```

- [ ] **Step 2: Verify build**

Run: `cd agentproof && cargo build-sbf 2>&1 | grep '^error' | head -5`
Expected: No output

- [ ] **Step 3: Commit**

```bash
cd agentproof
git add programs/agentproof/src/errors.rs
git commit -m "feat: add TaskEscrow error codes"
```

---

## Task 4: create_task Instruction (P0)

**Files:**
- Create: `agentproof/programs/agentproof/src/instructions/create_task.rs`
- Modify: `agentproof/programs/agentproof/src/instructions/mod.rs`
- Modify: `agentproof/programs/agentproof/src/lib.rs`

- [ ] **Step 1: Create create_task.rs**

```rust
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
```

- [ ] **Step 2: Add to instructions/mod.rs**

Append to `agentproof/programs/agentproof/src/instructions/mod.rs`:
```rust
pub mod create_task;

pub use create_task::CreateTask;
```

- [ ] **Step 3: Register in lib.rs**

Add these lines to `agentproof/programs/agentproof/src/lib.rs`:

After the existing `pub use` lines:
```rust
pub use instructions::create_task::*;
```

Inside the `#[program]` block, add new entry:
```rust
    /// User locks SOL into task escrow for an agent execution
    pub fn create_task(
        ctx: Context<CreateTask>,
        task_id: [u8; 32],
        agent_pubkey: Pubkey,
        amount_lamports: u64,
        capability_hash: [u8; 32],
        deadline: i64,
    ) -> Result<()> {
        instructions::create_task::handler(ctx, task_id, agent_pubkey, amount_lamports, capability_hash, deadline)
    }
```

- [ ] **Step 4: Verify build**

Run: `cd agentproof && cargo build-sbf 2>&1 | grep '^error' | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd agentproof
git add programs/agentproof/src/instructions/create_task.rs programs/agentproof/src/instructions/mod.rs programs/agentproof/src/lib.rs
git commit -m "feat: add create_task instruction with TaskEscrow fund lockup"
```

---

## Task 5: settle_task + witness_sign Integration (P0)

**Files:**
- Create: `agentproof/programs/agentproof/src/instructions/settle_task.rs`
- Modify: `agentproof/programs/agentproof/src/instructions/witness_sign.rs`
- Modify: `agentproof/programs/agentproof/src/instructions/mod.rs`

- [ ] **Step 1: Create settle_task.rs with fund transfer helpers**

```rust
// agentproof/programs/agentproof/src/instructions/settle_task.rs
use anchor_lang::prelude::*;
use crate::state::TaskEscrow;
use crate::errors::AgentProofError;

/// Transfer lamports out of TaskEscrow PDA (uses PDA signer seeds)
pub fn release_escrow<'info>(
    task_escrow: &mut Account<'info, TaskEscrow>,
    destination: &AccountInfo<'info>,
    seeds: &[&[&[u8]]],
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
    bump: u8,
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
```

- [ ] **Step 2: Update witness_sign.rs to add optional escrow accounts and call settle**

Replace the content of `agentproof/programs/agentproof/src/instructions/witness_sign.rs`:

```rust
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
        constraint = task_escrow.status == 0 @ AgentProofError::TaskAlreadySettled,
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
```

- [ ] **Step 3: Add settle_task to mod.rs**

Append to `agentproof/programs/agentproof/src/instructions/mod.rs`:
```rust
pub mod settle_task;
```

- [ ] **Step 4: Verify build**

Run: `cd agentproof && cargo build-sbf 2>&1 | grep '^error' | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd agentproof
git add programs/agentproof/src/instructions/settle_task.rs programs/agentproof/src/instructions/witness_sign.rs programs/agentproof/src/instructions/mod.rs
git commit -m "feat: add settle_task and integrate fund settlement into witness_sign"
```

---

## Task 6: audit-engine Bootstrap (P1)

**Files:**
- Create: `agentproof/audit-engine/package.json`
- Create: `agentproof/audit-engine/tsconfig.json`
- Create: `agentproof/audit-engine/.env.example`
- Create: `agentproof/audit-engine/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "audit-engine",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "axios": "^1.7.0",
    "cors": "^2.8.5",
    "express": "^4.19.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create .env.example**

```bash
HELIUS_API_KEY=your_helius_api_key
ANTHROPIC_AUTH_TOKEN=your_anthropic_token
ANTHROPIC_BASE_URL=https://your-proxy-url
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=your_helius_api_key
PORT=3002
```

- [ ] **Step 4: Create src/index.ts**

```typescript
// agentproof/audit-engine/src/index.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createRoutes } from './routes';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/', createRoutes());

const PORT = parseInt(process.env.PORT ?? '3002', 10);
app.listen(PORT, () => {
  console.log(`[audit-engine] listening on port ${PORT}`);
});
```

- [ ] **Step 5: Install dependencies**

Run: `cd agentproof/audit-engine && npm install`
Expected: `added N packages`

- [ ] **Step 6: Commit**

```bash
cd agentproof
git add audit-engine/package.json audit-engine/tsconfig.json audit-engine/.env.example audit-engine/src/index.ts
git commit -m "feat: scaffold audit-engine service (port 3002)"
```

---

## Task 7: manifest-store (P1)

**Files:**
- Create: `agentproof/audit-engine/src/manifest-store.ts`

- [ ] **Step 1: Create manifest-store.ts**

```typescript
// agentproof/audit-engine/src/manifest-store.ts
import { createHash } from 'crypto';

export interface CapabilityManifest {
  name: string;
  version: string;
  allowed_actions: string[];
  max_slippage_bps?: number;
  allowed_programs?: string[];
  [key: string]: unknown;
}

interface StoredAuditResult {
  credit_score: number;
  safety_index: number;
  risk_flags: string[];
  audit_summary: string;
  tx_count: number;
  audited_at: number;
}

// In-memory stores
const manifestStore = new Map<string, CapabilityManifest>();
const auditCache = new Map<string, StoredAuditResult>();

export function storeManifest(manifest: CapabilityManifest): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
  manifestStore.set(hash, manifest);
  return hash;
}

export function getManifestByHash(hash: string): CapabilityManifest | undefined {
  return manifestStore.get(hash);
}

export function getManifestByPubkey(agentPubkey: string): CapabilityManifest | undefined {
  const cached = auditCache.get(agentPubkey);
  if (!cached) return undefined;
  // manifest itself not stored by pubkey — caller must use hash
  return undefined;
}

export function storeAuditResult(agentPubkey: string, result: StoredAuditResult): void {
  auditCache.set(agentPubkey, result);
}

export function getAuditResult(agentPubkey: string): StoredAuditResult | undefined {
  return auditCache.get(agentPubkey);
}

// Store manifest keyed by pubkey too (for IntentVerifier lookup)
const pubkeyManifestStore = new Map<string, CapabilityManifest>();

export function storeManifestForPubkey(agentPubkey: string, manifest: CapabilityManifest): void {
  pubkeyManifestStore.set(agentPubkey, manifest);
}

export function getManifestForPubkey(agentPubkey: string): CapabilityManifest | undefined {
  return pubkeyManifestStore.get(agentPubkey);
}
```

- [ ] **Step 2: Commit**

```bash
cd agentproof
git add audit-engine/src/manifest-store.ts
git commit -m "feat: add manifest-store for capability_manifest storage"
```

---

## Task 8: Helius Fetcher + TX Summarizer (P1)

**Files:**
- Create: `agentproof/audit-engine/src/helius-fetcher.ts`
- Create: `agentproof/audit-engine/src/tx-summarizer.ts`

- [ ] **Step 1: Create helius-fetcher.ts**

```typescript
// agentproof/audit-engine/src/helius-fetcher.ts
import axios from 'axios';

const HELIUS_API_BASE = 'https://api.helius.xyz/v0';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

export interface HeliusTxSignature {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number;
}

export interface ParsedHeliusTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  fee: number;
  accountData: Array<{ account: string; nativeBalanceChange: number }>;
  instructions: Array<{ programId: string; data: string }>;
}

export async function fetchRecentSignatures(
  agentPubkey: string,
  limit = 500
): Promise<HeliusTxSignature[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not configured');

  const rpcUrl = `${HELIUS_RPC_BASE}/?api-key=${apiKey}`;
  const response = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: [agentPubkey, { limit }],
  });

  return (response.data.result ?? []) as HeliusTxSignature[];
}

export async function fetchParsedTransactions(
  signatures: string[]
): Promise<ParsedHeliusTx[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not configured');

  const results: ParsedHeliusTx[] = [];
  const BATCH_SIZE = 10;
  const RATE_LIMIT_MS = 100;

  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const batch = signatures.slice(i, i + BATCH_SIZE);
    const url = `${HELIUS_API_BASE}/transactions?api-key=${apiKey}`;

    try {
      const response = await axios.post(url, { transactions: batch });
      results.push(...(response.data ?? []));
    } catch (err) {
      console.error(`[helius-fetcher] batch ${i}-${i + BATCH_SIZE} failed:`, err);
    }

    if (i + BATCH_SIZE < signatures.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  return results;
}
```

- [ ] **Step 2: Create tx-summarizer.ts**

```typescript
// agentproof/audit-engine/src/tx-summarizer.ts
import { ParsedHeliusTx } from './helius-fetcher';

export interface TxSummary {
  total_txs: number;
  failure_rate: number;
  programs_called: string[];
  fund_flows: Array<{ direction: 'in' | 'out'; amount_sol: number; counterparty: string }>;
  date_range: { from: string; to: string };
  net_sol_change: number;
}

export function summarizeTransactions(txs: ParsedHeliusTx[], agentPubkey: string): TxSummary {
  const failed = txs.filter(tx => tx.err !== null).length;
  const failure_rate = txs.length > 0 ? (failed / txs.length) * 100 : 0;

  const programSet = new Set<string>();
  for (const tx of txs) {
    for (const ix of tx.instructions ?? []) {
      if (ix.programId) programSet.add(ix.programId);
    }
  }

  const fund_flows: TxSummary['fund_flows'] = [];
  let net_sol_change = 0;

  for (const tx of txs) {
    for (const acct of tx.accountData ?? []) {
      if (acct.account === agentPubkey && acct.nativeBalanceChange !== 0) {
        const amount_sol = Math.abs(acct.nativeBalanceChange) / 1e9;
        const direction = acct.nativeBalanceChange > 0 ? 'in' : 'out';
        net_sol_change += acct.nativeBalanceChange / 1e9;
        fund_flows.push({ direction, amount_sol, counterparty: 'unknown' });
      }
    }
  }

  const blockTimes = txs.map(t => t.blockTime).filter((t): t is number => t !== null);
  const minTime = blockTimes.length ? Math.min(...blockTimes) : 0;
  const maxTime = blockTimes.length ? Math.max(...blockTimes) : 0;

  return {
    total_txs: txs.length,
    failure_rate: Math.round(failure_rate * 100) / 100,
    programs_called: Array.from(programSet),
    fund_flows: fund_flows.slice(0, 20), // top 20 for prompt brevity
    date_range: {
      from: minTime ? new Date(minTime * 1000).toISOString() : 'unknown',
      to: maxTime ? new Date(maxTime * 1000).toISOString() : 'unknown',
    },
    net_sol_change: Math.round(net_sol_change * 1000) / 1000,
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd agentproof
git add audit-engine/src/helius-fetcher.ts audit-engine/src/tx-summarizer.ts
git commit -m "feat: add Helius fetcher and tx summarizer for audit-engine"
```

---

## Task 9: Claude Auditor (P1)

**Files:**
- Create: `agentproof/audit-engine/src/claude-auditor.ts`

- [ ] **Step 1: Create claude-auditor.ts**

```typescript
// agentproof/audit-engine/src/claude-auditor.ts
import Anthropic from '@anthropic-ai/sdk';
import { CapabilityManifest } from './manifest-store';
import { TxSummary } from './tx-summarizer';

export interface AuditResult {
  credit_score: number;
  safety_index: number;
  risk_flags: string[];
  summary: string;
}

function buildPrompt(
  agentPubkey: string,
  manifest: CapabilityManifest | undefined,
  txSummary: TxSummary
): string {
  return `Agent 公钥：${agentPubkey}
声明能力：${manifest ? JSON.stringify(manifest, null, 2) : '未提供'}

历史行为摘要（最近 ${txSummary.total_txs} 笔交易）：
- 调用合约：${txSummary.programs_called.slice(0, 10).join(', ')}
- 资金净变动：${txSummary.net_sol_change} SOL
- 失败率：${txSummary.failure_rate}%
- 活跃时间段：${txSummary.date_range.from} ~ ${txSummary.date_range.to}

请分析：
1. 实际行为与声明能力是否一致？
2. 是否有未声明的异常操作？
3. 资金安全记录如何？

返回 JSON（只返回 JSON，不要其他文字）：
{
  "credit_score": <0-100整数>,
  "safety_index": <0-100整数>,
  "risk_flags": ["...", "..."],
  "summary": "<100字以内的中文总结>"
}`;
}

export async function auditAgent(
  agentPubkey: string,
  manifest: CapabilityManifest | undefined,
  txSummary: TxSummary
): Promise<AuditResult> {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  if (!authToken) throw new Error('ANTHROPIC_AUTH_TOKEN not configured');

  const client = new Anthropic({
    apiKey: authToken,
    baseURL: baseURL ?? undefined,
  });

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: '你是 AgentProof 的 AI 风险审计员，专注于分析 Solana 上 AI Agent 的链上历史行为。',
    messages: [{ role: 'user', content: buildPrompt(agentPubkey, manifest, txSummary) }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON even if Claude wraps it in backticks
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]) as AuditResult;

  return {
    credit_score: Math.max(0, Math.min(100, parsed.credit_score ?? 50)),
    safety_index: Math.max(0, Math.min(100, parsed.safety_index ?? 50)),
    risk_flags: parsed.risk_flags ?? [],
    summary: parsed.summary ?? '',
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd agentproof
git add audit-engine/src/claude-auditor.ts
git commit -m "feat: add Claude auditor for registration-time historical audit"
```

---

## Task 10: audit-engine Routes (P1)

**Files:**
- Create: `agentproof/audit-engine/src/routes.ts`

- [ ] **Step 1: Create routes.ts**

```typescript
// agentproof/audit-engine/src/routes.ts
import { Router, Request, Response } from 'express';
import { fetchRecentSignatures, fetchParsedTransactions } from './helius-fetcher';
import { summarizeTransactions } from './tx-summarizer';
import { auditAgent } from './claude-auditor';
import {
  storeManifest,
  storeManifestForPubkey,
  getManifestByHash,
  getManifestForPubkey,
  storeAuditResult,
  getAuditResult,
  CapabilityManifest,
} from './manifest-store';

export function createRoutes(): Router {
  const router = Router();

  // POST /audit — run historical audit for agent
  router.post('/audit', async (req: Request, res: Response) => {
    const { agent_pubkey, capability_manifest } = req.body as {
      agent_pubkey: string;
      capability_manifest?: CapabilityManifest;
    };

    if (!agent_pubkey) {
      return res.status(400).json({ error: 'agent_pubkey required' });
    }

    try {
      // Cache manifest
      if (capability_manifest) {
        storeManifest(capability_manifest);
        storeManifestForPubkey(agent_pubkey, capability_manifest);
      }

      // Fetch history
      const sigs = await fetchRecentSignatures(agent_pubkey, 500);
      const txs = await fetchParsedTransactions(sigs.map(s => s.signature));
      const txSummary = summarizeTransactions(txs, agent_pubkey);

      // Claude audit
      const manifest = capability_manifest ?? getManifestForPubkey(agent_pubkey);
      const auditResult = await auditAgent(agent_pubkey, manifest, txSummary);

      storeAuditResult(agent_pubkey, { ...auditResult, tx_count: txSummary.total_txs, audited_at: Date.now() });

      return res.json({
        ...auditResult,
        tx_count: txSummary.total_txs,
        date_range: txSummary.date_range,
      });
    } catch (err) {
      console.error('[audit] error:', err);
      return res.status(500).json({ error: String(err) });
    }
  });

  // GET /audit/:agent_pubkey — return cached audit result
  router.get('/audit/:agent_pubkey', (req: Request, res: Response) => {
    const result = getAuditResult(req.params.agent_pubkey);
    if (!result) return res.status(404).json({ error: 'No audit result found' });
    return res.json(result);
  });

  // POST /manifest — store manifest by hash
  router.post('/manifest', (req: Request, res: Response) => {
    const { capability_hash, manifest, agent_pubkey } = req.body as {
      capability_hash?: string;
      manifest: CapabilityManifest;
      agent_pubkey?: string;
    };

    const hash = storeManifest(manifest);
    if (agent_pubkey) storeManifestForPubkey(agent_pubkey, manifest);

    return res.json({ capability_hash: hash });
  });

  // GET /manifest/:capability_hash — retrieve manifest by hash
  router.get('/manifest/:capability_hash', (req: Request, res: Response) => {
    const manifest = getManifestByHash(req.params.capability_hash);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found' });
    return res.json({ manifest });
  });

  // GET /manifest/pubkey/:agent_pubkey — retrieve manifest by pubkey
  router.get('/manifest/pubkey/:agent_pubkey', (req: Request, res: Response) => {
    const manifest = getManifestForPubkey(req.params.agent_pubkey);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found for pubkey' });
    return res.json({ manifest });
  });

  return router;
}
```

- [ ] **Step 2: Build the service**

Run: `cd agentproof/audit-engine && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
cd agentproof
git add audit-engine/src/routes.ts
git commit -m "feat: add audit-engine API routes (/audit, /manifest)"
```

---

## Task 11: IntentVerifier in witness-node (P2)

**Files:**
- Modify: `agentproof/witness-node/src/types.ts`
- Create: `agentproof/witness-node/src/intent-verifier.ts`
- Modify: `agentproof/witness-node/src/api.ts`

- [ ] **Step 1: Add IntentResult types to types.ts**

Append to `agentproof/witness-node/src/types.ts`:

```typescript
export interface IntentVerifyParams {
  agent_pubkey: string;
  task_type: string;
  expected_output?: unknown;
  tx_summary: {
    programs_called: string[];
    fund_flows: string;
    failure_rate: number;
    slot: number;
  };
}

export interface IntentResult {
  aligned: boolean;
  confidence: number;
  reason: string;
  risk_flags: string[];
}

// Extended VerifyResult with intent layer
export interface VerifyResultWithIntent extends VerifyResult {
  intent_result?: IntentResult;
}
```

- [ ] **Step 2: Create intent-verifier.ts**

```typescript
// agentproof/witness-node/src/intent-verifier.ts
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { IntentVerifyParams, IntentResult } from './types';

const AUDIT_ENGINE_URL = process.env.AUDIT_ENGINE_URL ?? 'http://localhost:3002';

async function fetchManifest(agentPubkey: string): Promise<unknown> {
  try {
    const res = await axios.get(`${AUDIT_ENGINE_URL}/manifest/pubkey/${agentPubkey}`);
    return res.data.manifest;
  } catch {
    return null;
  }
}

function buildPrompt(manifest: unknown, params: IntentVerifyParams): string {
  return `Agent 注册时声明能力：${manifest ? JSON.stringify(manifest, null, 2) : '未提供'}

用户委托任务：${params.task_type}
期望输出：${JSON.stringify(params.expected_output ?? {})}

实际链上执行摘要：
- 调用了哪些程序：${params.tx_summary.programs_called.join(', ')}
- 资金流向：${params.tx_summary.fund_flows}
- 失败率：${params.tx_summary.failure_rate}%

判断：此次执行是否符合 Agent 声明能力 + 用户委托意图？

返回 JSON（只返回 JSON，不要其他文字）：
{
  "aligned": true或false,
  "confidence": 0.0到1.0,
  "reason": "<判断理由>",
  "risk_flags": []
}`;
}

export class IntentVerifier {
  private client: Anthropic;

  constructor() {
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!authToken) throw new Error('ANTHROPIC_AUTH_TOKEN not configured');

    this.client = new Anthropic({
      apiKey: authToken,
      baseURL: process.env.ANTHROPIC_BASE_URL ?? undefined,
    });
  }

  async verify(params: IntentVerifyParams): Promise<IntentResult> {
    const manifest = await fetchManifest(params.agent_pubkey);
    const prompt = buildPrompt(manifest, params);

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { aligned: false, confidence: 0, reason: 'Failed to parse Claude response', risk_flags: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      aligned: Boolean(parsed.aligned),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reason: parsed.reason ?? '',
      risk_flags: parsed.risk_flags ?? [],
    };
  }
}
```

- [ ] **Step 3: Add @anthropic-ai/sdk and axios to witness-node if missing**

Run: `cd agentproof/witness-node && npm list @anthropic-ai/sdk axios 2>&1 | grep -E 'UNMET|ERR'`

If packages missing: `npm install @anthropic-ai/sdk axios`

- [ ] **Step 4: Integrate IntentVerifier into api.ts**

In `agentproof/witness-node/src/api.ts`, find the `POST /api/v1/verify` handler.

After the existing imports, add:
```typescript
import { IntentVerifier } from './intent-verifier';
import { VerifyResultWithIntent } from './types';
```

After `let chainClient: ChainClient;`, add:
```typescript
let intentVerifier: IntentVerifier;
```

In `initApp()`, add:
```typescript
  intentVerifier = new IntentVerifier();
```

In the verify endpoint, after `const verification = await verifier.verify(verifyReq);`, add intent check:

```typescript
    // Claude intent verification (only if chain verified)
    let intentResult: import('./types').IntentResult | undefined;
    if (verification.approved && intentVerifier) {
      try {
        intentResult = await intentVerifier.verify({
          agent_pubkey: verifyReq.agent_pubkey,
          task_type: verifyReq.task_type,
          expected_output: verifyReq.expected_output,
          tx_summary: {
            programs_called: [],
            fund_flows: JSON.stringify(verification.chainData ?? {}),
            failure_rate: 0,
            slot: verifyReq.slot,
          },
        });
        // Override approval if intent not aligned
        if (!intentResult.aligned) {
          verification.approved = false;
          verification.reason = `Intent mismatch: ${intentResult.reason}`;
        }
      } catch (err) {
        console.warn('[intent] verification failed, skipping:', err);
      }
    }
```

And in the response, include `intent_result: intentResult`.

- [ ] **Step 5: Verify TypeScript**

Run: `cd agentproof/witness-node && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (fix any type errors found)

- [ ] **Step 6: Commit**

```bash
cd agentproof
git add witness-node/src/types.ts witness-node/src/intent-verifier.ts witness-node/src/api.ts
git commit -m "feat: add IntentVerifier layer with Claude intent alignment check"
```

---

## Task 12: ChainFreezer in risk-monitor (P3)

**Files:**
- Create: `agentproof/risk-monitor/chain_freezer.py`
- Modify: `agentproof/risk-monitor/api/routes.py`

- [ ] **Step 1: Create chain_freezer.py**

```python
# agentproof/risk-monitor/chain_freezer.py
import os
import struct
import hashlib
import logging
import httpx

logger = logging.getLogger(__name__)

# Anchor discriminator for freeze_agent: sha256("global:freeze_agent")[:8]
def _discriminator(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode()).digest()[:8]

FREEZE_AGENT_DISCRIMINATOR = _discriminator("freeze_agent")


class ChainFreezer:
    def __init__(self):
        self.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
        self.authority_key_b58 = os.environ.get("RISK_MONITOR_AUTHORITY_KEY", "")
        self.program_id = os.environ.get("PROGRAM_ID", "GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG")

    async def freeze_on_chain(self, agent_pubkey: str, reason: str) -> str:
        """
        Call freeze_agent on-chain via Solana JSON-RPC.
        Requires RISK_MONITOR_AUTHORITY_KEY env var (base58 private key).
        Returns tx_signature or raises on error.
        """
        if not self.authority_key_b58:
            logger.warning("[chain-freezer] RISK_MONITOR_AUTHORITY_KEY not set — skipping on-chain freeze")
            raise ValueError("RISK_MONITOR_AUTHORITY_KEY not configured")

        try:
            from solders.keypair import Keypair
            from solders.pubkey import Pubkey
            from solders.transaction import Transaction
            from solders.message import Message
            from solders.instruction import Instruction, AccountMeta
            import base58
        except ImportError:
            raise ImportError("solders package required: pip install solders")

        keypair = Keypair.from_bytes(base58.b58decode(self.authority_key_b58))
        agent_pub = Pubkey.from_string(agent_pubkey)
        program_pub = Pubkey.from_string(self.program_id)

        # Encode reason as length-prefixed string (Borsh)
        reason_bytes = reason.encode("utf-8")
        reason_encoded = struct.pack("<I", len(reason_bytes)) + reason_bytes

        # Encode agent_pubkey (32 bytes)
        data = FREEZE_AGENT_DISCRIMINATOR + bytes(agent_pub) + reason_encoded

        # Build AgentRecord PDA seeds: ["agent", agent_pubkey]
        agent_record_pda, _ = Pubkey.find_program_address(
            [b"agent", bytes(agent_pub)],
            program_pub,
        )

        ix = Instruction(
            program_id=program_pub,
            accounts=[
                AccountMeta(pubkey=agent_record_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=keypair.pubkey(), is_signer=True, is_writable=False),
            ],
            data=data,
        )

        async with httpx.AsyncClient() as client:
            # Get recent blockhash
            blockhash_resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0", "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "confirmed"}],
            })
            blockhash = blockhash_resp.json()["result"]["value"]["blockhash"]

            from solders.hash import Hash
            msg = Message.new_with_blockhash(
                [ix], keypair.pubkey(), Hash.from_string(blockhash)
            )
            tx = Transaction([keypair], msg, Hash.from_string(blockhash))

            send_resp = await client.post(self.rpc_url, json={
                "jsonrpc": "2.0", "id": 2,
                "method": "sendTransaction",
                "params": [
                    tx.to_bytes().hex(),
                    {"encoding": "base16", "skipPreflight": False},
                ],
            })
            result = send_resp.json()

            if "error" in result:
                raise RuntimeError(f"RPC error: {result['error']}")

            tx_sig = result["result"]
            logger.info(f"[chain-freezer] freeze_agent tx: {tx_sig}")
            return tx_sig


_freezer: ChainFreezer | None = None

def get_freezer() -> ChainFreezer:
    global _freezer
    if _freezer is None:
        _freezer = ChainFreezer()
    return _freezer
```

- [ ] **Step 2: Update routes.py to call ChainFreezer**

In `agentproof/risk-monitor/api/routes.py`, find the `analyze_and_maybe_freeze` function (or freeze endpoint).

Add import at top of file:
```python
from chain_freezer import get_freezer
```

Find where freeze is triggered (when score > 80) and replace the TODO comment with:
```python
            try:
                freezer = get_freezer()
                tx_sig = await freezer.freeze_on_chain(agent_id, f"Risk score {score.score:.1f}")
                logger.info(f"Froze agent {agent_id} on-chain: {tx_sig}")
            except Exception as freeze_err:
                logger.error(f"On-chain freeze failed for {agent_id}: {freeze_err}")
```

- [ ] **Step 3: Verify Python syntax**

Run: `cd agentproof/risk-monitor && python3 -c "from chain_freezer import ChainFreezer; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd agentproof
git add risk-monitor/chain_freezer.py risk-monitor/api/routes.py
git commit -m "feat: add ChainFreezer for on-chain freeze_agent call from risk-monitor"
```

---

## Task 13: Register Page — Show Audit Results (P4)

**Files:**
- Modify: `agentproof/app/src/app/register/page.tsx`

- [ ] **Step 1: Add audit result state and fetch logic**

In `agentproof/app/src/app/register/page.tsx`, after the existing `registerAgent` success block, add:

```typescript
// After successful register_agent on-chain
const auditResponse = await fetch('http://localhost:3002/audit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_pubkey: walletPubkey,
    capability_manifest: parsedManifest, // from form input
  }),
});
const auditData = await auditResponse.json();
setAuditResult(auditData);
```

Add state:
```typescript
const [auditResult, setAuditResult] = useState<{
  credit_score: number;
  safety_index: number;
  risk_flags: string[];
  audit_summary: string;
  tx_count: number;
} | null>(null);
```

- [ ] **Step 2: Add audit result display UI**

After the success message, add:
```tsx
{auditResult && (
  <div className="mt-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
    <h3 className="text-lg font-semibold text-white mb-3">历史审计结果</h3>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <span className="text-gray-400 text-sm">初始信用分</span>
        <div className="text-2xl font-bold text-green-400">{auditResult.credit_score}/100</div>
      </div>
      <div>
        <span className="text-gray-400 text-sm">安全指数</span>
        <div className="text-2xl font-bold text-blue-400">{auditResult.safety_index}/100</div>
      </div>
    </div>
    {auditResult.risk_flags.length > 0 && (
      <div className="mt-3">
        <span className="text-yellow-400 text-sm">风险标记：</span>
        <ul className="list-disc list-inside text-gray-300 text-sm mt-1">
          {auditResult.risk_flags.map((flag, i) => <li key={i}>{flag}</li>)}
        </ul>
      </div>
    )}
    <p className="text-gray-300 text-sm mt-3">{auditResult.audit_summary}</p>
    <p className="text-gray-500 text-xs mt-2">分析了 {auditResult.tx_count} 笔历史交易</p>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
cd agentproof
git add app/src/app/register/page.tsx
git commit -m "feat: show historical audit result on registration page"
```

---

## Task 14: Verify Page — Show Intent Result (P4)

**Files:**
- Modify: `agentproof/app/src/app/verify/page.tsx`

- [ ] **Step 1: Add intent_result display**

In `agentproof/app/src/app/verify/page.tsx`, add interface for intent result:

```typescript
interface IntentResult {
  aligned: boolean;
  confidence: number;
  reason: string;
  risk_flags: string[];
}
```

After displaying the verification result, add:
```tsx
{result?.intent_result && (
  <div className={`mt-4 p-4 rounded-lg border ${
    result.intent_result.aligned
      ? 'bg-green-900/20 border-green-700'
      : 'bg-red-900/20 border-red-700'
  }`}>
    <div className="flex items-center gap-2">
      <span>{result.intent_result.aligned ? '✅' : '❌'}</span>
      <span className="font-semibold text-white">
        Claude 意图验证：{result.intent_result.aligned ? '与声明能力一致' : '意图不符'}
        （置信度 {Math.round(result.intent_result.confidence * 100)}%）
      </span>
    </div>
    <p className="text-gray-300 text-sm mt-2">{result.intent_result.reason}</p>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
cd agentproof
git add app/src/app/verify/page.tsx
git commit -m "feat: show Claude intent verification result on verify page"
```

---

## Task 15: Agent Detail Page — credit_score (P4)

**Files:**
- Modify: `agentproof/app/src/app/agent/[pubkey]/page.tsx`

- [ ] **Step 1: Replace reputation_score with credit_score display**

In `agentproof/app/src/app/agent/[pubkey]/page.tsx`, find any display of `reputation_score` and update:

```tsx
// Old
<div>{agentRecord.reputation_score} / 1000</div>

// New
<div className="text-2xl font-bold text-green-400">{agentRecord.credit_score ?? agentRecord.reputation_score} / 100</div>
<div className="text-gray-400 text-sm">EWMA 信用分</div>
```

Also add safety_index display if `agentRecord.safety_index` is available:
```tsx
{agentRecord.safety_index !== undefined && (
  <div>
    <div className="text-xl font-bold text-blue-400">{agentRecord.safety_index} / 100</div>
    <div className="text-gray-400 text-sm">安全指数</div>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
cd agentproof
git add app/src/app/agent/
git commit -m "feat: update agent detail page to show credit_score (EWMA) and safety_index"
```

---

## Environment Variables Summary

Create/update these `.env` files before running:

**`agentproof/audit-engine/.env`:**
```bash
HELIUS_API_KEY=your_helius_api_key
ANTHROPIC_AUTH_TOKEN=your_anthropic_token
ANTHROPIC_BASE_URL=https://your-proxy-url
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=your_helius_api_key
PORT=3002
```

**`agentproof/witness-node/.env` (add to existing):**
```bash
ANTHROPIC_AUTH_TOKEN=your_anthropic_token
ANTHROPIC_BASE_URL=https://your-proxy-url
AUDIT_ENGINE_URL=http://localhost:3002
```

**`agentproof/risk-monitor/.env` (add to existing):**
```bash
RISK_MONITOR_AUTHORITY_KEY=your_base58_private_key
PROGRAM_ID=GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG
SOLANA_RPC_URL=https://api.devnet.solana.com
```

---

## Demo Run Order

1. `cd agentproof && anchor build && anchor deploy`
2. `cd agentproof/audit-engine && npm install && npm run dev`
3. `cd agentproof/witness-node && npm run dev`
4. `cd agentproof/risk-monitor && uvicorn main:app --reload`
5. `cd agentproof/app && npm run dev`
6. Navigate to `http://localhost:3000/register` → register an agent → see audit results
7. Navigate to `http://localhost:3000/verify` → submit a task → see intent judgment
