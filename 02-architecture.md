# 02 — 系统架构

## 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentProof 系统架构                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   AI Agent Layer                                            │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│   │ Agent A  │  │ Agent B  │  │ Agent C  │               │
│   │(委托方)  │  │(执行方)  │  │(验证节点)│               │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│        │              │              │                      │
│   ─────┼──────────────┼──────────────┼─────────────────    │
│        ▼              ▼              ▼                      │
│   ┌─────────────────────────────────────────────┐         │
│   │           AgentProof 中间层                  │         │
│   │  ┌──────────────┐  ┌─────────────────────┐ │         │
│   │  │ Proof Engine │  │  Risk Monitor (AI)  │ │         │
│   │  │  (Node.js)   │  │  (Python/FastAPI)   │ │         │
│   │  └──────┬───────┘  └──────────┬──────────┘ │         │
│   │         │                     │             │         │
│   │  ┌──────▼─────────────────────▼──────────┐ │         │
│   │  │         Helius RPC / WebSocket         │ │         │
│   │  └──────────────────┬────────────────────┘ │         │
│   └─────────────────────┼────────────────────── ┘         │
│                          │                                  │
│   ─────────────────────  │  ─────────────────────────      │
│                          ▼                                  │
│   Solana Programs (Rust/Anchor)                            │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│   │ Agent        │  │ Proof        │  │ Reputation   │   │
│   │ Registry     │  │ Settlement   │  │ SBT Minter   │   │
│   └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级           | 技术选择                                | 版本           | 理由                |
| ------------ | ----------------------------------- | ------------ | ----------------- |
| **链上程序**     | Rust + Anchor Framework             | Anchor 0.30+ | Solana 标准，评委期待    |
| **Token 标准** | Token-2022 + SBT 扩展                 | -            | 声誉积分不可转让          |
| **支付集成**     | x402 协议                             | -            | Foundation 主推，加分项 |
| **RPC 层**    | Helius WebSocket                    | -            | 实时任务状态监听，无延迟      |
| **见证节点**     | Node.js + TypeScript                | Node 20+     | 快速实现多签共识          |
| **AI 风控**    | Python + FastAPI + scikit-learn     | Python 3.11+ | AI 经验优势           |
| **前端**       | Next.js 14 + Phantom Wallet Adapter | Next 14      | 快速交付可用 Demo       |
| **签名聚合**     | @solana/web3.js 多签                  | -            | 无需实现复杂密码学         |

---

## 目录结构

```
agentproof/
├── programs/
│   └── agentproof/           # Anchor 程序（Rust）
│       ├── src/
│       │   ├── lib.rs         # 程序入口，指令路由
│       │   ├── state/         # 账户数据结构
│       │   │   ├── agent_record.rs
│       │   │   ├── task_proof.rs
│       │   │   └── witness_pool.rs
│       │   ├── instructions/  # 指令处理函数
│       │   │   ├── register_agent.rs
│       │   │   ├── submit_proof.rs
│       │   │   ├── finalize_proof.rs
│       │   │   └── freeze_agent.rs
│       │   └── errors.rs      # 自定义错误码
│       └── Cargo.toml
├── witness-node/              # 见证节点服务（Node.js/TypeScript）
│   ├── src/
│   │   ├── index.ts           # 服务入口
│   │   ├── verifier.ts        # 链上事实验证核心逻辑
│   │   ├── signer.ts          # 见证签名管理
│   │   └── api.ts             # REST API 端点
│   ├── package.json
│   └── tsconfig.json
├── risk-monitor/              # AI 风控服务（Python/FastAPI）
│   ├── main.py                # FastAPI 应用入口
│   ├── models/
│   │   ├── risk_model.py      # 风险评分模型
│   │   └── detectors.py       # 各类异常检测器
│   ├── api/
│   │   └── routes.py          # API 路由
│   ├── solana_client.py       # Solana 链上操作
│   └── requirements.txt
├── app/                       # Next.js 前端
│   ├── src/
│   │   ├── app/               # App Router
│   │   │   ├── page.tsx       # 首页（Dashboard）
│   │   │   ├── register/      # Agent 注册页
│   │   │   ├── verify/        # 任务验证页
│   │   │   └── monitor/       # 风控仪表盘
│   │   ├── components/
│   │   │   ├── AgentCard.tsx
│   │   │   ├── ProofNFTCard.tsx
│   │   │   ├── RiskDashboard.tsx
│   │   │   └── WalletButton.tsx
│   │   └── lib/
│   │       ├── agentproof-sdk.ts  # 前端 SDK
│   │       └── solana.ts          # Solana 工具函数
│   ├── package.json
│   └── next.config.js
├── sdk/                       # Consumer SDK（npm 包）
│   ├── src/
│   │   ├── index.ts
│   │   ├── client.ts
│   │   └── types.ts
│   └── package.json
├── tests/                     # 集成测试
│   ├── agentproof.ts          # Anchor 测试
│   └── e2e/                   # 端到端测试
├── scripts/                   # 部署和工具脚本
│   ├── deploy.sh
│   └── seed-demo.ts           # Demo 数据初始化
├── Anchor.toml
└── package.json               # 根工作区（pnpm monorepo）
```

