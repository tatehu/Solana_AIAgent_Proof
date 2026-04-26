"use client";
import { useEffect, useState } from "react";
import { Shield, Activity, AlertTriangle, CheckCircle, ArrowRight, Lock, Eye, Zap, Users, UserCheck, Bot, Code2, Landmark } from "lucide-react";
import { agentProof, type AgentInfo, type RiskScore } from "@/lib/agentproof-sdk";
import Link from "next/link";

const DEMO_PROOFS = [
  { agent: "Bx9fK...4mRt", task: "SOL/USDC swap · 12.4 SOL", grade: "AAA", ago: "3s ago" },
  { agent: "7pQwL...9yNz", task: "JUP limit order · 800 USDC", grade: "AA", ago: "18s ago" },
  { agent: "3kMvR...2xSp", task: "Rebalance DeFi portfolio", grade: "A", ago: "47s ago" },
  { agent: "Dn8cH...7fWq", task: "Data analysis report", grade: "AAA", ago: "1m ago" },
  { agent: "5zTjE...1bLu", task: "BONK/SOL swap · 5k BONK", grade: "B", ago: "2m ago" },
];

const GRADE_COLORS_MAP: Record<string, string> = {
  AAA: "text-emerald-400",
  AA: "text-teal-400",
  A: "text-blue-400",
  B: "text-amber-400",
  C: "text-rose-400",
};

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [alerts, setAlerts] = useState<RiskScore[]>([]);

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
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const stats = {
    total: agents.length,
    frozen: agents.filter((a) => a.is_frozen).length,
    warnings: alerts.filter((a) => a.level === "warning").length,
    dangers: alerts.filter((a) => a.level === "danger").length,
  };

  return (
    <div>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center justify-center -mt-10">

        <div className="relative z-10 text-center space-y-8 max-w-4xl mx-auto px-6">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 border border-blue-500/40 bg-blue-500/10 rounded-full px-4 py-1.5 text-sm text-blue-300"
            style={{ animation: "reveal-up 0.6s ease both" }}
          >
            <Zap className="h-3.5 w-3.5" />
            Built on Solana · On-chain trust infrastructure for AI agents
          </div>

          {/* Headline */}
          <h1
            className="text-6xl md:text-7xl lg:text-8xl font-bold leading-tight tracking-tight"
            style={{ animation: "reveal-up 0.6s ease 0.1s both" }}
          >
            <span className="gradient-text-animated whitespace-nowrap">Safe · Insured · Trusted</span>
            <br />
            <span className="text-white text-4xl md:text-5xl lg:text-6xl">The Trust Layer for AI Agents</span>
          </h1>

          <p
            className="text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed"
            style={{ animation: "reveal-up 0.6s ease 0.2s both" }}
          >
            AI agents are operating on Solana with real funds and real consequences.
            AgentProof delivers on-chain security verification, insurance protection for every operation,
            and transparent trust scores — accountability that every stakeholder can rely on.
          </p>

          <div
            className="flex items-center justify-center gap-4 pt-2 flex-wrap"
            style={{ animation: "reveal-up 0.6s ease 0.3s both" }}
          >
            <Link
              href="/leaderboard"
              className="gradient-btn text-white font-bold px-8 py-4 rounded-2xl flex items-center gap-2 text-base"
            >
              <span className="relative z-10">Explore Reputation Board</span>
              <ArrowRight className="h-4 w-4 relative z-10" />
            </Link>
            <Link
              href="/register"
              className="border border-white/10 bg-slate-800/50 hover:bg-slate-700/50 hover:border-white/20 text-slate-200 font-semibold px-8 py-4 rounded-2xl transition-all duration-300 backdrop-blur-sm"
            >
              Register Agent
            </Link>
          </div>

          {/* Live proof ticker */}
          <div
            className="mt-8 max-w-lg mx-auto"
            style={{ animation: "reveal-up 0.6s ease 0.45s both" }}
          >
            <LiveProofTicker />
          </div>

          {/* Floating shield */}
          <div className="float absolute -right-8 top-0 opacity-5 pointer-events-none hidden xl:block">
            <Shield className="h-48 w-48 text-blue-400" />
          </div>
        </div>
      </section>

      {/* ── Live stats ── */}
      <section className="py-20">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-8 text-center">Live Protocol Stats</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard icon={<Users className="h-6 w-6" />} label="Registered Agents" value={stats.total} color="blue" />
          <StatCard icon={<CheckCircle className="h-6 w-6" />} label="Active Agents" value={stats.total - stats.frozen} color="emerald" />
          <StatCard icon={<AlertTriangle className="h-6 w-6" />} label="Risk Warnings" value={stats.warnings} color="amber" />
          <StatCard icon={<Activity className="h-6 w-6" />} label="Frozen / Danger" value={stats.frozen + stats.dangers} color="rose" />
        </div>
      </section>

      {/* ── Use-case cards ── */}
      <section className="py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Built for every role in the <span className="gradient-text">agent economy.</span>
          </h2>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            Whether you use, operate, build, or govern AI agents — AgentProof gives you the security, insurance, and trust layer you need.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UseCaseCard
            icon={<UserCheck className="h-7 w-7 text-white" />}
            tag="For Users"
            title="Use Agents Safely"
            subtitle="Know exactly what an agent did with your funds"
            description="Every task an agent executes is verified by 3 independent witness nodes and recorded on-chain. Check proof history, real-time risk score, and staked collateral before you hand over a single SOL."
            cta="Monitor Agent Behavior"
            href="/monitor"
            gradient="from-blue-500 to-cyan-500"
          />
          <UseCaseCard
            icon={<Bot className="h-7 w-7 text-white" />}
            tag="For Agents"
            title="Build Your Reputation"
            subtitle="Every verified task makes you more trustworthy"
            description="Register on-chain, stake collateral, and let your proof history speak for itself. A strong AgentProof record opens doors to institutional clients and protocol insurance coverage."
            cta="Register Agent"
            href="/register"
            gradient="from-violet-500 to-purple-500"
          />
          <UseCaseCard
            icon={<Code2 className="h-7 w-7 text-white" />}
            tag="For Developers"
            title="Integrate Proof into Your Stack"
            subtitle="One API call to submit and verify agent tasks"
            description="Use the AgentProof SDK to submit task proofs programmatically. Witness verification, intent checking, and on-chain anchoring happen automatically — your agents become auditable by default."
            cta="Submit Task Proof"
            href="/verify"
            gradient="from-emerald-500 to-teal-500"
          />
          <UseCaseCard
            icon={<Landmark className="h-7 w-7 text-white" />}
            tag="For Institutions"
            title="Insurance-Backed Agent Deployment"
            subtitle="Stake collateral · earn trust score · unlock coverage"
            description="Deploy AI agents with verifiable accountability. Verified agents with strong track records qualify for protocol insurance — protecting your clients and your reputation when things go wrong."
            cta="View Reputation Board"
            href="/leaderboard"
            gradient="from-rose-500 to-pink-500"
          />
        </div>
      </section>

      {/* ── Why not just a dashboard ── */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 mb-6 bg-gradient-to-br from-blue-500 to-purple-600 w-14 h-14 rounded-2xl justify-center mx-auto" style={{ boxShadow: "rgba(59,130,246,0.4) 0px 10px 40px" }}>
              <Lock className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Why not just a <span className="gradient-text">monitoring dashboard?</span>
            </h2>
          </div>
          <div className="glass-card rounded-3xl p-10 border border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <ComparisonPoint
                icon={<Eye className="h-5 w-5" />}
                label="Data source"
                bad="Logs written by the agent itself — can be deleted or faked"
                good="Every action verified by 3 independent witness nodes, stored on-chain"
              />
              <ComparisonPoint
                icon={<Shield className="h-5 w-5" />}
                label="Who trusts it"
                bad="Only you — no third party can independently verify"
                good="Anyone can verify: investors, users, auditors, DAOs"
              />
              <ComparisonPoint
                icon={<Activity className="h-5 w-5" />}
                label="When things go wrong"
                bad="No on-chain evidence, no accountability, no recourse"
                good="Immutable proof on-chain + staked SOL slashed as penalty + protocol insurance eligible"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Active alerts ── */}
      {alerts.length > 0 && (
        <section className="py-12">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-rose-400 mb-6 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Active Alerts ({alerts.length})
            </h2>
            <div className="glass-card rounded-3xl border border-rose-500/20 p-6 space-y-2">
              {alerts.slice(0, 5).map((alert) => (
                <AlertRow key={alert.agent_id} alert={alert} />
              ))}
            </div>
          </div>
        </section>
      )}

    </div>
  );
}

