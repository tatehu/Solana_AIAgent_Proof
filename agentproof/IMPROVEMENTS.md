# AgentProof — 问题清单与路线图

> 整理自开发会话，按优先级排列。✅ = 已实现，□ = 待实现。

---

## P0 — Demo 必须解决

### 1. 见证节点三个 Keypair 无 SOL，WitnessPool 无法初始化

**状态：待解决（需手动操作）**

**解决方案**：在 [Solana 水龙头](https://faucet.solana.com) 手动充值，每地址充 1 SOL：

```
GixFGAMfLnWf1puDd8TSA7fgTLtME9aYsAokWGCtR9B   ← primary
5kub6thFuS8e6J7pVjeVvKVWuZEGPBBexuZTjHaHHdMu  ← witness1
4Gic2sL5qE8UfpJAxYdL2tjUpiaySmNTLkAGZSKSAxZM  ← witness2
```

---

### 2. submit_proof Borsh 编码未经链上验证

**状态：待验证**

`verify/page.tsx` 里手写了 Borsh 序列化，建议引入 `bs58` 库替换手写 base58：

```typescript
import bs58 from "bs58";
function txSigToBytes(sig: string): Uint8Array {
  return bs58.decode(sig);
}
```

然后在 devnet 上实测一笔完整 submit_proof，用 Explorer 确认成功。

---

## P1 — 功能（影响完整性）

### ✅ TaskEscrow PDA（资金托管）

用户锁 SOL 到链上 Escrow，2-of-3 见证通过后释放给 Agent，拒绝则退款给用户。
- `create_task` 指令：验证 amount > 0、deadline > now、capability_hash 匹配
- `witness_sign` 自动结算：通过 → Agent 收款，拒绝 → 用户退款

### ✅ EWMA 信用评分（替代 reputation_score）

新算法：`new_score = (old × 80 + task_score × 20) / 100`，范围 0-100。
- 质押 ≥ 1 SOL → 初始 55，质押 ≥ 5 SOL → 初始 60
- 链上 `AgentRecord.credit_score` + `AgentRecord.safety_index` 字段

### ✅ 冻结闭环上链（ChainFreezer）

Risk Monitor 触发冻结时，不仅发 HTTP 通知，还直接提交 `freeze_agent` 指令上链：
- Anchor 指令编码（discriminator + Borsh）
- `getLatestBlockhash` + `sendTransaction`（base64 编码）
- `AgentRecord.is_frozen = true`（链上永久记录）

### □ 见证节点经济模型

每笔 `witness_sign` 消耗见证节点 SOL，无补偿机制。建议：

```rust
// submit_proof 新增参数
pub witness_fee_lamports: u64,  // 建议 3 × 5000 = 15000

// 平分给 3 个见证节点
system_program::transfer(CpiContext::new(...), params.witness_fee_lamports / 3)?;
```

### □ ProofNFT 铸造

当前 TaskProof PDA 是任务证明的数据载体，后续用 Metaplex Core 铸造 SBT：

```rust
// witness_sign 2-of-3 达成时调用 Metaplex Core CPI
CreateV2CpiBuilder::new(...)
    .name(format!("AgentProof Task #{}", proof.task_id))
    .plugins(vec![Plugin::FreezeDelegate(...)])  // 不可转让
    .invoke()?;
```

**Hackathon 阶段话术**：「TaskProof PDA 本身已是链上不可伪造的任务证明，后续通过 Metaplex Core 升级为可展示、可组合的 SBT。」

### □ witness_sign agent_pubkey 从链上读取

当前 `api.ts` 中 `agent_pubkey` 来自 HTTP 请求体，应始终从链上 TaskProof PDA 读取：

```typescript
const agentPubkey = await chainClient.readAgentPubkeyFromProof(verifyReq.task_id);
// 不再使用 verifyReq.agent_pubkey
```

---

## P2 — 体验和叙事

### ✅ 历史审计引擎（audit-engine）

Agent 注册时，自动拉取 Helius 历史交易，用 Claude Opus 生成：
- 初始信用分（credit_score）
- 安全指数（safety_index）
- 风险标记（risk_flags）
- 审计摘要

### ✅ LLM 意图验证层（IntentVerifier）

见证节点在 ChainVerifier 通过后，调用 Claude Haiku 判断：
- Agent 的实际链上操作是否与声明的 Capability Manifest 一致
- 意图不符时强制将 `approved` 设为 `false`
- 返回 `intent_result`（aligned、confidence、reason）给前端展示

### ✅ 注册页面展示审计结果

注册成功后，自动调用 audit-engine，在页面展示：
- 初始信用分 / 安全指数
- 风险标记列表
- 审计摘要 + 分析交易数量

### ✅ 验证页面展示意图审查结果

verify/page.tsx 展示 Claude Haiku 意图验证结果：
- 对齐/不符状态（绿/红）
- 置信度百分比
- 判断理由

### ✅ Agent 详情页更新信用分显示

`/agent/[pubkey]` 页面：
- `credit_score / 100`（EWMA 信用分）
- `safety_index / 100`（安全指数）

### □ Verify 页面定位说明

页面顶部应加说明，避免用户误以为需要手动操作：

```
ℹ️ 此页面用于手动提交证明和调试。
   正式场景中，Agent 通过 AgentProof SDK 自动提交证明，无需人工干预。
```

---

## P3 — 架构（Hackathon 后）

### □ 真正去中心化见证节点

当前 3 个见证 keypair 派生自同一服务器，本质是单节点模拟 2-of-3。

**Hackathon 话术**：「当前单节点模拟 2-of-3，主网版本将开放 `register_witness` 接口，任何人质押后可加入见证池，`submit_proof` 时随机选取 3 个独立节点。」

### □ WitnessPool authority 多签

部署后将 authority 转移给 Squads Protocol 多签钱包，或设为 `Pubkey::default()`（放弃控制权）。

---

## P4 — 产品路线图（需独立研发）

以下功能涉及根本性技术挑战，无法在现有架构下实现：

### □ LLM Judge 目标达成验证

当前验证「任务是否发生」，无法验证「是否达成声明目标」（如「收益 ≥ 2%」）。

**技术依赖**：zkML（Risc0）或 TEE（Intel TDX）保证 LLM 推理不可篡改，才能作为链上信任根。

### □ 社交类 / 链下过程 Agent 验证

ElizaOS、KOL Agent 等链下行为无法通过链上 tx_signature 验证。

**技术依赖**：Intel SGX/TDX 或 AWS Nitro Enclave，需主流 Agent 框架原生支持 TEE 运行。

### □ 多 Agent 协作链式验证

Swarms、ElizaOS HTN 等多 Agent 系统的协作链条（子任务→主任务）验证。

**技术依赖**：各子 Agent 全部接入 AgentProof，形成链式 TaskProof，需框架层原生支持。

### □ 历史 Agent 数据追溯导入

批量为历史交易生成 TaskProof，使声誉从历史数据开始累积而非从零开始。

**实现障碍**：Archive Node 访问成本 + 防止恶意刷历史 + 批量 witness_sign gas 分担。

### □ 行业级问题（超出单项目能解决范围）

- **P4-17** 链上无法区分 Agent 操作与人工操作（需行业标准如 SAID Protocol）
- **P4-18** 一个钱包 ≠ 一个 Agent 的身份混乱（需 Agent 框架层标准化独立 keypair 管理）

---

## 竞品分析

### AGIRAILS（agirails.io）

**定位**：「Stripe for AI Agents」— Agent 间商业交易支付基础设施（Base L2/Ethereum）

**与 AgentProof 关系**：互补而非竞争

```
AGIRAILS   → Agent-to-Agent 经济基础设施（Agent 如何与另一个 Agent 安全付款）
AgentProof → Agent-to-Human 信任基础设施（用户如何信任一个 Agent 的历史行为）
```

**AgentProof 差异化优势**：
1. **强制验证**：2-of-3 witness + ChainFreezer 是主动强制的；AGIRAILS V1 proof 验证是 opt-in
2. **Solana 生态**：DeFi agent 交易量 90% 在 Solana，覆盖不同市场
3. **完整审计链**：注册审计（Claude Opus）→ 实时意图验证（Claude Haiku）→ EWMA 信用分，形成完整可追溯的信任历史
4. **链上冻结**：风控触发时直接修改链上状态，不可撤销

**Pitch 话术**：
> AGIRAILS builds payment rails between agents; AgentProof builds the trust layer between agents and the humans who use them. Every agent needs both: a way to get paid, and a way to prove they deserve to be trusted.

---

## 当前待解决清单

```
Demo 前必须：
  □ P0-1  三个 witness 地址手动充值 SOL
  □ P0-2  submit_proof bs58 编码 devnet 实测验证

Pitch 前建议：
  □ P2    Verify 页面加「辅助工具」定位说明
  □ P1    ProofNFT Pitch 话术准备

后续版本：
  □ P1    见证节点经济模型（submit_proof 预付见证费）
  □ P1    agent_pubkey 始终从链上 TaskProof PDA 读取
  □ P3    真正去中心化见证节点（开放 register_witness）
  □ P3    WitnessPool authority 多签（Squads Protocol）

已完成 ✅：
  ✅ TaskEscrow PDA（资金托管 + 自动结算）
  ✅ EWMA 信用评分（credit_score 0-100 替代 reputation_score 0-1000）
  ✅ create_task 指令
  ✅ settle_task + witness_sign 自动 Escrow 结算
  ✅ audit-engine（Helius + Claude Opus 历史审计）
  ✅ Capability Manifest 存储与查询
  ✅ IntentVerifier（Claude Haiku 意图验证，集成进 witness-node）
  ✅ ChainFreezer（risk-monitor 直接提交 freeze_agent 上链）
  ✅ 注册页展示审计结果
  ✅ 验证页展示意图审查结果
  ✅ Agent 详情页显示 credit_score + safety_index
```
