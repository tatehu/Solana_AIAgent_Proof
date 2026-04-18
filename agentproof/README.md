# AgentProof

> Solana 上第一个可信 AI Agent 行为验证协议
> Colosseum Frontier 2026 参赛项目

**让链上合约能够知道一个 AI Agent 是否真正执行了它声称完成的任务。**

---

## 项目背景

Solana 承载全球 70% 的 AI Agent 链上活动，但整个 Agent 经济存在根本性缺口：

> 当一个 AI Agent 声称「我已完成了这个任务」，链上合约无法验证这是否是真的。

AgentProof 为每一个 AI Agent 行为颁发链上可验证的「行为证书」，信任根基是 **Solana 公共账本**，而非任何中心化节点。

---

## 系统架构

```
AI Agent 执行任务
    ↓
构建证据包（input_hash + TxSig + output_hash）
    ↓
3 个见证节点独立验证链上事实（getTransaction RPC）
    ↓
2-of-3 阈值签名 → 链上程序结算
    ↓
铸造 ProofNFT + 更新声誉 SBT + 释放报酬（x402）
```

```
┌─────────────────────────────────────────────┐
│              AgentProof 系统                 │
├─────────────────────────────────────────────┤
│  AI Agent Layer                             │
│  Agent A (委托) ← AgentProof → Agent B (执行)│
├─────────────────────────────────────────────┤
│  中间层                                      │
│  Proof Engine (Node.js)  Risk Monitor (AI)  │
│           ↕ Helius WebSocket ↕              │
├─────────────────────────────────────────────┤
│  Solana Programs (Rust/Anchor)              │
│  Agent Registry | Proof Settlement | SBT    │
└─────────────────────────────────────────────┘
```

---

## 目录结构

```
agentproof/
├── programs/agentproof/       # Solana 链上程序（Rust/Anchor）
│   └── src/
│       ├── lib.rs             # 程序入口，6 个指令
│       ├── errors.rs          # 自定义错误码
│       ├── state/             # 账户数据结构
│       │   ├── agent_record.rs
│       │   ├── task_proof.rs
│       │   └── witness_pool.rs
│       └── instructions/      # 指令处理函数
│           ├── register_agent.rs
│           ├── submit_proof.rs
│           ├── witness_sign.rs
│           ├── freeze_agent.rs
│           ├── register_witness.rs
│           └── initialize_witness_pool.rs
├── witness-node/              # 见证节点服务（Node.js/TypeScript）
│   └── src/
│       ├── index.ts           # 服务入口
│       ├── verifier.ts        # 链上事实验证核心逻辑
│       ├── signer.ts          # 见证签名管理
│       └── api.ts             # REST API
├── risk-monitor/              # AI 风控服务（Python/FastAPI）
│   ├── main.py
│   ├── models/
│   │   ├── detectors.py       # 5 种异常检测器
│   │   └── risk_model.py      # 风险评分聚合模型
│   ├── api/routes.py
│   └── scripts/simulate_malicious_agent.py
├── app/                       # Next.js 前端
│   └── src/
│       ├── app/               # 4 个页面
│       ├── components/        # WalletProvider, Navigation
│       └── lib/               # SDK + Solana 工具
├── sdk/                       # Consumer SDK（npm 包）
├── tests/agentproof.ts        # Anchor 集成测试
├── scripts/
│   ├── deploy.sh              # 一键 Devnet 部署
│   └── seed-demo.ts           # Demo 数据初始化
├── docker-compose.yml         # 3 节点集群编排
└── Anchor.toml
```

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 链上程序 | Rust + Anchor | 0.30+ |
| Token 标准 | Token-2022 + SBT 扩展 | - |
| 支付集成 | x402 协议 | - |
| RPC 层 | Helius WebSocket | - |
| 见证节点 | Node.js + TypeScript | 20+ |
| AI 风控 | Python + FastAPI + scikit-learn | 3.11+ |
| 前端 | Next.js 14 + Phantom Wallet | 14 |

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

# 一键部署（自动生成密钥、构建、部署）
bash scripts/deploy.sh
```

### 2. 启动见证节点

```bash
cd witness-node
cp .env.example .env
# 填写 HELIUS_API_KEY 和 WITNESS_PRIVATE_KEY
npm install
npm run dev
# → 🔍 AgentProof Witness Node running on port 3001
```

### 3. 启动 AI 风控服务

```bash
cd risk-monitor
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
# → INFO: Uvicorn running on http://0.0.0.0:8000
```

### 4. 启动前端

```bash
cd app
npm install
cp .env.local.example .env.local
# 填写 HELIUS_API_KEY 和 AGENTPROOF_PROGRAM_ID
npm run dev
# → ready - http://localhost:3000
```

### 5. 运行测试

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

### witness-node/.env

```env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
WITNESS_PRIVATE_KEY=YOUR_KEYPAIR_BASE58
AGENTPROOF_PROGRAM_ID=YOUR_PROGRAM_ID
PORT=3001
```

### risk-monitor/.env

```env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
RISK_MONITOR_PRIVATE_KEY=YOUR_KEYPAIR_BASE58
AGENTPROOF_PROGRAM_ID=YOUR_PROGRAM_ID
PROOF_ENGINE_URL=http://localhost:3001
FREEZE_THRESHOLD=80
PORT=8000
```

### app/.env.local

```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID=YOUR_PROGRAM_ID
NEXT_PUBLIC_WITNESS_NODE_URL=http://localhost:3001
NEXT_PUBLIC_RISK_MONITOR_URL=http://localhost:8000
```

---

## API 文档

### 见证节点 API（port 3001）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/v1/verify` | 提交验证请求 |
| `GET` | `/api/v1/proof/:taskId` | 查询验证状态 |
| `GET` | `/api/v1/agent/:pubkey` | 查询 Agent 信息 |
| `POST` | `/api/v1/freeze` | 触发冻结（由风控调用） |

