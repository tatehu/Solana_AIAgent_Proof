# 06 — Next.js 前端

## 初始化项目

```bash
npx create-next-app@14 app --typescript --tailwind --app --src-dir --import-alias "@/*"
cd app

npm install @solana/web3.js @solana/wallet-adapter-react @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-phantom @coral-xyz/anchor \
  recharts axios lucide-react @radix-ui/react-dialog \
  @radix-ui/react-tabs clsx
```

---

## src/lib/solana.ts（Solana 工具函数）

```typescript
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? clusterApiUrl("devnet");

export const connection = new Connection(RPC_URL, "confirmed");

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID ??
    "AgPr111111111111111111111111111111111111111"
);

export const WITNESS_NODE_URL =
  process.env.NEXT_PUBLIC_WITNESS_NODE_URL ?? "http://localhost:3001";
export const RISK_MONITOR_URL =
  process.env.NEXT_PUBLIC_RISK_MONITOR_URL ?? "http://localhost:8000";

export function getAgentRecordPDA(agentPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentPubkey.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getTaskProofPDA(taskId: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proof"), taskId],
    PROGRAM_ID
  );
  return pda;
}
```

---

## src/lib/agentproof-sdk.ts（前端 SDK）

```typescript
import axios from "axios";
import { WITNESS_NODE_URL, RISK_MONITOR_URL } from "./solana";

export interface AgentInfo {
  agent_pubkey: string;
  reputation_score: number;
  tasks_completed: number;
  success_rate: number;
  is_frozen: boolean;
}

export interface ProofVerifyRequest {
  task_id: string;
  agent_pubkey: string;
  task_type: string;
  tx_signature: string;
  input_hash: string;
  output_hash: string;
  instruction_hash: string;
  slot: number;
  expected_output?: Record<string, unknown>;
}

export interface ProofResult {
  task_id: string;
  status: "pending" | "verified" | "rejected";
  signatures: Array<{
    witness_pubkey: string;
    approved: boolean;
    reason?: string;
  }>;
}

export interface RiskScore {
  agent_id: string;
  score: number;
  level: "safe" | "warning" | "danger";
  reasons: string[];
  should_freeze: boolean;
  breakdown: Record<string, number>;
}

class AgentProofSDK {
  // ========================
  // Witness Node API
  // ========================

  async verifyProof(req: ProofVerifyRequest): Promise<ProofResult> {
    const response = await axios.post(`${WITNESS_NODE_URL}/api/v1/verify`, req);
    return response.data.task;
  }

  async getProof(taskId: string): Promise<ProofResult> {
    const response = await axios.get(
      `${WITNESS_NODE_URL}/api/v1/proof/${taskId}`
    );
    return response.data.task;
  }

  async getAgent(agentPubkey: string): Promise<AgentInfo> {
    const response = await axios.get(
      `${WITNESS_NODE_URL}/api/v1/agent/${agentPubkey}`
    );
    return response.data;
  }

  // ========================
  // Risk Monitor API
  // ========================

  async getRiskScore(agentId: string): Promise<RiskScore> {
    const response = await axios.get(
      `${RISK_MONITOR_URL}/api/v1/risk/${agentId}`
    );
    return response.data;
  }

  async getAlerts(): Promise<RiskScore[]> {
    const response = await axios.get(`${RISK_MONITOR_URL}/api/v1/alerts`);
    return response.data.alerts;
  }

  async analyzeAgent(agentId: string): Promise<RiskScore> {
    const response = await axios.post(`${RISK_MONITOR_URL}/api/v1/analyze`, {
      agent_id: agentId,
    });
    return response.data;
  }

  async listAgents(): Promise<AgentInfo[]> {
    const response = await axios.get(`${RISK_MONITOR_URL}/api/v1/agents`);
    return response.data.agents;
  }
}

export const agentProof = new AgentProofSDK();
```

---

## src/app/layout.tsx

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { Navigation } from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgentProof — Verifiable AI Agent Behavior Oracle",
  description:
    "The first verifiable AI Agent behavior protocol on Solana. Every Agent action, proven on-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <WalletProvider>
          <Navigation />
          <main className="container mx-auto px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
