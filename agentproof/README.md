# AgentProof

> Solana 上第一个可信 AI Agent 行为验证协议
> Colosseum Frontier 2026 参赛项目

**让链上合约能够知道一个 AI Agent 是否真正执行了它声称完成的任务——并在出问题之前就识别出恶意 Agent。**

---

## 项目背景

Solana 承载全球 70% 的 AI Agent 链上活动，但整个 Agent 经济存在根本性缺口：

> 当一个 AI Agent 声称「我已完成了这个任务」，链上合约无法验证这是否是真的。

AgentProof 构建了完整的 AI Agent 全生命周期信任协议：

- **注册审计**：Agent 注册时，自动拉取其历史链上交易，用 Claude Opus 生成初始信用评分（0-100）
- **任务托管**：用户锁 SOL 到链上 Escrow，任务完成才释放，拒绝才退款
- **行为验证**：3 个见证节点独立验证链上事实，2-of-3 阈值签名后自动结算
- **意图审查**：Claude Haiku 在验证时实时判断 Agent 行为是否与声明能力一致
- **EWMA 信用**：每次任务结果通过指数加权移动平均更新链上信用分
- **风险熔断**：AI 风控实时监控异常行为，触发阈值时直接提交 freeze_agent 上链

---

## 系统架构

```
用户锁 SOL → TaskEscrow PDA
    ↓
Agent 执行任务，提交证据包（tx_signature + input_hash + output_hash）
    ↓
见证节点：
  1. ChainVerifier 验证链上事实（Helius getTransaction）
  2. IntentVerifier（Claude Haiku）验证意图是否与 Capability Manifest 一致
    ↓
2-of-3 阈值达成 → 自动结算 Escrow + 更新 EWMA 信用分
    ↓
Risk Monitor 并行监控 → 异常触发 freeze_agent 上链
```

```
┌──────────────────────────────────────────────────────┐
│                    AgentProof 系统                    │
├──────────────────────────────────────────────────────┤
│  AI Agent Layer                                      │
│  Agent 注册（质押 + 声明能力）→ 执行任务 → 提交证明    │
├──────────────────────────────────────────────────────┤
│  中间服务层                                           │
│  audit-engine (port 3002) │ witness-node (port 3001)  │
│  Helius + Claude Opus     │ ChainVerifier + Claude Haiku │
│  历史审计 + 信用评分        │ 实时验证 + 意图审查        │
│                                                      │
│  risk-monitor (port 8000)                            │
│  5 种异常检测 + ChainFreezer → freeze_agent 上链     │
├──────────────────────────────────────────────────────┤
│  Solana Programs (Rust/Anchor)                       │
│  AgentRecord │ TaskEscrow │ TaskProof │ WitnessPool   │
└──────────────────────────────────────────────────────┘
```

---

## 目录结构