### AI 风控 API（port 8000）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/v1/proof_event` | 上报任务证明事件 |
| `POST` | `/api/v1/analyze` | 分析 Agent 风险评分 |
| `GET` | `/api/v1/risk/:agent_id` | 获取缓存风险评分 |
| `GET` | `/api/v1/alerts` | 获取高风险告警列表 |
| `GET` | `/api/v1/agents` | 列出所有监控中的 Agent |
| `GET` | `/metrics` | Prometheus 指标 |

---

## SDK 使用

```typescript
import { createClient } from "@agentproof/sdk";

const client = createClient({
  rpcUrl: "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
  programId: "YOUR_PROGRAM_ID",
  witnessNodeUrl: "http://localhost:3001",
  riskMonitorUrl: "http://localhost:8000",
});

// 验证 Agent 是否完成了 Swap 任务
const proof = await client.verify({
  agentId: "AgentXXX...",
  taskType: "SOLANA_SWAP",
  taskId: "task_001",
  txSignature: "5xyz...",
  expectedOutput: { tokenIn: "SOL", tokenOut: "USDC", minAmountOut: 95 },
});

if (proof.verified) {
  await releasePayment(proof.taskId); // x402 自动释放报酬
}

// 查询 Agent 声誉（用于 DeFi 借款上限计算）
const agent = await client.getAgent("AgentXXX...");
const borrowLimit = agent.reputationScore * 10; // 847分 → $8,470 USDC
```

---

## 链上程序指令

| 指令 | 说明 |
|------|------|
| `initialize_witness_pool` | 初始化见证节点池（管理员一次性操作） |
| `register_agent` | Agent 注册 + 质押 SOL（最低 0.1 SOL） |
| `register_witness` | 见证节点注册 + 质押 |
| `submit_proof` | Agent 提交任务证据包 |
| `witness_sign` | 见证节点签名（2-of-3 达成自动结算） |
| `freeze_agent` | AI 风控触发冻结恶意 Agent |

### PDA 设计

```
AgentRecord:    seeds = [b"agent",        agent_pubkey]
TaskProof:      seeds = [b"proof",        task_id]
WitnessPool:    seeds = [b"witness_pool"]
WitnessRecord:  seeds = [b"witness",      witness_pubkey]
StakeVault:     seeds = [b"stake_vault",  agent_pubkey]
```

---

## 风控模型

风险评分由 5 个独立检测器组成，总分 100 分，超过 80 自动触发链上冻结：

| 检测器 | 检测内容 | 最高分 |
|--------|----------|--------|
| FailureRateDetector | 近 20 次任务失败率 > 50% | 40 |
| ReplayAttackDetector | output_hash 重复提交（重放攻击） | 30 |
| ATACreationDetector | 10 分钟内创建 > 20 个 ATA 账户 | 40 |
| SOLDrainDetector | 5 分钟内 SOL 减少 > 2 | 30 |
| OutputDriftDetector | 输出结果偏离历史分布 | 20 |

---

## Demo 场景

### 场景 1：正常任务验证

```bash
# Agent B 完成 SOL→USDC Swap 后提交证明
curl -X POST http://localhost:3001/api/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "task_swap_001",
    "agent_pubkey": "AgentB...",
    "task_type": "SOLANA_SWAP",
    "tx_signature": "5xyzActualTxSig...",
    "input_hash": "abc123...",
    "output_hash": "def456...",
    "instruction_hash": "ghi789...",
    "slot": 12345678
  }'
```

### 场景 2：模拟恶意 Agent 被冻结

```bash
# 模拟攻击行为 → 风险分超过 80 → 自动冻结
cd risk-monitor
python scripts/simulate_malicious_agent.py
```

### 场景 3：DeFi 协议集成 SDK

```bash
# 初始化演示数据
HELIUS_RPC_URL=xxx AGENTPROOF_PROGRAM_ID=xxx tsx scripts/seed-demo.ts
```

---

## 多节点部署

```bash
# 使用 Docker Compose 启动 3 节点见证集群 + 风控服务
cp .env.example .env
# 填写 HELIUS_RPC_URL、3 个 WITNESS_PRIVATE_KEY、RISK_MONITOR_PRIVATE_KEY

docker-compose up -d
```

---

## 健康检查

```bash
curl http://localhost:3001/health
# {"status":"ok","witness_pubkey":"...","timestamp":...}

curl http://localhost:8000/health
# {"status":"ok","service":"AgentProof Risk Monitor","version":"0.1.0"}

solana account YOUR_PROGRAM_ID --url devnet
# executable: true
```

---

## 开发周期

| 周 | 任务 |
|----|------|
| 第 1 周 | Anchor 程序 + 基础测试 |
| 第 2 周 | 见证节点 + AI 风控 |
| 第 3 周 | 前端 + SDK + Demo 脚本 |
| 第 3.5 周 | 联调 + 录制 Pitch 视频 |

---

## 商业模式

| 收入来源 | 单价 |
|----------|------|
| 验证手续费 | 0.1% of task value |
| DeFi 协议订阅（风险数据 API） | $500/协议/月 |
| 节点运营抽成 | 10% of 节点奖励 |

**6 个月目标：ARR $78K → 12 个月目标：ARR $500K+**

---

## License

MIT
