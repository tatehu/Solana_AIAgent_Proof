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

      {loading && (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
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
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function ActionCard({
  href,
  title,
  description,
  icon,
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
  const levelColor =
    alert.level === "danger" ? "text-red-400" : "text-yellow-400";
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
