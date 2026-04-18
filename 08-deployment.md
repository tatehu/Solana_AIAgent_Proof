# 08 — 部署与测试

## 开发环境要求

```bash
# 版本要求
node --version   # >= 20.0.0
python3 --version # >= 3.11.0
rustc --version   # >= 1.75.0
solana --version  # >= 1.18.0
anchor --version  # >= 0.30.0

# 安装 Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"

# 安装 Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.0
avm use 0.30.0

# 配置 Devnet
solana config set --url https://api.devnet.solana.com
solana-keygen new -o ~/.config/solana/id.json
solana airdrop 5  # 获取测试 SOL
```

---

## 完整启动流程（按顺序执行）

### Step 1：克隆并初始化

```bash
git clone https://github.com/your-org/agentproof.git
cd agentproof

# 安装依赖（monorepo 根目录）
npm install

# 或者逐个安装
cd programs/agentproof && cargo build
cd witness-node && npm install
cd risk-monitor && pip install -r requirements.txt
cd app && npm install
```

### Step 2：构建和部署 Anchor 程序

```bash
# 在项目根目录
anchor build

# 获取 Program ID（重要！）
PROGRAM_ID=$(solana address -k target/deploy/agentproof-keypair.json)
echo "Program ID: $PROGRAM_ID"

# 更新代码中的 Program ID
# 1. programs/agentproof/src/lib.rs 中的 declare_id!()
# 2. Anchor.toml 中的 [programs.devnet] agentproof = "..."
# 3. app/.env.local 中的 NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID

# 重新构建（更新 Program ID 后）
anchor build

# 部署到 Devnet
anchor deploy --provider.cluster devnet

echo "✓ Program deployed: $PROGRAM_ID"
```

### Step 3：生成见证节点密钥

```bash
mkdir -p keys

# 生成 3 个见证节点密钥
for i in 1 2 3; do
  solana-keygen new --no-bip39-passphrase -o keys/witness-$i.json
  echo "Witness $i: $(solana address -k keys/witness-$i.json)"
  # 给见证节点充值测试 SOL
  solana airdrop 2 $(solana address -k keys/witness-$i.json)
done

# 生成风控权限密钥
solana-keygen new --no-bip39-passphrase -o keys/risk-monitor.json
echo "Risk Monitor: $(solana address -k keys/risk-monitor.json)"
solana airdrop 2 $(solana address -k keys/risk-monitor.json)
```

### Step 4：配置环境变量

```bash
# 获取 Helius API Key（免费注册 https://helius.dev）
HELIUS_API_KEY="your_api_key_here"

# witness-node/.env
cat > witness-node/.env << EOF
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY
WITNESS_PRIVATE_KEY=$(cat keys/witness-1.json | python3 -c "import sys,json,base58; d=json.load(sys.stdin); print(base58.b58encode(bytes(d)).decode())")
AGENTPROOF_PROGRAM_ID=$PROGRAM_ID
PORT=3001
EOF

# risk-monitor/.env
cat > risk-monitor/.env << EOF
HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY
RISK_MONITOR_PRIVATE_KEY=$(cat keys/risk-monitor.json | python3 -c "import sys,json,base58; d=json.load(sys.stdin); print(base58.b58encode(bytes(d)).decode())")
AGENTPROOF_PROGRAM_ID=$PROGRAM_ID
PROOF_ENGINE_URL=http://localhost:3001
FREEZE_THRESHOLD=80
PORT=8000
EOF

# app/.env.local
cat > app/.env.local << EOF
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY
NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID=$PROGRAM_ID
NEXT_PUBLIC_WITNESS_NODE_URL=http://localhost:3001
NEXT_PUBLIC_RISK_MONITOR_URL=http://localhost:8000
EOF
```

### Step 5：启动所有服务

```bash
# 终端1：见证节点
cd witness-node && npm run dev
# 输出：🔍 AgentProof Witness Node running on port 3001

# 终端2：AI 风控服务
cd risk-monitor && python main.py
# 输出：INFO: Uvicorn running on http://0.0.0.0:8000

# 终端3：前端
cd app && npm run dev
# 输出：ready - http://localhost:3000
```