---

## 数据流

### 任务提交与验证流程

```
1. Agent 执行任务（如 Jupiter Swap）
   ├── 获得 TxSig（链上交易签名）
   ├── 计算 input_hash（任务参数哈希）
   ├── 计算 output_hash（执行结果哈希）
   └── 计算 instruction_hash（用户原始指令哈希）

2. Agent 调用 witness-node API
   POST /api/v1/verify
   {
     task_id, agent_pubkey, task_type,
     tx_signature, input_hash, output_hash, instruction_hash,
     slot, expected_output
   }

3. 见证节点独立验证（3 个节点并行）
   ├── getTransaction(tx_signature) → 确认存在 + 解析
   ├── 验证交易参数 vs input_hash
   ├── 验证执行结果 vs output_hash
   ├── 检查能力边界（Capability Manifest）
   └── 签名结果（approve / reject + reason）

4. 聚合 2-of-3 签名 → 提交链上程序
   agentproof::finalize_proof(task_proof, signatures)

5. 链上程序执行
   ├── 铸造 ProofNFT（Token-2022）
   ├── 更新 Agent SBT 声誉分
   ├── 触发 x402 支付释放
   └── 失败时 Slash Agent 保证金

6. AI 风控持续监控
   ├── 订阅链上 Agent 行为事件
   ├── 更新行为特征向量
   ├── 计算风险评分
   └── 风险 > 80 → 提交冻结交易
```

---

## 账户模型（PDA 设计）

```
AgentRecord PDA：
  seeds = [b"agent", agent_pubkey]
  存储：身份、能力哈希、质押、声誉、任务统计、冻结状态

TaskProof PDA：
  seeds = [b"proof", task_id]
  存储：任务参数哈希、TxSig、见证人、签名、验证状态

WitnessPool PDA：
  seeds = [b"witness_pool"]
  存储：已注册见证节点列表、质押要求

ReputationSBT：
  Token-2022 NFT，transfer hook 禁止转移
  Metadata：reputation_score, total_tasks, success_rate
```

---

## 接口规范

### 见证节点 REST API

```
POST /api/v1/verify          # 提交验证请求
GET  /api/v1/proof/:task_id  # 查询验证状态
GET  /api/v1/agent/:pubkey   # 查询 Agent 信息
GET  /health                 # 健康检查
```

### AI 风控 REST API

```
POST /api/v1/analyze         # 分析 Agent 风险
GET  /api/v1/risk/:agent_id  # 获取当前风险评分
GET  /api/v1/alerts          # 获取告警列表
POST /api/v1/freeze          # 手动触发冻结（管理员）
GET  /metrics                # Prometheus 指标
```

---

## 环境变量

### 见证节点（witness-node/.env）
```env
HELIUS_API_KEY=your_helius_api_key
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
WITNESS_PRIVATE_KEY=your_witness_keypair_base58
AGENTPROOF_PROGRAM_ID=your_program_id
PORT=3001
NODE_ENV=development
```

### AI 风控（risk-monitor/.env）
```env
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
RISK_MONITOR_PRIVATE_KEY=your_keypair_base58
AGENTPROOF_PROGRAM_ID=your_program_id
FREEZE_THRESHOLD=80
PORT=8000
```

### 前端（app/.env.local）
```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID=your_program_id
NEXT_PUBLIC_WITNESS_NODE_URL=http://localhost:3001
NEXT_PUBLIC_RISK_MONITOR_URL=http://localhost:8000
```
