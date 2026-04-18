# 09 — Demo 脚本（评委评审关键）

## Demo 场景总览

| 场景 | 时长 | 关键截图 | 核心信息 |
|------|------|----------|----------|
| 场景1：Agent 雇佣 Agent | 90秒 | ProofNFT + TxSig | 链上可验证行为证明 |
| 场景2：AI 风控拦截恶意 Agent | 60秒 | 折线图突破80 + 冻结 Tx | AI 自动保护 |
| 场景3：消费者 SDK 查询声誉 | 30秒 | 代码 + 借款额度 | 商业场景闭环 |

---

## Demo 场景1：Agent 雇佣 Agent（最核心，约90秒）

### 故事背景
> 用户想让 AI Agent 监控 SOL 价格并在跌破阈值时自动买入。

### 演示步骤

**[0-15秒] Agent 注册展示**
```
打开 http://localhost:3000/register

展示两个已注册 Agent：
├── Agent A (委托方)
│   ├── 公钥: AgentA111...（Devnet 注册）
│   ├── 能力声明: 价格监控、条件触发
│   ├── 质押: 0.5 SOL
│   └── 声誉: 847/1000 ✅
│
└── Agent B (Swap执行方)
    ├── 公钥: AgentB222...（Devnet 注册）
    ├── 能力声明: Solana Swap、DEX 操作
    ├── 质押: 0.5 SOL
    └── 声誉: 923/1000 ✅

「两个 Agent 已在 AgentProof 上注册身份，声明了能力，并质押了 SOL 作为信用保证金。」
```

**[15-35秒] 用户委托 + Agent 执行**
```
展示控制台/代码：

# 用户下达指令
User → Agent A: "当 SOL < $150 时买入 1 SOL"
instruction_hash = sha256("buy 1 SOL when price < $150")
# → 指令哈希立即上链（防提示词注入）
# TxSig: [上链指令记录的实际交易签名]

# 价格触发
Agent A 检测到 SOL = $148 → 触发条件满足
Agent A → Agent B: "执行 Swap: 148 USDC → 1 SOL"

# Agent B 执行 Jupiter Swap
[打开 Solana Explorer，展示实际 Devnet 交易]
TxSig: 5abc...xyz
Slot: 287,341,882
程序: Jupiter Aggregator v6
输入: 148 USDC  输出: 1.0 SOL ✅
```

**[35-65秒] 见证节点验证过程**
```
展示见证节点日志（3 个终端并排）：

Witness Node 1 (port 3001):
  [Verify] Task task_swap_001: Checking...
  → getTransaction(5abc...xyz) ✓ Found
  → Slot: 287341882 (claimed: 287341882) ✓ Match
  → Output: 1.0 SOL ≥ 0.95 SOL (min) ✓ Pass
  → Signing: APPROVED ✅

Witness Node 2 (port 3002):
  [Verify] Task task_swap_001: APPROVED ✅

(2-of-3 threshold reached!)
[Verify] Submitting aggregated signature to chain...

「3 个独立见证节点同时查询 Solana 公链——
  任何人用任何 RPC 节点都能得到同样结果。
  这就是 AgentProof 的信任根基。」
```

**[65-80秒] ProofNFT 铸造 + 结算**
```
[前端展示 ProofNFT 卡片]

┌─────────────────────────────────────────┐
│  🏅 AgentProof Certificate              │
│                                         │
│  Task: SOLANA_SWAP                      │
│  Agent: AgentB222...                    │
│  TxSig: 5abc...xyz                      │
│  Slot: 287,341,882                      │
│  Witnesses: 2/3 verified                │
│  Verified At: 2026-04-18 14:32:01 UTC   │
│                                         │
│  「这个 Swap 确实由 Agent B              │
│   在 Slot 287,341,882 执行，            │
│   且参数符合用户意图。」                  │
└─────────────────────────────────────────┘

x402 支付释放：
  Agent B 收到 0.5 USDC 任务报酬 ✅
  [展示链上支付 Tx]
```

**[80-90秒] 声誉更新**
```
Agent B 声誉更新：
  Before: 923/1000
  After:  924/1000 (+1)
  SBT Token 同步更新 ✅

「每一次验证成功，都永久记录在 Solana 链上。
  这就是 Agent 信用系统的基础。」
```

---

## Demo 场景2：AI 风控拦截恶意 Agent（约60秒）

### 故事背景
> 展示 AgentProof 的 AI 自动保护能力。

### 演示步骤

**[0-10秒] 正常状态**
```
打开 http://localhost:3000/monitor

展示风控仪表盘：
  Agent C (监控对象): MaliciousAgent111...
  风险评分: 25 / 100 ✅ SAFE
  实时折线图：评分稳定在 20-30 范围
```

**[10-35秒] 模拟攻击行为（运行脚本）**
```bash
# 在后台终端运行
python scripts/simulate_malicious_agent.py

# 实时输出：
# ⚠️  Attack task 1/15
# ⚠️  Attack task 2/15
# ...（重放攻击 + 高失败率 + ATA 爆炸）
```

```
[前端仪表盘实时更新]

时间线：
  14:33:00  Score: 25  ✅ SAFE
  14:33:03  Score: 35  ✅ SAFE
  14:33:06  Score: 52  ⚠️ WARNING
  14:33:09  Score: 71  ⚠️ WARNING
  14:33:12  Score: 88  🚨 DANGER!

「风险评分突破 80 阈值！」

告警面板显示：
  ⚠️ 高失败率: 60.0%
  ⚠️ 检测到重复输出哈希（疑似重放攻击）
  ⚠️ ATA账户创建速率异常
```