```

---

## src/components/WalletProvider.tsx

```tsx
"use client";
import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { RPC_URL } from "@/lib/solana";
import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
```

---

## src/components/Navigation.tsx

```tsx
"use client";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Shield } from "lucide-react";

export function Navigation() {
  return (
    <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-purple-400" />
          <span className="font-bold text-xl">AgentProof</span>
          <span className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full ml-2">
            Devnet
          </span>
        </div>

        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/register"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Register Agent
          </Link>
          <Link
            href="/verify"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Verify Task
          </Link>
          <Link
            href="/monitor"
            className="text-gray-400 hover:text-white transition-colors"
          >
            Risk Monitor
          </Link>
          <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
        </div>
      </div>
    </nav>
  );
}
```

---

## src/app/page.tsx（主 Dashboard）

```tsx
"use client";
import { useEffect, useState } from "react";
import { Shield, Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { agentProof, type AgentInfo, type RiskScore } from "@/lib/agentproof-sdk";
import Link from "next/link";

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [alerts, setAlerts] = useState<RiskScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [agentList, alertList] = await Promise.all([
          agentProof.listAgents(),
          agentProof.getAlerts(),
        ]);
        setAgents(agentList);
        setAlerts(alertList);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000); // 每10秒刷新
    return () => clearInterval(interval);
  }, []);

  const stats = {
    total: agents.length,
    frozen: agents.filter((a) => a.is_frozen).length,
    warnings: alerts.filter((a) => a.level === "warning").length,
    dangers: alerts.filter((a) => a.level === "danger").length,
  };

  return (
    <div className="space-y-8">
      {/* 标题 */}
      <div className="text-center space-y-2 py-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          AgentProof
        </h1>
        <p className="text-gray-400 text-lg">
          Verifiable AI Agent Behavior Oracle on Solana
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Shield className="h-5 w-5 text-purple-400" />}
          label="Registered Agents"
          value={stats.total}
          color="purple"
        />
        <StatCard
          icon={<CheckCircle className="h-5 w-5 text-green-400" />}
          label="Active Agents"
          value={stats.total - stats.frozen}
          color="green"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-yellow-400" />}
          label="Warnings"
          value={stats.warnings}
          color="yellow"
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-red-400" />}
          label="Frozen"
          value={stats.frozen + stats.dangers}
          color="red"
        />
      </div>

      {/* 快捷操作 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ActionCard
          href="/register"
          title="Register Agent"
          description="Stake SOL and declare your Agent's capabilities"
          icon="🤖"
        />
        <ActionCard
          href="/verify"
          title="Verify Task"
          description="Submit task proof for witness node verification"
          icon="✅"
        />
        <ActionCard
          href="/monitor"
          title="Risk Monitor"
          description="Real-time AI risk scoring and threat detection"
          icon="🛡️"
        />
      </div>

      {/* 告警列表 */}
      {alerts.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-red-900/50 p-6">
          <h2 className="text-lg font-semibold text-red-400 mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Active Alerts ({alerts.length})
          </h2>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <AlertRow key={alert.agent_id} alert={alert} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  const bgMap: Record<string, string> = {
    purple: "border-purple-800/50",
    green: "border-green-800/50",
    yellow: "border-yellow-800/50",
    red: "border-red-800/50",
  };
  return (
    <div
      className={`bg-gray-900 rounded-xl border ${bgMap[color] ?? "border-gray-800"} p-4`}
    >
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-sm text-gray-400">{label}</span></div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function ActionCard({
  href, title, description, icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="bg-gray-900 rounded-xl border border-gray-800 p-6 hover:border-purple-600 transition-colors group"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold text-lg group-hover:text-purple-400 transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-400 mt-1">{description}</p>
    </Link>
  );
}

function AlertRow({ alert }: { alert: RiskScore }) {
  const levelColor = alert.level === "danger" ? "text-red-400" : "text-yellow-400";
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div>
        <span className="font-mono text-sm text-gray-300">
          {alert.agent_id.substring(0, 20)}...
        </span>
        <div className="text-xs text-gray-500 mt-0.5">
          {alert.reasons.join(" · ")}
        </div>
      </div>
      <div className={`font-bold ${levelColor}`}>
        {alert.score.toFixed(0)} / 100
      </div>
    </div>
  );
}
```

---

## src/app/monitor/page.tsx（风控仪表盘）

```tsx
"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { agentProof, type RiskScore } from "@/lib/agentproof-sdk";