### Step 6：运行 Anchor 测试

```bash
# 在项目根目录
anchor test

# 期望输出：
# agentproof
#   ✓ registers an agent
#   ✓ submits a task proof
#   ✓ witnesses sign and proof reaches threshold
#
# 3 passing (5s)
```

---

## 健康检查

```bash
# 检查见证节点
curl http://localhost:3001/health
# 期望：{"status":"ok","witness_pubkey":"...","timestamp":...}

# 检查 AI 风控
curl http://localhost:8000/health
# 期望：{"status":"ok","service":"AgentProof Risk Monitor","version":"0.1.0"}

# 检查前端
curl http://localhost:3000
# 期望：返回 HTML

# 检查链上程序
solana account $PROGRAM_ID --url devnet
# 期望：显示账户信息（executable: true）
```

---

## Demo 数据初始化脚本

```typescript
// scripts/seed-demo.ts
// 用于 Demo 前快速初始化链上数据
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import * as fs from "fs";

const HELIUS_RPC = process.env.HELIUS_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.AGENTPROOF_PROGRAM_ID ?? "";

async function main() {
  const connection = new Connection(HELIUS_RPC, "confirmed");
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync("keys/demo-agent.json", "utf-8")))
  );

  console.log("🌱 Seeding Demo Data...");
  console.log("   Payer:", payer.publicKey.toBase58());

  // 1. 注册 Demo Agent A（委托方）
  console.log("\n1️⃣  Registering Agent A (Delegator)...");
  // TODO: 调用 registerAgent 指令

  // 2. 注册 Demo Agent B（执行方）
  console.log("2️⃣  Registering Agent B (Executor)...");
  // TODO: 调用 registerAgent 指令

  // 3. 提交 Demo 任务证明
  console.log("3️⃣  Submitting demo task proof...");
  // TODO: 调用 submitProof 指令

  // 4. 模拟风控场景
  console.log("4️⃣  Simulating malicious agent for risk demo...");
  // TODO: 调用风控 API

  console.log("\n✅ Demo data seeded successfully!");
}

main().catch(console.error);
```

运行：
```bash
tsx scripts/seed-demo.ts
```

---

## 快速验证清单（提交前）

```
链上程序
[ ] anchor build 成功，无警告
[ ] anchor deploy --provider.cluster devnet 成功
[ ] anchor test 全部通过
[ ] Program ID 在所有配置文件中一致

见证节点
[ ] /health 端点返回 200
[ ] POST /api/v1/verify 能正确处理请求
[ ] 见证节点能正确解析链上 TxSig

AI 风控
[ ] /health 端点返回 200
[ ] POST /api/v1/analyze 返回风险评分
[ ] 模拟恶意行为时评分能超过 80
[ ] 超过阈值时能触发冻结（调用链上或 freeze API）

前端
[ ] 首页 Dashboard 正常加载
[ ] Phantom 钱包可以连接（Devnet）
[ ] 风控仪表盘实时更新折线图
[ ] 告警列表正常显示

端到端 Demo 流程
[ ] Demo 场景1：Agent 注册 → 任务提交 → 见证验证 → ProofNFT 铸造
[ ] Demo 场景2：模拟恶意行为 → 风险分上升 → 触发冻结 → 链上 Tx 确认
[ ] Demo 场景3：SDK 查询 Agent 声誉分 → 计算借款上限
```

---

## 常见问题排查

### anchor build 失败
```bash
# 确认 Rust 版本
rustup update stable

# 清理缓存
cargo clean
anchor build
```

### Devnet RPC 限流
```bash
# 使用 Helius 代替公共 RPC
# 注册免费 Key: https://dev.helius.xyz/dashboard/app
```

### 见证节点无法连接 Solana
```bash
# 检查 HELIUS_RPC_URL 格式
# 正确：https://devnet.helius-rpc.com/?api-key=YOUR_KEY
# 错误：https://devnet.helius-rpc.com/ （无 API Key）
```

### 前端钱包不显示 Devnet 余额
```bash
# 在 Phantom 中切换网络到 Devnet
# Settings → Developer Settings → Change Network → Devnet
solana airdrop 2 YOUR_WALLET_ADDRESS
```