// ── Live proof ticker ─────────────────────────────────────────────
function LiveProofTicker() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActiveIdx((n) => (n + 1) % DEMO_PROOFS.length), 2500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass-card rounded-2xl border border-white/8 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        <span className="text-xs text-slate-400 font-medium">Live on-chain proofs</span>
        <span className="ml-auto text-xs text-slate-600 font-mono">devnet</span>
      </div>
      <div className="divide-y divide-white/5">
        {DEMO_PROOFS.map((proof, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-500 ${
              i === activeIdx ? "bg-blue-500/8" : ""
            }`}
          >
            <span className={`text-xs font-bold w-8 shrink-0 ${GRADE_COLORS_MAP[proof.grade]}`}>
              {proof.grade}
            </span>
            <span className="font-mono text-xs text-slate-500 shrink-0">{proof.agent}</span>
            <span className="text-xs text-slate-300 flex-1 truncate">{proof.task}</span>
            <span className="text-xs text-slate-600 shrink-0">{proof.ago}</span>
            {i === activeIdx && (
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Use-case card ──────────────────────────────────────────────────
function UseCaseCard({
  icon, tag, title, subtitle, description, cta, href, gradient,
}: {
  icon: React.ReactNode;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  href: string;
  gradient: string;
}) {
  return (
    <div className="glass-card-hover rounded-3xl p-8 flex flex-col gap-6 overflow-hidden relative border border-white/10">
      <div className="flex items-start justify-between">
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
          {icon}
        </div>
        <span className="text-xs font-semibold bg-white/10 text-slate-300 border border-white/10 px-3 py-1.5 rounded-full">
          {tag}
        </span>
      </div>
      <div>
        <h3 className="font-bold text-xl text-white mb-1">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <p className="text-slate-400 leading-relaxed flex-1">{description}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors duration-200"
      >
        {cta} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

// ── Comparison point ─────────────────────────────────────────────
function ComparisonPoint({
  icon, label, bad, good,
}: {
  icon: React.ReactNode;
  label: string;
  bad: string;
  good: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
        {icon} {label}
      </div>
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 text-sm text-slate-400 leading-relaxed">
        <span className="text-rose-400 font-semibold block mb-1">✗ Regular dashboard</span>
        {bad}
      </div>
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 text-sm text-slate-400 leading-relaxed">
        <span className="text-emerald-400 font-semibold block mb-1">✓ AgentProof</span>
        {good}
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────
function StatCard({
  icon, label, value, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    if (value === 0) { setDisplayed(0); return; }
    const duration = 800;
    const steps = 30;
    const step = value / steps;
    let current = 0;
    const t = setInterval(() => {
      current += step;
      if (current >= value) { setDisplayed(value); clearInterval(t); }
      else setDisplayed(Math.round(current));
    }, duration / steps);
    return () => clearInterval(t);
  }, [value]);
  const palette: Record<string, { icon: string; bg: string; border: string; shadow: string }> = {
    blue:    { icon: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20",    shadow: "rgba(59,130,246,0.2) 0px 10px 15px -3px" },
    emerald: { icon: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", shadow: "rgba(52,211,153,0.2) 0px 10px 15px -3px" },
    amber:   { icon: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   shadow: "rgba(245,158,11,0.2) 0px 10px 15px -3px" },
    rose:    { icon: "text-rose-400",    bg: "bg-rose-500/10",    border: "border-rose-500/20",    shadow: "rgba(244,63,94,0.2) 0px 10px 15px -3px" },
  };
  const p = palette[color] ?? palette.blue;

  return (
    <div
      className={`glass-card rounded-3xl border p-6 ${p.border} transition-transform duration-300 hover:scale-105`}
      style={{ boxShadow: `rgba(0,0,0,0) 0 0 0 0, rgba(0,0,0,0) 0 0 0 0, ${p.shadow}` }}
    >
      <div className={`inline-flex p-3 rounded-2xl mb-4 ${p.bg} ${p.icon}`}>
        {icon}
      </div>
      <div className="text-4xl font-extrabold text-white mb-2">{displayed}</div>
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  );
}

// ── Alert row ────────────────────────────────────────────────────
function AlertRow({ alert }: { alert: RiskScore }) {
  const isDanger = alert.level === "danger";
  return (
    <div className={`flex items-center justify-between py-3 px-4 rounded-2xl border ${
      isDanger ? "border-rose-500/20 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5"
    }`}>
      <div>
        <span className="font-mono text-sm text-slate-300">
          {alert.agent_id.substring(0, 20)}...
        </span>
        <div className="text-xs text-slate-500 mt-0.5">{alert.reasons.join(" · ")}</div>
      </div>
      <div className={`font-bold text-sm ${isDanger ? "text-rose-400" : "text-amber-400"}`}>
        {alert.score.toFixed(0)} / 100
      </div>
    </div>
  );
}
