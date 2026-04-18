#!/usr/bin/env bash
# scripts/deploy.sh — AgentProof 一键部署到 Devnet

set -e

echo "🚀 AgentProof Devnet Deployment"
echo "================================"

# 检查必要工具
command -v solana >/dev/null 2>&1 || { echo "❌ solana CLI not found"; exit 1; }
command -v anchor >/dev/null 2>&1 || { echo "❌ anchor CLI not found"; exit 1; }

# 配置 Devnet
echo "1️⃣  Configuring Devnet..."
solana config set --url https://api.devnet.solana.com

# 确认余额
BALANCE=$(solana balance --lamports)
echo "   Deployer balance: $(echo "$BALANCE / 1000000000" | bc -l) SOL"

if [ "$BALANCE" -lt "3000000000" ]; then
  echo "   Low balance, requesting airdrop..."
  solana airdrop 5
fi

# 构建程序
echo ""
echo "2️⃣  Building Anchor program..."
anchor build

# 获取 Program ID
PROGRAM_ID=$(solana address -k target/deploy/agentproof-keypair.json)
echo "   Program ID: $PROGRAM_ID"

# 更新所有配置文件中的 Program ID
echo ""
echo "3️⃣  Updating Program ID in config files..."

# macOS sed 兼容写法
sed -i.bak "s/AgPr111111111111111111111111111111111111111/$PROGRAM_ID/g" \
  programs/agentproof/src/lib.rs \
  Anchor.toml
rm -f programs/agentproof/src/lib.rs.bak Anchor.toml.bak

# 重新构建（使用新 Program ID）
echo ""
echo "4️⃣  Rebuilding with updated Program ID..."
anchor build

# 部署到 Devnet
echo ""
echo "5️⃣  Deploying to Devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "✅ Program deployed: $PROGRAM_ID"
echo ""

# 生成见证节点密钥
echo "6️⃣  Generating witness node keypairs..."
mkdir -p keys

for i in 1 2 3; do
  if [ ! -f "keys/witness-$i.json" ]; then
    solana-keygen new --no-bip39-passphrase -o "keys/witness-$i.json" --silent
    echo "   Witness $i: $(solana address -k keys/witness-$i.json)"
    solana airdrop 2 "$(solana address -k keys/witness-$i.json)" > /dev/null 2>&1 || true
  else
    echo "   Witness $i: $(solana address -k keys/witness-$i.json) (existing)"
  fi
done

# 生成风控权限密钥
if [ ! -f "keys/risk-monitor.json" ]; then
  solana-keygen new --no-bip39-passphrase -o keys/risk-monitor.json --silent
  echo "   Risk Monitor: $(solana address -k keys/risk-monitor.json)"
  solana airdrop 2 "$(solana address -k keys/risk-monitor.json)" > /dev/null 2>&1 || true
else
  echo "   Risk Monitor: $(solana address -k keys/risk-monitor.json) (existing)"
fi

echo ""
echo "7️⃣  Deployment summary:"
echo "   Program ID:     $PROGRAM_ID"
echo "   Network:        Devnet"
echo ""
echo "📋 Next steps:"
echo "   1. Set HELIUS_API_KEY in your shell"
echo "   2. cd witness-node && cp .env.example .env && npm run dev"
echo "   3. cd risk-monitor && cp .env.example .env && python main.py"
echo "   4. cd app && cp .env.local.example .env.local && npm run dev"
echo ""
echo "🌐 Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