// Demo 用：模拟恶意 Agent ID
const DEMO_AGENT = "MaliciousAgent111111111111111111111111111";

export default function MonitorPage() {
  const [riskHistory, setRiskHistory] = useState<Array<{ time: string; score: number }>>([]);
  const [currentRisk, setCurrentRisk] = useState<RiskScore | null>(null);
  const [alerts, setAlerts] = useState<RiskScore[]>([]);

  useEffect(() => {
    async function fetchRisk() {
      try {
        const [risk, alertList] = await Promise.all([
          agentProof.analyzeAgent(DEMO_AGENT),
          agentProof.getAlerts(),
        ]);
        setCurrentRisk(risk);
        setAlerts(alertList);
        setRiskHistory((prev) => [
          ...prev.slice(-19),
          {
            time: new Date().toLocaleTimeString(),
            score: risk.score,
          },
        ]);
      } catch (e) {
        console.error(e);
      }
    }

    fetchRisk();
    const interval = setInterval(fetchRisk, 3000); // 每3秒刷新
    return () => clearInterval(interval);
  }, []);

  const levelColor = currentRisk?.level === "danger"
    ? "text-red-400 border-red-600"
    : currentRisk?.level === "warning"
    ? "text-yellow-400 border-yellow-600"
    : "text-green-400 border-green-600";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI Risk Monitor</h1>

      {/* 实时风险评分 */}
      {currentRisk && (
        <div className={`bg-gray-900 rounded-xl border p-6 ${levelColor}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400">Current Risk Score</div>
              <div className={`text-6xl font-bold mt-1 ${levelColor.split(" ")[0]}`}>
                {currentRisk.score.toFixed(0)}
              </div>
              <div className={`text-lg uppercase font-semibold mt-1 ${levelColor.split(" ")[0]}`}>
                {currentRisk.level}
              </div>
            </div>
            <div className="space-y-2">
              {Object.entries(currentRisk.breakdown).map(([key, val]) => (
                <div key={key} className="text-sm">
                  <span className="text-gray-400 capitalize">{key.replace("_", " ")}: </span>
                  <span className={val > 20 ? "text-red-400" : "text-gray-300"}>
                    {val.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {currentRisk.reasons.length > 0 && (
            <div className="mt-4 space-y-1">
              {currentRisk.reasons.map((r, i) => (
                <div key={i} className="text-sm flex items-center gap-2">
                  <span className="text-red-400">⚠️</span>
                  <span className="text-gray-300">{r}</span>
                </div>
              ))}
            </div>
          )}

          {currentRisk.should_freeze && (
            <div className="mt-4 bg-red-900/30 border border-red-600 rounded-lg p-3 text-red-300 text-sm">
              🚨 <strong>FREEZE TRIGGERED</strong> — Submitting freeze transaction to Solana...
            </div>
          )}
        </div>
      )}

      {/* 实时折线图 */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Risk Score Timeline</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={riskHistory}>
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#6b7280" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#6b7280" }} />
            <Tooltip
              contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
            />
            {/* 阈值线 */}
            <Line
              type="monotone"
              dataKey={() => 80}
              stroke="#ef4444"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 告警列表 */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Alert History ({alerts.length})</h2>
        {alerts.length === 0 ? (
          <div className="text-gray-500 text-center py-8">No active alerts</div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.agent_id}
                className={`rounded-lg p-3 border ${
                  alert.level === "danger"
                    ? "bg-red-900/20 border-red-800"
                    : "bg-yellow-900/20 border-yellow-800"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-sm">{alert.agent_id}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {alert.reasons.join(" · ")}
                    </div>
                  </div>
                  <div
                    className={`font-bold text-lg ${
                      alert.level === "danger" ? "text-red-400" : "text-yellow-400"
                    }`}
                  >
                    {alert.score.toFixed(0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 启动命令

```bash
cd app
cp .env.local.example .env.local
# 填写环境变量

npm run dev
# 访问 http://localhost:3000
```
