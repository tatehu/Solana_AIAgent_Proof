# AgentProof 黑客松完善设计文档

**日期**：2026-04-25  
**目标**：补齐白皮书第二章「解决方案」缺失功能，打通黑客松 Demo 完整闭环  
**范围**：方案 B — 最小可演示闭环，跳过 ProofNFT / SBT Token / x402 / 杠杆倍数

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────┐
│  前端（已有，小改）                                   │
│  注册页：展示历史审计结果 + 初始信用分                 │
│  验证页：展示 Claude 意图判断过程 + 结果               │
│  监控页：已有，补充冻结真正上链                        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  链下服务层（新增 + 修改）                             │
│                                                     │
│  【新增】audit-engine（Node.js）端口 3002            │
│    POST /audit         注册时历史审计                 │
│    Helius API → 拉历史500笔 → Claude分析 → 初始分     │
│                                                     │
│  【修改】witness-node 加 IntentVerifier              │
│    verify() 末尾追加 Claude 意图判断                  │
│    对比 capability_manifest vs 实际交易行为           │
│                                                     │
│  【修改】risk-monitor freeze 真正调用链上指令          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  链上合约（Rust/Anchor — 新增2个指令）                │
│  【新增】create_task   用户锁资金到 TaskEscrow PDA    │
│  【新增】settle_task   条件核查 + 释放/退款            │
│  【修改】witness_sign  结算时触发 settle_task 逻辑    │
│  【修改】AgentRecord   EWMA 信用分算法替换            │
└─────────────────────────────────────────────────────┘
```

**核心决策：**
- `create_task` 把用户资金锁入 `TaskEscrow PDA`（seeds: `["escrow", task_id]`）
- `settle_task` 在 `witness_sign` 2-of-3 通过时内部触发，无需额外用户调用
- audit-engine 独立为新服务（端口 3002），不污染现有 witness-node
- IntentVerifier 作为 `ChainVerifier` 之后第二验证层，链上验证通过才调 Claude
- EWMA 分值范围统一为 0–100（与白皮书一致）

---

## 二、链上合约（Rust / Anchor）

### 2.1 新增状态：TaskEscrow

```rust
// state/task_escrow.rs
#[account]
pub struct TaskEscrow {
    pub task_id: [u8; 32],       // 32 — 任务唯一ID
    pub user: Pubkey,            // 32 — 委托用户
    pub agent: Pubkey,           // 32 — 执行 Agent
    pub amount_lamports: u64,    // 8  — 锁定报酬
    pub capability_hash: [u8; 32], // 32 — 必须匹配 agent_record
    pub deadline: i64,           // 8  — 截止 Unix 时间戳
    pub status: u8,              // 1  — 0=locked 1=released 2=refunded
    pub created_at: i64,         // 8
    pub bump: u8,                // 1
}

impl TaskEscrow {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 32 + 8 + 1 + 8 + 1;
}
```

### 2.2 新增指令：create_task

```
accounts:
  task_escrow PDA  [seeds: "escrow", task_id]  init, payer=user
  agent_record     约束 Agent 已注册且未冻结，capability_hash 匹配
  user             Signer, 付款方（mut）
  system_program

params:
  task_id: [u8; 32]
  agent_pubkey: Pubkey
  amount_lamports: u64
  capability_hash: [u8; 32]   // 校验必须 == agent_record.capability_hash
  deadline: i64

逻辑：
  1. require!(agent_record.capability_hash == capability_hash)
  2. require!(amount_lamports > 0)
  3. require!(deadline > Clock::get().unix_timestamp)
  4. require!(!agent_record.is_frozen)
  5. SOL transfer: user → task_escrow PDA (amount_lamports)
  6. 初始化 TaskEscrow 字段
  7. emit!(TaskCreated { task_id, user, agent, amount_lamports })
```

### 2.3 新增指令：settle_task

由 `witness_sign` 在 2-of-3 达成后内部调用（CPI 或同 instruction 内联）。

```
params:
  task_id: [u8; 32]
  approved: bool

