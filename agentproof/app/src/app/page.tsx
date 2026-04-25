"use client";
import { useEffect, useState } from "react";
import { Shield, Activity, AlertTriangle, CheckCircle, ArrowRight, Lock, Eye, Zap } from "lucide-react";
import { agentProof, type AgentInfo, type RiskScore } from "@/lib/agentproof-sdk";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

export default function Dashboard() {
  const { publicKey } = useWallet();
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  function sortAgents(list: AgentInfo[], myPubkey?: string): AgentInfo[] {
    return [...list].sort((a, b) => {
      if (myPubkey) {
        if (a.agent_pubkey === myPubkey) return -1;
        if (b.agent_pubkey === myPubkey) return 1;
      }
      return (b.registered_at as number) - (a.registered_at as number);
    });
  }
  const [alerts, setAlerts] = useState<RiskScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [agentList, alertList] = await Promise.all([
          agentProof.listAgents(),
          agentProof.getAlerts(),
        ]);
        setAgents(sortAgents(agentList, publicKey?.toBase58()));
        setAlerts(alertList);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const stats = {
    total: agents.length,
    frozen: agents.filter((a) => a.is_frozen).length,
    warnings: alerts.filter((a) => a.level === "warning").length,
    dangers: alerts.filter((a) => a.level === "danger").length,
  };

  return (
    <div className="space-y-10">

      {/* Hero */}
      <div className="text-center space-y-4 py-10">
        <div className="inline-flex items-center gap-2 bg-purple-900/30 border border-purple-700/50 rounded-full px-4 py-1.5 text-sm text-purple-300 mb-2">
          <Zap className="h-3.5 w-3.5" />
          Built on Solana · Powered by on-chain proofs
        </div>
        <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          AgentProof
        </h1>
        <p className="text-xl text-white font-medium">
          Trust the Agent, Not Just the Claim.
        </p>
        <p className="text-gray-400 text-base max-w-xl mx-auto leading-relaxed">
          AI agents are managing real money on Solana right now.
          AgentProof puts every action on-chain — so you can verify
          what they <em>actually</em> did, not what they claim.
        </p>
        <div className="flex items-center justify-center gap-4 pt-2">
          <Link
            href="/monitor"
            className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2"
          >
            View Agent Behavior <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/register"
            className="border border-gray-600 hover:border-purple-500 text-gray-300 hover:text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            Register Your Agent
          </Link>
        </div>
      </div>

      {/* Two scenario cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ScenarioCard
          icon="🏦"
          tag="Scenario 1"
          tagColor="text-cyan-400 bg-cyan-900/20 border-cyan-800/50"
          title="Using an Institution's Agent?"
          subtitle="e.g. Binance, OKX, or any trading bot"
          description="You hand over funds to an AI trading agent — but how do you know it executed your strategy faithfully? AgentProof records every on-chain action with independent witness verification, so you can audit what the agent actually did."
          cta="Monitor Agent Behavior"
          href="/monitor"
        />
        <ScenarioCard
          icon="🤝"
          tag="Scenario 2"
          tagColor="text-purple-400 bg-purple-900/20 border-purple-800/50"
          title="Hiring Someone Else's Agent?"
          subtitle="e.g. agent marketplace, DeFi automation"
          description="Before trusting a stranger's AI agent with your funds, check their on-chain reputation score, staked collateral, and verified task history. If they underperform or act maliciously, their stake gets slashed."
          cta="Browse Verified Agents"
          href="/monitor"
        />
      </div>

      {/* Why not just a dashboard */}
      <TrustComparisonSection />

      {/* Live stats */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-4">
          Live Protocol Stats
        </h2>
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
            label="Risk Warnings"
            value={stats.warnings}
            color="yellow"
          />
          <StatCard
            icon={<Activity className="h-5 w-5 text-red-400" />}
            label="Frozen / Danger"
            value={stats.frozen + stats.dangers}
            color="red"
          />
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-4">
          Get Started
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionCard
            href="/register"
            title="List Your Agent"
            description="Stake SOL as collateral, declare capabilities, earn reputation through verified tasks"
            icon="🤖"
            badge="Agent Providers"
          />
          <ActionCard
            href="/verify"
            title="Submit Task Proof"
            description="After completing a task, submit on-chain proof — 3 witness nodes independently verify it"
            icon="✅"
            badge="After Each Task"
          />
          <ActionCard
            href="/monitor"
            title="Agent Behavior Dashboard"
            description="Real-time risk scoring, anomaly detection, and full on-chain audit trail for any agent"
            icon="🛡️"
            badge="Always On"
          />
        </div>
      </div>

      {/* Active alerts */}
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

      {loading && (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      )}

      {/* Agent list */}
      {!loading && agents.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-400" />
            Verified Agents on Solana ({agents.length})
          </h2>
          <div className="space-y-2">
            {agents.map((agent) => {
              const isMyAgent = publicKey?.toBase58() === agent.agent_pubkey;
              return (
                <Link
                  key={agent.agent_pubkey}
                  href={`/agent/${agent.agent_pubkey}`}
                  className={`flex items-center justify-between py-3 px-3 rounded-lg border transition-colors ${
                    isMyAgent
                      ? "border-purple-600 bg-purple-900/20 hover:bg-purple-900/30"
                      : "border-gray-800 hover:border-purple-600 hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Shield className={`h-4 w-4 shrink-0 ${agent.is_frozen ? "text-red-400" : "text-green-400"}`} />
                    <span className="font-mono text-sm text-gray-300">
                      {agent.agent_pubkey.slice(0, 20)}...{agent.agent_pubkey.slice(-6)}
                    </span>
                    {isMyAgent && (
                      <span className="text-xs bg-purple-900/60 text-purple-300 border border-purple-700 px-2 py-0.5 rounded-full">
                        My Agent
                      </span>
                    )}
                    {agent.is_frozen && (
                      <span className="text-xs bg-red-900/50 text-red-300 border border-red-800 px-2 py-0.5 rounded-full">
                        FROZEN
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-6 text-sm text-gray-400 shrink-0">
                    <span>Score: <span className="text-white font-medium">{agent.credit_score}</span></span>
                    <span>Stake: <span className="text-white font-medium">{(agent.staked_lamports / 1e9).toFixed(2)} SOL</span></span>
                    <span>Tasks: <span className="text-white font-medium">{agent.tasks_completed}</span></span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scenario card ──────────────────────────────────────────────
function ScenarioCard({
  icon, tag, tagColor, title, subtitle, description, cta, href,
}: {
  icon: string;
  tag: string;
  tagColor: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-3xl">{icon}</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${tagColor}`}>
          {tag}
        </span>
      </div>
      <div>
        <h3 className="font-bold text-lg text-white">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed flex-1">{description}</p>
      <Link
        href={href}
        className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
      >
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ── Trust comparison ───────────────────────────────────────────
function TrustComparisonSection() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
      <div className="flex items-center gap-2 mb-5">
        <Lock className="h-5 w-5 text-purple-400" />
        <h2 className="font-semibold text-lg">Why not just a monitoring dashboard?</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ComparisonPoint
          icon={<Eye className="h-4 w-4 text-gray-400" />}
          label="Data source"
          bad="Logs written by the agent itself — can be deleted or faked"
          good="Every action verified by 3 independent witness nodes, stored on-chain"
        />
        <ComparisonPoint
          icon={<Shield className="h-4 w-4 text-gray-400" />}
          label="Who trusts it"
          bad="Only you — no third party can independently verify"
          good="Anyone can verify: investors, users, auditors, DAOs"
        />
        <ComparisonPoint
          icon={<Activity className="h-4 w-4 text-gray-400" />}
          label="When things go wrong"
          bad="No on-chain evidence, no accountability, no recourse"
          good="Immutable proof on-chain + staked SOL can be slashed as penalty"
        />
      </div>
    </div>
  );
}

function ComparisonPoint({
  icon, label, bad, good,
}: {
  icon: React.ReactNode;
  label: string;
  bad: string;
  good: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-3 text-xs text-gray-400 leading-relaxed">
        <span className="text-red-400 font-semibold">✗ Regular dashboard: </span>{bad}
      </div>
      <div className="bg-green-900/10 border border-green-900/30 rounded-lg p-3 text-xs text-gray-400 leading-relaxed">
        <span className="text-green-400 font-semibold">✓ AgentProof: </span>{good}
      </div>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────
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
    <div className={`bg-gray-900 rounded-xl border ${bgMap[color] ?? "border-gray-800"} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

// ── Action card ────────────────────────────────────────────────
function ActionCard({
  href, title, description, icon, badge,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
  badge: string;
}) {
  return (
    <Link
      href={href}
      className="bg-gray-900 rounded-xl border border-gray-800 p-6 hover:border-purple-600 transition-colors group flex flex-col gap-3"
    >
      <div className="flex items-start justify-between">
        <div className="text-3xl">{icon}</div>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{badge}</span>
      </div>
      <h3 className="font-semibold text-lg group-hover:text-purple-400 transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </Link>
  );
}

// ── Alert row ──────────────────────────────────────────────────
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
