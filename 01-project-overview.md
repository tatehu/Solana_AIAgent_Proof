# 01 — 项目概述

## 一句话定位

> **AgentProof 是 Solana 上第一个可信 AI Agent 行为验证协议——让链上合约能够知道一个 AI Agent 是否真正执行了它声称完成的任务。**

---

## 问题

### Agent Economy 的信任危机

Solana 承载全球 70% 的 AI Agent 链上活动。但整个 Agent 经济存在根本性缺口：

```
当一个 AI Agent 声称「我已完成了这个任务」，
链上合约无法验证这是否是真的。
```

| 场景 | 痛点 |
|------|------|
| Agent A 雇佣 Agent B 做数据分析 | B 可以撒谎说「做完了」然后拿钱 |
| 用户委托 Agent 执行 DeFi 操作 | 执行参数是否符合用户意图无法证明 |
| Agent 市场中的信用评分 | 历史行为无法可信积累 |
| 多 Agent Pipeline 协作 | 上游输出无法被下游合约信任 |

### 竞争空白

| 现有预言机 | 验证什么 | 缺什么 |
|------------|----------|--------|
| Pyth Network | 价格数据 | 不验证 Agent 行为 |
| Switchboard | 任意 Web2 数据（TEE） | 不验证 AI 推理过程 |
| CoolRouter | LLM 输出结果 | 不验证 Agent 是否执行了动作 |

**结论：没有任何现有预言机验证「Agent 行为」，这是真正的生态白地。**

---

## 解决方案

AgentProof 为 AI Agent 的每一个行为颁发链上可验证的「行为证书」。

### 核心机制

```
AI Agent 执行任务
    ↓
构建证据包（输入哈希 + TxSig + 输出哈希）
    ↓
3 个见证节点独立验证链上事实（getTransaction RPC）
    ↓
2-of-3 阈值签名 → 链上程序结算
    ↓
铸造 ProofNFT（行为证书）+ 更新声誉 SBT + 释放报酬（x402）
```

### 信任模型

**AgentProof 的信任根基 = Solana 公共账本，而非任何中心化节点。**

- 见证节点验证的全部是链上已公开的 TxSig 和账户状态
- 任何人用任何 RPC 节点都能独立复核
- 见证节点作恶（签名与链上事实不符）→ Slash 质押金

---

## 四大模块

### 模块1：Agent 注册表（On-chain Registry）
- Agent 在 Solana 上注册身份
- 声明能力范围（Capability Manifest）
- 质押 SOL 作为行为保证金（Slash 机制）
- 积累链上声誉分（不可转让 SBT）

### 模块2：任务证明引擎（Proof Engine）
三层验证：
- Layer 1 — 执行证明（Agent 构建证据包）
- Layer 2 — 链上事实验证（见证节点独立查询链上数据）
- Layer 3 — 链上结算（铸造 ProofNFT + 更新声誉 + 释放报酬）

### 模块3：AI 风控监控
- 实时监控注册 Agent 的行为模式
- 异常检测：失败率异常、输出偏移、重放攻击、ATA 爆炸、SOL 耗尽
- 风险分 > 80 → 自动冻结 Agent（提交链上冻结交易）

### 模块4：消费者 SDK
```typescript
const proof = await AgentProof.verify({
  agentId: "AgentXXX...",
  taskType: "SOLANA_SWAP",
  taskId: "task_001",
  expectedOutput: { tokenIn: "SOL", tokenOut: "USDC", minAmountOut: 95 }
});
if (proof.verified) await releasePayment(proof.taskId);
```

---

## 安全覆盖矩阵

| 风险类型 | AgentProof 覆盖方式 | 覆盖层级 |
|----------|---------------------|----------|
| 静默篡改 | 输入/输出哈希 + TxSig 交叉验证 | ✅ 协议层完整覆盖 |
| 提示词注入 | instruction_hash 链上存证 | 🔍 审计层可查 |
| 伪 AI / Rug Pull | Registry + 质押 + SBT 历史不可伪造 | ✅ 身份层完整覆盖 |
| ATA 账户爆炸 | AI 风控速率监控（10分钟>20个→风险+40） | ⚠️ 行为层告警 |
| 私钥越权操作 | Capability Manifest 权限边界上链 | ✅ 权限层约束 |

---

## 商业模式

| 收入来源 | 单价 | 规模估算 |
|----------|------|----------|
| 验证手续费 | 0.1% of task value | 月10,000任务 × $50 → $500/月 |
| DeFi协议订阅（风险数据API） | $500/协议/月 | 10个协议 → $5,000/月 |
| 节点运营抽成（10%） | - | 节点月奖励$10,000 → $1,000/月 |

**6个月后月收入预估：$6,500/月 → ARR $78,000**
**12个月目标 ARR $500K+**

---

## MVP 范围（3.5 周内必须完成）

| 功能 | 状态 | 原因 |
|------|------|------|
| Agent 注册 + 质押 | ✅ 包含 | 核心 |
| 任务提交 + 见证共识（2-of-3） | ✅ 包含 | 核心 |
| ProofNFT 铸造 | ✅ 包含 | 视觉效果好 |
| AI 风控 + 自动冻结 | ✅ 包含 | 差异化 |
| 声誉 SBT | ✅ 包含 | 技术亮点 |
| x402 支付集成 | ✅ 包含 | Foundation 主推 |
| 真实 TEE 硬件 | ❌ 排除 | 太复杂 |
| 多链支持 | ❌ 排除 | Solana only |
| 治理 DAO | ❌ 排除 | 后续 |