逻辑：
  approved=true:
    task_escrow 余额 → agent wallet
    task_escrow.status = 1 (released)
    agent_record.update_ewma(100)   // 满分
    emit!(TaskSettled { approved: true })

  approved=false:
    task_escrow 余额 → user wallet
    task_escrow.status = 2 (refunded)
    agent_record.update_ewma(0)     // 零分
    emit!(TaskSettled { approved: false })

超时退款（任何人可调用）：
  require!(Clock::get().unix_timestamp > task_escrow.deadline)
  task_escrow 余额 → user wallet
  task_escrow.status = 2
  agent_record.update_ewma(30)      // 超时分
```

### 2.4 修改：AgentRecord EWMA 信用分

```rust
// 旧：reputation_score 范围 0-1000，简单 +1/-5
// 新：credit_score 范围 0-100，EWMA 公式

pub fn update_ewma(&mut self, task_score: u64, clock: &Clock) {
    // new_score = 0.80 * old_score + 0.20 * task_score
    // 使用整数算术：× 100 避免浮点
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

// 初始信用分：由 audit-engine 调用后通过 update_initial_credit 写入
// 新 Agent 默认 50 分（中性基准），质押越高可加分：
//   stake >= 1 SOL: +5 分
//   stake >= 5 SOL: +10 分
pub fn initial_credit(stake_lamports: u64) -> u64 {
    let base = 50u64;
    if stake_lamports >= 5_000_000_000 { base + 10 }
    else if stake_lamports >= 1_000_000_000 { base + 5 }
    else { base }
}
```

**AgentRecord 新增字段：**
- `credit_score: u64` — 替换 `reputation_score`，范围 0–100
- `safety_index: u64` — 独立安全指数 0–100（由 audit-engine 写入）

### 2.5 新增错误码

```rust
TaskNotFound,
TaskAlreadySettled,
TaskExpired,
TaskNotExpired,
CapabilityMismatch,
InvalidAmount,
```

---

## 三、audit-engine（新服务）

**位置**：`agentproof/audit-engine/`  
**技术栈**：Node.js + TypeScript，端口 3002  
**环境变量**：
```
HELIUS_API_KEY=
ANTHROPIC_AUTH_TOKEN=
ANTHROPIC_BASE_URL=
SOLANA_RPC_URL=
```

### 3.1 目录结构

```
audit-engine/
├── src/
│   ├── index.ts              # Express 入口，端口 3002
│   ├── helius-fetcher.ts     # Helius API 历史交易拉取
│   ├── tx-summarizer.ts      # 交易解析 → 结构化摘要
│   ├── claude-auditor.ts     # Claude API 意图分析
│   ├── manifest-store.ts     # capability_manifest JSON 存储（内存+文件）
│   └── routes.ts             # API 路由
├── package.json
├── tsconfig.json
└── .env.example
```

### 3.2 API 设计

```
POST /audit
  body: { agent_pubkey: string, capability_manifest?: object }
  1. 保存 capability_manifest（以 sha256(JSON) 为 key）
  2. Helius getSignaturesForAddress → 最近 500 笔 TxSig
  3. 批量 getParsedTransaction（并发 10，限速 100ms 间隔）
  4. tx-summarizer 整理摘要：
     { programs_called[], fund_flows[], failure_rate, total_txs, date_range }
  5. claude-auditor 调用 Claude claude-opus-4-5：
     prompt 包含：声明能力 + 实际行为摘要
     返回：{ credit_score: 0-100, safety_index: 0-100, risk_flags[], summary }
  6. 缓存结果（agent_pubkey → result）
  response: { credit_score, safety_index, risk_flags, audit_summary, tx_count }

GET /audit/:agent_pubkey
  返回缓存的审计结果

POST /manifest
  body: { capability_hash: string, manifest: object }
  存储 manifest（供 IntentVerifier 查询）

GET /manifest/:capability_hash
  返回对应 manifest JSON
```

### 3.3 Claude Prompt 设计

```
系统提示：
你是 AgentProof 的 AI 风险审计员，专注于分析 Solana 上 AI Agent 的链上历史行为。

用户提示：
Agent 公钥：{agent_pubkey}
声明能力：{capability_manifest}

历史行为摘要（最近 {tx_count} 笔交易）：
- 调用合约：{programs_called}
- 资金流向：{fund_flows_summary}
- 失败率：{failure_rate}%
- 活跃时间段：{date_range}

请分析：
1. 实际行为与声明能力是否一致？
2. 是否有未声明的异常操作？
3. 资金安全记录如何？

返回 JSON：
{
  "credit_score": <0-100整数>,
  "safety_index": <0-100整数>,
  "risk_flags": ["...", "..."],
  "summary": "<100字以内的中文总结>"
}
```

---

## 四、witness-node 新增 IntentVerifier

**位置**：`agentproof/witness-node/src/intent-verifier.ts`

### 4.1 调用时机

在 `ChainVerifier.verify()` 返回 `approved=true` 后，追加调用：

```typescript
// api.ts verify 流程
const chainResult = await verifier.verify(verifyReq);
if (!chainResult.approved) return { approved: false, ... };

// 追加 Claude 意图判断
const intentResult = await intentVerifier.verify({
  agent_pubkey: verifyReq.agent_pubkey,
  task_type: verifyReq.task_type,
  expected_output: verifyReq.expected_output,
  tx_summary: chainResult.txSummary,   // chain verifier 额外返回交易摘要
});

const finalApproved = chainResult.approved && intentResult.aligned;
```

### 4.2 IntentVerifier 实现

```typescript
// intent-verifier.ts
export class IntentVerifier {
  private anthropic: Anthropic;  // 通过 ANTHROPIC_BASE_URL 代理

  async verify(params: IntentVerifyParams): Promise<IntentResult> {
    // 1. 从 audit-engine 获取 capability_manifest
    const manifest = await fetchManifest(params.agent_pubkey);

    // 2. 构造 prompt
    const prompt = buildIntentPrompt(manifest, params);

    // 3. 调用 Claude claude-haiku-4-5（轻量，每次验证调用）
    const response = await this.anthropic.messages.create({...});

    // 4. 解析返回 JSON
    return parseIntentResult(response);
  }
}
```

**Claude Prompt（执行时意图验证）：**
```
Agent 注册时声明能力：{capability_manifest}

用户委托任务：{task_type}，期望输出：{expected_output}

实际链上执行摘要：
- 调用了哪些程序：{programs}
- 资金流向：{flows}
- 输出结果：{actual_output}

判断：此次执行是否符合 Agent 声明能力 + 用户委托意图？

返回 JSON：
{
  "aligned": true/false,
  "confidence": 0.0-1.0,
  "reason": "<判断理由>",
  "risk_flags": []
}
```

---

## 五、risk-monitor freeze 真正上链

**修改文件**：`risk-monitor/api/routes.py`

### 5.1 当前问题

```python
# 当前：只打日志，不上链
async def analyze_and_maybe_freeze(agent_id):
    ...
    # HTTP POST 到 witness-node /api/v1/freeze（那里也是 TODO）
```

### 5.2 修改方案

```python
# 新增 chain_freezer.py — 用 solders + httpx 直接构造并发送 freeze_agent 指令
from solders.keypair import Keypair
from solders.pubkey import Pubkey
import base58, httpx

class ChainFreezer:
    def __init__(self, rpc_url: str, authority_keypair: Keypair, program_id: str):
        ...

    async def freeze_on_chain(self, agent_pubkey: str, reason: str) -> str:
        """构造 freeze_agent 指令并发送到链上，返回 tx_signature"""
        # 使用 Anchor discriminator + 序列化参数
        # 通过 Helius RPC 发送
        ...
```

**环境变量新增：**
```
RISK_MONITOR_AUTHORITY_KEY=   # 风控权限私钥（对应合约 RISK_MONITOR_AUTHORITY）
PROGRAM_ID=
```

---

## 六、前端修改

### 6.1 注册页（register/page.tsx）

注册成功后自动调用 audit-engine：
```
链上 register_agent 成功
  → POST http://localhost:3002/audit { agent_pubkey, capability_manifest }
  → 展示审计结果：
    - 初始信用分：{credit_score}/100
    - 安全指数：{safety_index}/100
    - 风险标记：{risk_flags[]}
    - 审计摘要：{summary}
```

### 6.2 验证页（verify/page.tsx）

展示 Claude 意图判断结果：
```
witness-node 返回结果中包含 intent_result：
  - aligned: true/false
  - confidence: 0.0-1.0
  - reason: "判断理由"

UI 展示：
  ✅ Claude 意图验证：与声明能力一致（置信度 94%）
  原因：Agent 执行了声明范围内的 SOLANA_SWAP 操作，滑点在合理范围内
```

### 6.3 Agent 详情页（agent/[pubkey]/page.tsx）

新增展示：
- 信用分（credit_score/100，EWMA）替代原 reputation_score
- 安全指数（safety_index/100）
- 历史审计摘要

---

## 七、实现优先级与顺序

```
P0 — 合约层（必须先做，其他依赖它）
  1. TaskEscrow state
  2. create_task 指令
  3. settle_task 逻辑（内联到 witness_sign）
  4. AgentRecord EWMA 替换

P1 — audit-engine（注册流程核心）
  5. Helius 历史拉取
  6. Claude 历史审计
  7. manifest-store
  8. API 路由

P2 — witness-node IntentVerifier（执行验证核心）
  9. intent-verifier.ts
  10. api.ts 集成

P3 — 风险监控上链
  11. chain_freezer.py
  12. routes.py 集成

P4 — 前端适配
  13. 注册页展示审计结果
  14. 验证页展示意图判断
  15. Agent详情页信用分更新
```

---

## 八、跳过功能（Demo 用 UI 占位说明）

| 功能 | 处理方式 |
|------|----------|
| ProofNFT 铸造 | 前端展示 NFT 卡片样式，说明"主网上线后启用" |
| SBT Token | AgentRecord.credit_score 即为链上信用锚点，Token 发行在路线图 |
| x402 条件支付 | Escrow settle 即为条件支付替代实现 |
| 质押杠杆倍数 | UI 展示杠杆倍数计算公式，合约暂不强制 |
| 申诉窗口 | 白皮书路线图说明，Phase 3 实现 |
| Helius Webhook | 当前轮询够用，Webhook 在主网版实现 |

---

## 九、环境变量汇总

```bash
# audit-engine/.env
HELIUS_API_KEY=
ANTHROPIC_AUTH_TOKEN=
ANTHROPIC_BASE_URL=
SOLANA_RPC_URL=
PORT=3002

# witness-node/.env（新增）
ANTHROPIC_AUTH_TOKEN=
ANTHROPIC_BASE_URL=
AUDIT_ENGINE_URL=http://localhost:3002

# risk-monitor/.env（新增）
RISK_MONITOR_AUTHORITY_KEY=
PROGRAM_ID=
```

---

## 十、文件变更清单

### 新增文件
- `audit-engine/src/index.ts`
- `audit-engine/src/helius-fetcher.ts`
- `audit-engine/src/tx-summarizer.ts`
- `audit-engine/src/claude-auditor.ts`
- `audit-engine/src/manifest-store.ts`
- `audit-engine/src/routes.ts`
- `audit-engine/package.json`
- `audit-engine/tsconfig.json`
- `audit-engine/.env.example`
- `witness-node/src/intent-verifier.ts`
- `programs/agentproof/src/state/task_escrow.rs`
- `programs/agentproof/src/instructions/create_task.rs`
- `programs/agentproof/src/instructions/settle_task.rs`
- `risk-monitor/chain_freezer.py`

### 修改文件
- `programs/agentproof/src/state/agent_record.rs` — EWMA，新增 credit_score/safety_index
- `programs/agentproof/src/state/mod.rs` — 导出 TaskEscrow
- `programs/agentproof/src/instructions/mod.rs` — 导出新指令
- `programs/agentproof/src/instructions/witness_sign.rs` — 集成 settle_task
- `programs/agentproof/src/errors.rs` — 新增错误码
- `programs/agentproof/src/lib.rs` — 注册新指令
- `witness-node/src/api.ts` — 集成 IntentVerifier
- `witness-node/src/verifier.ts` — 返回 txSummary
- `witness-node/src/types.ts` — 新增 IntentResult 类型
- `risk-monitor/api/routes.py` — 集成 ChainFreezer
- `app/src/app/register/page.tsx` — 展示审计结果
- `app/src/app/verify/page.tsx` — 展示意图判断
- `app/src/app/agent/[pubkey]/page.tsx` — 信用分更新