```
agentproof/
├── programs/agentproof/       # Solana 链上程序（Rust/Anchor）
│   └── src/
│       ├── lib.rs             # 程序入口，7 个指令
│       ├── errors.rs          # 17 个自定义错误码
│       ├── state/
│       │   ├── agent_record.rs    # EWMA 信用分 + 安全指数
│       │   ├── task_escrow.rs     # SOL 托管账户（NEW）
│       │   ├── task_proof.rs      # 任务证明账户
│       │   └── witness_pool.rs
│       └── instructions/
│           ├── create_task.rs         # 锁 SOL 到 Escrow（NEW）
│           ├── register_agent.rs
│           ├── submit_proof.rs
│           ├── witness_sign.rs        # 2-of-3 + 自动 Escrow 结算（UPDATED）
│           ├── settle_task.rs         # TaskSettled 事件（NEW）
│           ├── freeze_agent.rs
│           ├── register_witness.rs
│           └── initialize_witness_pool.rs
├── audit-engine/              # 历史审计服务（Node.js/TypeScript）（NEW）
│   └── src/
│       ├── index.ts           # Express 入口，port 3002
│       ├── helius-fetcher.ts  # 拉取历史 tx（getSignaturesForAddress）
│       ├── tx-summarizer.ts   # 解析 tx → 结构化摘要
│       ├── claude-auditor.ts  # Claude Opus 生成信用评分
│       ├── manifest-store.ts  # Capability Manifest 内存存储
│       └── routes.ts          # /audit + /manifest API
├── witness-node/              # 见证节点服务（Node.js/TypeScript）
│   └── src/
│       ├── index.ts
│       ├── verifier.ts        # 链上事实验证（Helius RPC）
│       ├── intent-verifier.ts # Claude Haiku 意图验证（NEW）
│       ├── signer.ts          # 见证签名
│       ├── chain-client.ts    # Solana 合约调用
│       ├── types.ts           # IntentResult + VerifyResult（UPDATED）
│       └── api.ts             # REST API（集成 IntentVerifier）（UPDATED）
├── risk-monitor/              # AI 风控服务（Python/FastAPI）
│   ├── main.py
│   ├── chain_freezer.py       # 提交 freeze_agent 上链（NEW）
│   ├── chain_reader.py
│   ├── models/
│   │   ├── detectors.py       # 5 种异常检测器
│   │   └── risk_model.py      # 风险评分聚合
│   └── api/routes.py          # 风控 API（集成 ChainFreezer）（UPDATED）
├── app/                       # Next.js 前端
│   └── src/
│       ├── app/
│       │   ├── page.tsx           # 首页
│       │   ├── register/page.tsx  # 注册 + 审计结果展示（UPDATED）
│       │   ├── verify/page.tsx    # 验证 + 意图审查结果（UPDATED）
│       │   ├── monitor/page.tsx   # 风控监控大盘
│       │   └── agent/[pubkey]/    # Agent 详情（credit_score + safety_index）
│       ├── components/
│       └── lib/
│           ├── agentproof-sdk.ts  # IntentResult 类型 + AgentRecord 反序列化（UPDATED）
│           └── task-types.ts
├── tests/agentproof.ts        # Anchor 集成测试
├── scripts/
│   ├── deploy.sh
│   └── seed-demo.ts
└── Anchor.toml
```

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 链上程序 | Rust + Anchor 0.30 | 7 个指令，4 种 PDA |
| 见证网络 | Node.js/TypeScript | ChainVerifier + Claude Haiku 意图验证 |
| 历史审计 | Node.js/TypeScript + Claude Opus | Helius 拉取历史 tx，生成初始信用评分 |
| AI 风控 | Python/FastAPI + scikit-learn | 5 种检测器，ChainFreezer 直接上链冻结 |
| 前端 | Next.js 14 + Phantom Wallet | 4 个页面，展示审计/验证/风控全流程 |
| RPC 层 | Helius API | 历史交易查询 + 实时事件监听 |
| AI 模型 | Claude Opus（审计）/ Claude Haiku（意图） | 通过 ANTHROPIC_AUTH_TOKEN 代理接入 |

---

## 快速开始

### 前置条件

```bash
node --version    # >= 20.0.0
python3 --version # >= 3.11.0
rustc --version   # >= 1.75.0
solana --version  # >= 1.18.0
anchor --version  # >= 0.30.0
```

### 1. 部署链上程序

```bash
# 配置 Devnet 并获取测试 SOL
solana config set --url https://api.devnet.solana.com
solana airdrop 5

# 一键部署（自动构建、部署）
bash scripts/deploy.sh
```

### 2. 启动历史审计引擎（audit-engine，port 3002）

```bash
cd audit-engine
cp .env.example .env
# 填写 HELIUS_API_KEY、ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL
npm install
npm run dev
# → [audit-engine] listening on port 3002
```

### 3. 启动见证节点（witness-node，port 3001）

```bash
cd witness-node
cp .env.example .env
# 填写 HELIUS_RPC_URL、WITNESS_PRIVATE_KEY、ANTHROPIC_AUTH_TOKEN、AUDIT_ENGINE_URL
npm install
npm run dev
# → AgentProof Witness Node running on port 3001
```

### 4. 启动 AI 风控服务（risk-monitor，port 8000）

```bash
cd risk-monitor
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 填写 HELIUS_RPC_URL、RISK_MONITOR_AUTHORITY_KEY（用于提交 freeze_agent 上链）
python main.py
# → Uvicorn running on http://0.0.0.0:8000
```

### 5. 启动前端（port 3000）

```bash
cd app
npm install
cp .env.local.example .env.local
# 填写 HELIUS_RPC_URL、AGENTPROOF_PROGRAM_ID
npm run dev
# → ready - http://localhost:3000
```

### 6. 运行测试

```bash
anchor test
# agentproof
#   ✓ initializes witness pool
#   ✓ registers an agent
#   ✓ submits a task proof
#   ✓ witnesses sign and proof reaches 2-of-3 threshold
# 4 passing
```

---

## 环境变量

### audit-engine/.env

