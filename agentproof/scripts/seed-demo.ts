import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import * as fs from "fs";

const HELIUS_RPC = process.env.HELIUS_RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.AGENTPROOF_PROGRAM_ID ?? "";

async function main() {
  if (!PROGRAM_ID) {
    throw new Error("AGENTPROOF_PROGRAM_ID environment variable not set");
  }

  const connection = new Connection(HELIUS_RPC, "confirmed");

  // 加载演示 Agent 密钥
  let payer: Keypair;
  if (fs.existsSync("keys/demo-agent.json")) {
    payer = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(fs.readFileSync("keys/demo-agent.json", "utf-8")))
    );
  } else {
    payer = Keypair.generate();
    fs.writeFileSync(
      "keys/demo-agent.json",
      JSON.stringify(Array.from(payer.secretKey))
    );
    console.log("Generated demo-agent keypair:", payer.publicKey.toBase58());
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  }

  console.log("🌱 Seeding Demo Data...");
  console.log("   Payer:", payer.publicKey.toBase58());
  console.log("   Program ID:", PROGRAM_ID);

  // 模拟风控数据（通过 HTTP API）
  const RISK_MONITOR_URL = process.env.RISK_MONITOR_URL ?? "http://localhost:8000";

  async function simulateAgent(agentId: string, label: string, malicious: boolean) {
    console.log(`\n   Simulating ${label} (${agentId.substring(0, 12)}...):`);

    const normalCount = malicious ? 5 : 10;
    const totalTasks = malicious ? 20 : 10;

    for (let i = 0; i < totalTasks; i++) {
      const success = malicious ? (Math.random() > 0.5) : true;
      const outputHash = malicious && i > 5
        ? "deadbeef".repeat(8)  // 重放攻击：相同 hash
        : crypto.randomBytes(32).toString("hex");

      await fetch(`${RISK_MONITOR_URL}/api/v1/proof_event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          task_id: crypto.randomBytes(32).toString("hex"),
          success,
          output_hash: outputHash,
          input_hash: crypto.randomBytes(32).toString("hex"),
          ata_created: malicious && i > 5 ? Math.floor(Math.random() * 8) + 3 : 1,
          sol_delta: malicious && i > 5 ? -Math.random() * 0.3 : -0.001,
          slot: 1000 + i,
        }),
      });

      process.stdout.write(success ? "." : "x");
    }
    console.log();
  }

  // 1. 正常 Agent A
  const agentA = "AgentAlpha111111111111111111111111111111111";
  await simulateAgent(agentA, "Normal Agent A", false);

  // 2. 恶意 Agent（用于 Demo 风控场景）
  const maliciousAgent = "MaliciousAgent111111111111111111111111111";
  await simulateAgent(maliciousAgent, "Malicious Agent", true);

  console.log("\n✅ Demo data seeded successfully!");
  console.log("\n📊 Check risk scores:");
  console.log(`   curl -X POST http://localhost:8000/api/v1/analyze -H 'Content-Type: application/json' -d '{"agent_id":"${maliciousAgent}"}'`);
}

main().catch(console.error);