**[35-50秒] 自动冻结**
```
[仪表盘显示红色告警横幅]
🚨 FREEZE TRIGGERED — Submitting freeze transaction to Solana...

[打开 Solana Explorer]
FreezeAgent Tx 确认：
  Program: AgentProof (AgPr111...)
  Instruction: FreezeAgent
  Target: MaliciousAgent111...
  Status: ✅ Confirmed (Slot: 287,342,100)

「AI 风控引擎自动提交了冻结交易。
  这个 Agent 的质押金将被 Slash。」
```

**[50-60秒] 影响展示**
```
[尝试提交新任务]
Error: Agent is frozen and cannot perform actions
  AgentProofError::AgentFrozen

「被冻结的 Agent 无法再提交任何任务。
  所有依赖这个 Agent 的 DeFi 协议都得到了保护。」
```

---

## Demo 场景3：消费者 SDK（约30秒）

### 故事背景
> 一个 DeFi 借贷协议想根据 Agent 的历史表现调整借款上限。

### 演示步骤（代码演示）

```typescript
// 在终端/代码编辑器中展示，约30秒

import { createClient } from "@agentproof/sdk";

const client = createClient({
  rpcUrl: "https://devnet.helius-rpc.com/?api-key=...",
  programId: "AgPr111...",
  witnessNodeUrl: "http://localhost:3001",
});

// 查询 Agent 档案
const agent = await client.getAgent("AgentB222...");
console.log(agent.reputationScore);  // 924
console.log(agent.successRate);      // 98.4%
console.log(agent.lastVerifiedTask); // ProofNFT 链接

// DeFi 协议根据声誉决定借款上限
const maxBorrow = agent.reputationScore * 10;
console.log(`Max Borrow: $${maxBorrow.toLocaleString()} USDC`);
// → Max Borrow: $9,240 USDC

// 实时输出（在终端中展示）：
// Agent AgentB222...:
//   Reputation: 924/1000
//   Success Rate: 98.4%
//   Total Tasks: 157
//   Max Borrow Limit: $9,240 USDC
```

---

## Pitch 视频脚本（3分钟）

```
[0:00-0:30] 问题（钩子）
画面：Solana 链上交易流动图

旁白：
「Solana 上有 50,000 个 AI Agent 在自主运行。
 它们买卖代币、分析数据、相互雇佣完成任务。
 但当一个 Agent 说'我完成了任务'——
 你怎么知道它说的是真的？
 今天，你不知道。
 AgentProof 改变这一切。」

[0:30-1:30] 解决方案 + Demo
画面：Demo 场景1 录屏

旁白：
「AgentProof 是 Solana 上第一个 AI Agent 行为验证协议。
 [展示 ProofNFT 铸造]
 每一个 Agent 的行为，都由多个见证节点验证，
 每一次验证，都永久记录在 Solana 链上。
 见证节点验证的不是 Agent 的自述——
 而是 Solana 公共账本上的客观事实：
 这笔 Swap 交易，真实存在，参数匹配，结果可查。
 任何人，任何时候，都能独立复核。」

[1:30-2:30] 技术差异化 + AI 风控
画面：Demo 场景2 录屏（折线图上升 + 冻结 Tx）

旁白：
「我们不是又一个价格 Oracle。
 Pyth 告诉你 SOL 的价格。
 AgentProof 告诉你 Agent 是否按你的要求执行。
 [折线图突破80，FREEZE TRIGGERED]
 我们的 AI 风控引擎实时监控每一个 Agent 的行为——
 失败率异常、重放攻击、账户爆炸——
 自动冻结，链上留证，质押金 Slash。
 我们无法让 AI 变聪明，
 但我们能让 AI 的每一次失控都付出代价。」

[2:30-3:00] 商业 + 号召
画面：Demo 场景3 代码 + 财务模型

旁白：
「Agent 经济需要信任基础设施。
 AgentProof 就是这层基础设施。
 三层商业模式：验证手续费、DeFi 协议订阅、节点抽成。
 Solana 上 50,000 个活跃 Agent，
 每一个 Agent-to-Agent 的委托都是我们的市场。
 加入我们，让 AI Agent 在 Solana 上真正可信。」
```

---

## 评委 Q&A 快速参考

**Q: 和 Pyth/Switchboard 有什么不同？**
> Pyth 验证「数据」（价格），AgentProof 验证「行为」（Agent 是否真正执行了任务）。
> 就像征信公司和价格数据商是两个不同行业。

**Q: 见证节点都是你们运营的，不就是中心化吗？**
> 我们验证的是 Solana 公共账本的客观事实，任何人用任何 RPC 都能独立复核。
> 见证节点无法造假——作恶会被链上程序自动 Slash 质押金。

**Q: 和 Solana Foundation 的 SATI 有什么区别？**
> SATI 做身份注册，我们做行为验证。两者互补——注册在 SATI，行为验证用 AgentProof。
> SATI 没有 Slash 机制、没有 AI 风控引擎、没有行为证明 NFT。

**Q: 商业模式？**
> 三层：验证手续费（0.1% of task value）+ 企业风控订阅（$500/协议/月）+ 节点抽成（10%）。
> 12个月目标 ARR $500K+（基于 50,000+ Solana Agent 月活估算）。

**Q: 为什么选 Solana？**
> Solana 的 400ms 出块速度 + 极低费用让 Agent 自主操作成为可能。
> 我们的验证流程利用 Solana 账本的即时确认性——见证节点在几秒内完成验证，
> 这在其他链上是不可能的。

**Q: 技术上最难的部分是什么？**
> 建立「不信任 Agent 自述、只信任链上事实」的验证模型。
> 传统 Oracle 验证外部数据，我们验证内部行为——需要将 Solana TxSig 和账户状态变化
> 作为「客观行为证据」，这是核心创新。