```env
HELIUS_API_KEY=your_helius_api_key
ANTHROPIC_AUTH_TOKEN=your_anthropic_token
ANTHROPIC_BASE_URL=https://your-proxy-url    # 可选，不填则直连 Anthropic
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=your_helius_api_key
PORT=3002
```

### witness-node/.env

```env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
WITNESS_PRIVATE_KEY=YOUR_KEYPAIR_BASE58
AGENTPROOF_PROGRAM_ID=GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG
ANTHROPIC_AUTH_TOKEN=your_anthropic_token    # 用于 Claude Haiku 意图验证
ANTHROPIC_BASE_URL=https://your-proxy-url    # 可选
AUDIT_ENGINE_URL=http://localhost:3002        # Capability Manifest 查询
PORT=3001
```

### risk-monitor/.env

```env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
RISK_MONITOR_AUTHORITY_KEY=YOUR_KEYPAIR_BASE58   # 用于提交 freeze_agent 上链
PROGRAM_ID=GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG
SOLANA_RPC_URL=https://api.devnet.solana.com
PROOF_ENGINE_URL=http://localhost:3001
FREEZE_THRESHOLD=80
PORT=8000
```

### app/.env.local

```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID=GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG
NEXT_PUBLIC_WITNESS_NODE_URL=http://localhost:3001
NEXT_PUBLIC_RISK_MONITOR_URL=http://localhost:8000
```

---

## 链上程序指令

| 指令 | 说明 |
|------|------|
| `initialize_witness_pool` | 初始化见证节点池（管理员一次性操作） |
| `register_agent` | Agent 注册 + 质押 SOL（最低 0.1 SOL），初始信用分由质押量决定 |
| `register_witness` | 见证节点注册 + 质押 |
| `create_task` | 用户锁 SOL 到 TaskEscrow PDA，绑定 task_id 和 Agent |
| `submit_proof` | Agent 提交任务证据包（tx_sig + input_hash + output_hash） |
| `witness_sign` | 见证节点签名；2-of-3 后自动结算 Escrow，更新 EWMA 信用分 |
| `freeze_agent` | AI 风控触发冻结（AgentRecord.is_frozen = true，永久链上记录） |

### PDA 设计

```
AgentRecord:  seeds = [b"agent",        agent_pubkey]
TaskEscrow:   seeds = [b"escrow",       task_id]       ← NEW
TaskProof:    seeds = [b"proof",        task_id]
WitnessPool:  seeds = [b"witness_pool"]
WitnessRecord:seeds = [b"witness",      witness_pubkey]
```

### TaskEscrow 状态机

```
status = 0 (Locked)
  → 2-of-3 见证通过 → status = 1 (Released)  → SOL 转给 Agent
  → 2-of-3 见证拒绝 → status = 2 (Refunded)  → SOL 退给 User
```

### AgentRecord EWMA 信用分

```
新分数 = (旧分数 × 80 + 任务分 × 20) / 100

任务分：通过 = 100，拒绝 = 0，意图不符 → 强制拒绝
初始分：50（质押 ≥ 1 SOL → 55，质押 ≥ 5 SOL → 60）
```

---

## API 文档

### audit-engine API（port 3002）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/audit` | 触发历史审计（拉取 Helius tx → Claude Opus 评分） |
| `GET` | `/audit/:agent_pubkey` | 查询缓存审计结果 |
| `POST` | `/manifest` | 上传 Capability Manifest（返回 SHA-256 hash） |
| `GET` | `/manifest/:capability_hash` | 按 hash 查询 Manifest |
| `GET` | `/manifest/pubkey/:agent_pubkey` | 按 Agent 公钥查询 Manifest |

**POST /audit 请求体：**
```json
{
  "agent_pubkey": "AgentXXX...",
  "capability_manifest": {
    "name": "ProfitQueen",
    "goal": "SOL/USDC 套利，每笔目标收益 ≥ 2%",
    "allowed_programs": ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]
  }
}
```

**POST /audit 响应：**
```json
{
  "credit_score": 72,
  "safety_index": 68,
  "risk_flags": ["高频小额转账（可能是手续费套利）"],
  "audit_summary": "该地址历史 234 笔交易，主要与 Jupiter 交互，未发现高风险行为。",
  "tx_count": 234
}
```

### witness-node API（port 3001）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/v1/verify` | 提交验证请求（含意图审查） |
| `GET` | `/api/v1/proof/:taskId` | 查询验证状态 |
| `GET` | `/api/v1/agent/:pubkey` | 查询 Agent 信息 |
| `POST` | `/api/v1/freeze` | 触发冻结（由风控调用） |

