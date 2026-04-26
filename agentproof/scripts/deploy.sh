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

# 将 JSON 字节数组 keypair 转为 Base58 私钥
keypair_to_base58() {
  python3 -c "
import sys, json, base64
data = json.load(open('$1'))
# Solana keypair JSON 是 64 字节数组，直接 base58 编码
import urllib.request
# 用内置库实现 base58
ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n = int.from_bytes(bytes(data), 'big')
result = ''
while n:
    n, r = divmod(n, 58)
    result = ALPHABET[r] + result
for byte in bytes(data):
    if byte == 0:
        result = '1' + result
    else:
        break
print(result)
"
}

# 写入或更新 .env 文件中的某个 key
# 这些 key 由用户手动配置，部署脚本不覆盖
PROTECTED_KEYS="ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL HELIUS_RPC_URL NEXT_PUBLIC_HELIUS_RPC_URL"

set_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  # 跳过受保护的 key
  for protected in $PROTECTED_KEYS; do
    if [ "$key" = "$protected" ]; then
      echo "   ⚠️  Skipping protected key: $key"
      return 0
    fi
  done

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# 生成见证节点密钥
echo "6️⃣  Generating witness node keypairs..."
mkdir -p keys

HELIUS_RPC_URL="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"

# 如果环境变量或 .env 中已有配置好的 HELIUS_RPC_URL，优先使用
if [ -z "$HELIUS_RPC_URL" ] || [ -z "$HELIUS_API_KEY" ]; then
  # 尝试从根目录 .env 读取
  if [ -f ".env" ]; then
    EXISTING=$(grep "^HELIUS_RPC_URL=" .env 2>/dev/null | cut -d= -f2-)
    [ -n "$EXISTING" ] && HELIUS_RPC_URL="$EXISTING"
  fi
fi

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

# 自动写入所有 .env 文件
echo ""
echo "7️⃣  Writing keys to .env files..."

W1_KEY=$(keypair_to_base58 keys/witness-1.json)
W2_KEY=$(keypair_to_base58 keys/witness-2.json)
W3_KEY=$(keypair_to_base58 keys/witness-3.json)
RM_KEY=$(keypair_to_base58 keys/risk-monitor.json)

# 根目录 .env（docker-compose 用）
[ ! -f ".env" ] && cp .env.example .env
set_env_var ".env" "HELIUS_RPC_URL"           "$HELIUS_RPC_URL"
set_env_var ".env" "AGENTPROOF_PROGRAM_ID"    "$PROGRAM_ID"
set_env_var ".env" "WITNESS_1_PRIVATE_KEY"    "$W1_KEY"
set_env_var ".env" "WITNESS_2_PRIVATE_KEY"    "$W2_KEY"
set_env_var ".env" "WITNESS_3_PRIVATE_KEY"    "$W3_KEY"
set_env_var ".env" "RISK_MONITOR_PRIVATE_KEY" "$RM_KEY"
echo "   ✅ .env"

# witness-node/.env（单节点启动用，默认用 witness-1）
[ ! -f "witness-node/.env" ] && cp witness-node/.env.example witness-node/.env
set_env_var "witness-node/.env" "HELIUS_RPC_URL"          "$HELIUS_RPC_URL"
set_env_var "witness-node/.env" "AGENTPROOF_PROGRAM_ID"   "$PROGRAM_ID"
set_env_var "witness-node/.env" "WITNESS_PRIVATE_KEY"     "$W1_KEY"
echo "   ✅ witness-node/.env"

# risk-monitor/.env
[ ! -f "risk-monitor/.env" ] && cp risk-monitor/.env.example risk-monitor/.env
set_env_var "risk-monitor/.env" "HELIUS_RPC_URL"          "$HELIUS_RPC_URL"
set_env_var "risk-monitor/.env" "AGENTPROOF_PROGRAM_ID"   "$PROGRAM_ID"
set_env_var "risk-monitor/.env" "RISK_MONITOR_PRIVATE_KEY" "$RM_KEY"
echo "   ✅ risk-monitor/.env"

# app/.env（前端 Next.js）
[ ! -f "app/.env" ] && cp app/.env.example app/.env 2>/dev/null || touch app/.env
set_env_var "app/.env" "NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID" "$PROGRAM_ID"
set_env_var "app/.env" "NEXT_PUBLIC_HELIUS_RPC_URL"        "$HELIUS_RPC_URL"
set_env_var "app/.env" "NEXT_PUBLIC_SOLANA_NETWORK"        "devnet"
echo "   ✅ app/.env"

echo ""
echo "8️⃣  Deployment summary:"
echo "   Program ID:     $PROGRAM_ID"
echo "   Network:        Devnet"
echo "   Witness 1:      $(solana address -k keys/witness-1.json)"
echo "   Witness 2:      $(solana address -k keys/witness-2.json)"
echo "   Witness 3:      $(solana address -k keys/witness-3.json)"
echo "   Risk Monitor:   $(solana address -k keys/risk-monitor.json)"
echo ""
echo "📋 Next steps:"
echo "   1. Ensure HELIUS_API_KEY is set in your shell"
echo "   2. cd witness-node && npm run dev"
echo "   3. cd risk-monitor && python main.py"
echo "   4. cd app && npm run dev"
echo ""
echo "🌐 Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