**POST /api/v1/verify 响应（含意图验证）：**
```json
{
  "approved": true,
  "signature_count": 2,
  "intent_result": {
    "aligned": true,
    "confidence": 0.91,
    "reason": "实际 swap 操作与声明的套利策略一致，收益率 2.3% 符合目标。",
    "risk_flags": []
  }
}
```

### risk-monitor API（port 8000）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/v1/proof_event` | 上报任务证明事件 |
| `POST` | `/api/v1/analyze` | 分析 Agent 风险评分 |
| `GET` | `/api/v1/risk/:agent_id` | 获取缓存风险评分 |
| `GET` | `/api/v1/alerts` | 高风险告警列表 |
| `GET` | `/api/v1/agents` | 列出所有监控中的 Agent |
| `GET` | `/metrics` | Prometheus 指标 |

---

## Demo 场景

### 场景 1：Agent 注册 + 历史审计

```bash
# 1. 连接 Phantom 钱包，进入 /register 页面
# 2. 填写 Capability Manifest（Agent 能力声明）
# 3. 质押 0.1 SOL 完成链上注册
# 4. 页面自动调用 audit-engine 分析历史链上行为
# 5. 展示：初始信用分 / 安全指数 / 风险标记 / 分析交易数量
```

### 场景 2：正常任务验证（含意图审查）

```bash
# Agent 完成 SOL→USDC Swap 后提交证明
curl -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "task_swap_001",
    "agent_pubkey": "AgentB...",
    "task_type": "SOLANA_SWAP",
    "tx_signature": "5xyzActualTxSig...",
    "input_hash": "abc123...",
    "output_hash": "def456...",
    "slot": 12345678
  }'

# 返回：
# {
#   "approved": true,
#   "intent_result": { "aligned": true, "confidence": 0.91, "reason": "..." }
# }
```

### 场景 3：意图不符 → 自动拒绝

```bash
# Agent 声明只做 Jupiter Swap，实际却调用了高风险合约
# IntentVerifier 返回 aligned: false
# → verification.approved 强制设为 false
# → Escrow 退款给用户，EWMA 信用分扣减
```

### 场景 4：恶意 Agent 被风控冻结

```bash
# 模拟高频失败 + 重放攻击，触发风险分 > 80
cd risk-monitor
python scripts/simulate_malicious_agent.py

# risk-monitor 自动：
# 1. 调用 witness-node /api/v1/freeze（HTTP 通知）
# 2. 调用 ChainFreezer.freeze_on_chain()（提交 freeze_agent 指令上链）
# 3. AgentRecord.is_frozen = true（链上永久记录，不可撤销）
```

---

## 风控模型

风险评分由 5 个独立检测器组成（0-100分），超过 80 自动触发链上冻结：

| 检测器 | 检测内容 | 最高分 |
|--------|----------|--------|
| FailureRateDetector | 近 20 次任务失败率 > 50% | 40 |
| ReplayAttackDetector | output_hash 重复提交（重放攻击） | 30 |
| ATACreationDetector | 10 分钟内创建 > 20 个 ATA 账户 | 40 |
| SOLDrainDetector | 5 分钟内 SOL 减少 > 2 | 30 |
| OutputDriftDetector | 输出结果偏离历史分布 | 20 |

**冻结流程：**
```
风险分 > 80
  → POST /api/v1/freeze（HTTP 通知 witness-node）
  → ChainFreezer.freeze_on_chain(agent_pubkey, reason)
      → Anchor discriminator + Borsh 编码
      → getLatestBlockhash → sendTransaction（base64）
      → AgentRecord.is_frozen = true
```

---

## 健康检查

```bash
curl http://localhost:3002/health
# {"status":"ok","service":"audit-engine"}

curl http://localhost:3001/health
# {"status":"ok","witness_pubkey":"...","timestamp":...}

curl http://localhost:8000/health
# {"status":"ok","service":"AgentProof Risk Monitor","version":"0.1.0"}

solana account GdJFUktyh4SFxDfqeFE33KvXf5u6TMrDzmMs5Je2NKjG --url devnet
# executable: true
```

---

## 商业模式

| 收入来源 | 单价 |
|----------|------|
| 验证手续费 | 0.1% of task value |
| DeFi 协议订阅（风险数据 API）| $500/协议/月 |
| 节点运营抽成 | 10% of 节点奖励 |

**6 个月目标：ARR $78K → 12 个月目标：ARR $500K+**

---

## License

MIT
