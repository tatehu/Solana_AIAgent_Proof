"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { agentProof, type RiskScore, type AgentInfo } from "@/lib/agentproof-sdk";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import {
  TrendingUp, Users, CheckCircle, Clock, Activity,
  AlertTriangle, Shield, Search, SlidersHorizontal,
} from "lucide-react";

// ── Institution demo banner ────────────────────────────────────────────────
function InstitutionAgentBanner() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const recentTasks = [
    { label: "SOL/USDC swap · 14.2 SOL",    status: "verified", ago: "8s ago" },
    { label: "JUP limit order · 500 USDC",   status: "verified", ago: "41s ago" },
    { label: "Rebalance DeFi portfolio",      status: "verified", ago: "2m ago" },
    { label: "SOL/BONK swap · 3.1 SOL",      status: "verified", ago: "5m ago" },
  ];

  return (
    <div className="glass-card rounded-2xl p-5 border border-violet-500/20 bg-gradient-to-r from-violet-500/5 to-blue-500/5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center text-sm">🏦</div>
            <span className="font-bold text-white text-base">Binance Trading Agent</span>
            <span className="text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              ● Live
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Example: what it looks like when an institution&apos;s AI agent is monitored by AgentProof
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-emerald-400">12</div>
          <div className="text-xs text-slate-500">Risk Score</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat icon={<Users className="h-3.5 w-3.5" />}      label="Users trusting"    value="847" />
        <MiniStat icon={<TrendingUp className="h-3.5 w-3.5" />} label="AUM managed"       value="$2.3M" />
        <MiniStat icon={<CheckCircle className="h-3.5 w-3.5" />} label="Tasks verified"   value="15,623" />
        <MiniStat icon={<Clock className="h-3.5 w-3.5" />}      label="Stake (collateral)" value="50 SOL" />
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-slate-500 mb-2">Recent on-chain actions (all independently verified)</div>
        {recentTasks.map((task, i) => (
          <div
            key={i}
            className={`flex items-center justify-between text-xs py-1.5 px-2.5 rounded-lg transition-all ${
              i === tick % 4
                ? "bg-violet-500/10 border border-violet-500/30"
                : "bg-white/[0.02] border border-white/5"
            }`}
          >
            <span className="text-slate-300">{task.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-semibold">✓ {task.status}</span>
              <span className="text-slate-600">{task.ago}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] rounded-xl p-2.5 text-center border border-white/5">
      <div className="flex items-center justify-center gap-1 text-slate-500 mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="font-bold text-white text-sm">{value}</div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
const SIDEBAR_PAGE_SIZE = 10;

export default function MonitorPage() {
  const { publicKey } = useWallet();
  const [allAgents, setAllAgents] = useState<AgentInfo[]>([]);
  const [visibleCount, setVisibleCount] = useState(SIDEBAR_PAGE_SIZE);
  const [riskScores, setRiskScores] = useState<Record<string, RiskScore>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [riskHistory, setRiskHistory] = useState<Array<{ time: string; score: number }>>([]);
  const [alerts, setAlerts] = useState<RiskScore[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarRiskFilter, setSidebarRiskFilter] = useState<"" | "safe" | "warning" | "danger">("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Load all agents
  useEffect(() => {
    async function loadAgents() {
      try {
        const list = await agentProof.listAgents();
        const myPub = publicKey?.toBase58();
        const sorted = [...list].sort((a, b) => {
          const aOwn = myPub && (a.owner_wallet === myPub || a.agent_pubkey === myPub);
          const bOwn = myPub && (b.owner_wallet === myPub || b.agent_pubkey === myPub);
          if (aOwn && !bOwn) return -1;
          if (!aOwn && bOwn) return 1;
          return (b.created_at ?? b.registered_at ?? 0) - (a.created_at ?? a.registered_at ?? 0);
        });
        setAllAgents(sorted);
        const defaultAgent = sorted.find((a) => myPub && (a.owner_wallet === myPub || a.agent_pubkey === myPub)) ?? sorted[0];
        if (defaultAgent) setSelectedAgentId(defaultAgent.agent_pubkey);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingAgents(false);
      }
    }
    loadAgents();
  }, [publicKey]);

  // Filter agents for sidebar
  const filteredAgents = allAgents.filter((agent) => {
    const matchSearch = !sidebarSearch ||
      agent.agent_pubkey.toLowerCase().includes(sidebarSearch.toLowerCase());
    const risk = riskScores[agent.agent_pubkey];
    const level = risk?.level ?? "safe";
    const matchRisk = !sidebarRiskFilter || level === sidebarRiskFilter;
    return matchSearch && matchRisk;
  });

  const visibleAgents = filteredAgents.slice(0, visibleCount);
  const hasMoreAgents = visibleCount < filteredAgents.length;

  // Reset visible count on filter change
  useEffect(() => { setVisibleCount(SIDEBAR_PAGE_SIZE); }, [sidebarSearch, sidebarRiskFilter]);

  // Infinite scroll inside sidebar
  const handleSentinel = useCallback(() => {
    if (hasMoreAgents) setVisibleCount((n) => n + SIDEBAR_PAGE_SIZE);
  }, [hasMoreAgents]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) handleSentinel(); },
      { rootMargin: "80px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [handleSentinel]);

  // Poll risk for selected agent
  useEffect(() => {
    if (!selectedAgentId) return;

    async function fetchRisk() {
      if (!selectedAgentId) return;
      try {
        const [risk, alertList] = await Promise.all([
          agentProof.analyzeAgent(selectedAgentId),
          agentProof.getAlerts(),
        ]);
        setRiskScores((prev) => ({ ...prev, [selectedAgentId]: risk }));
        setAlerts(alertList);
        setRiskHistory((prev) => [
          ...prev.slice(-19),
          { time: new Date().toLocaleTimeString(), score: risk.score },
        ]);
      } catch (e) {
        console.error(e);
      }
    }

    setRiskHistory([]);
    fetchRisk();
    const interval = setInterval(fetchRisk, 15000);
    return () => clearInterval(interval);
  }, [selectedAgentId]);

  const currentRisk = selectedAgentId ? riskScores[selectedAgentId] : null;

  const levelConfig = {
    danger: {
      border: "border-rose-500/40",
      scoreColor: "text-rose-400",
      badge: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    },
    warning: {
      border: "border-amber-500/40",
      scoreColor: "text-amber-400",
      badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    safe: {
      border: "border-emerald-500/30",
      scoreColor: "text-emerald-400",
      badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
  };

  const currentLevel = (currentRisk?.level ?? "safe") as keyof typeof levelConfig;
  const lvl = levelConfig[currentLevel];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Security Monitor</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time risk scoring · Tamper-proof on-chain proofs · Open to anyone
          </p>
        </div>
        <div className="flex items-center gap-2 glass-card rounded-xl px-4 py-2">
          <Activity className="h-4 w-4 text-violet-400" />
          <span className="text-sm text-slate-400">
            <span className="text-white font-semibold">{allAgents.length}</span> agents monitored
          </span>
        </div>
      </div>

      {/* Institution demo banner */}
      <InstitutionAgentBanner />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 glass-card rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monitored Agents</h2>

          {/* Sidebar filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search wallet..."
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <select
                value={sidebarRiskFilter}
                onChange={(e) => setSidebarRiskFilter(e.target.value as "" | "safe" | "warning" | "danger")}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500/50"
              >
                <option value="">All risk levels</option>
                <option value="safe">Safe</option>
                <option value="warning">Warning</option>
                <option value="danger">Danger</option>
              </select>
            </div>
            <div className="text-xs text-slate-600">{filteredAgents.length} agents</div>
          </div>

          {/* Agent list */}
          {loadingAgents ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.03] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-8">No agents found</div>
          ) : (
            <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
              {visibleAgents.map((agent) => {
                const isSelected = agent.agent_pubkey === selectedAgentId;
                const myPub = publicKey?.toBase58();
                const isMyAgent = myPub && (agent.owner_wallet === myPub || agent.agent_pubkey === myPub);
                const risk = riskScores[agent.agent_pubkey];
                const dotColor =
                  risk?.level === "danger" ? "bg-rose-400" :
                  risk?.level === "warning" ? "bg-amber-400" :
                  risk ? "bg-emerald-400" : "bg-slate-600";

                return (
                  <button
                    key={agent.agent_pubkey}
                    onClick={() => setSelectedAgentId(agent.agent_pubkey)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                      isSelected
                        ? "bg-violet-500/15 border border-violet-500/40"
                        : "hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                      <span className="font-mono text-xs text-slate-300 truncate">
                        {agent.agent_pubkey.slice(0, 12)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 ml-4">
                      {isMyAgent && <span className="text-xs text-violet-400">My Agent</span>}
                      {agent.is_frozen && <span className="text-xs text-rose-400">FROZEN</span>}
                      {risk && (
                        <span className={`text-xs ml-auto font-bold ${
                          risk.level === "danger" ? "text-rose-400" :
                          risk.level === "warning" ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {risk.score.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Sentinel for sidebar infinite scroll */}
              <div ref={sentinelRef} className="h-1" />
              {hasMoreAgents && (
                <div className="text-center text-xs text-slate-600 py-2">Scroll to load more...</div>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="lg:col-span-3 space-y-5">
          {/* Current risk score */}
          {selectedAgentId && (
            <div className={`glass-card rounded-2xl p-5 border ${currentRisk ? lvl.border : "border-white/7"}`}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-slate-500 font-mono">
                  {selectedAgentId.slice(0, 20)}...{selectedAgentId.slice(-6)}
                </span>
                <Link
                  href={`/agent/${selectedAgentId}`}
                  className="text-xs text-violet-400 hover:text-violet-300 ml-auto transition-colors"
                >
                  View Full Profile →
                </Link>
              </div>

              {currentRisk ? (
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Risk Score</div>
                      <div className={`text-6xl font-bold ${lvl.scoreColor}`}>
                        {currentRisk.score.toFixed(0)}
                      </div>
                      <span className={`inline-flex items-center mt-2 px-3 py-1 rounded-lg text-xs font-semibold border ${lvl.badge}`}>
                        {currentRisk.level.toUpperCase()}
                      </span>
                    </div>
                    <div className="space-y-2 text-right">
                      {Object.entries(currentRisk.breakdown).map(([key, val]) => (
                        <div key={key} className="text-sm">
                          <span className="text-slate-500 capitalize">{key.replace(/_/g, " ")}: </span>
                          <span className={(val as number) > 20 ? "text-rose-400 font-bold" : "text-slate-300"}>
                            {(val as number).toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {currentRisk.reasons.length > 0 && (
                    <div className="mt-4 space-y-2 pt-4 border-t border-white/5">
                      {currentRisk.reasons.map((r, i) => (
                        <div key={i} className="text-sm flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <span className="text-slate-300">{r}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {currentRisk.should_freeze && (
                    <div className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4 shrink-0" />
                      <span><strong>FREEZE TRIGGERED</strong> — Submitting freeze transaction to Solana...</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-500 text-sm text-center py-8">Analyzing agent behavior...</div>
              )}
            </div>
          )}

          {/* Risk score timeline */}
          <div className="glass-card rounded-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">Risk Score Timeline</h2>
            {riskHistory.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8">Collecting data...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={riskHistory}>
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15,15,35,0.95)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "12px",
                      color: "#e2e8f0",
                    }}
                  />
                  <Line type="monotone" dataKey="score" stroke="#a855f7" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey={() => 80} stroke="#f43f5e" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Global alerts */}
          <div className="glass-card rounded-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Global Alerts
              {alerts.length > 0 && (
                <span className="text-xs bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded-full ml-1">
                  {alerts.length}
                </span>
              )}
            </h2>
            {alerts.length === 0 ? (
              <div className="text-slate-500 text-center py-8 flex flex-col items-center gap-2">
                <Shield className="h-8 w-8 text-emerald-500/40" />
                <span className="text-sm">No active alerts — all agents operating normally</span>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.agent_id}
                    className={`rounded-xl p-4 border ${
                      alert.level === "danger"
                        ? "bg-rose-500/5 border-rose-500/30"
                        : "bg-amber-500/5 border-amber-500/30"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <Link
                          href={`/agent/${alert.agent_id}`}
                          className="font-mono text-sm text-slate-300 hover:text-violet-400 transition-colors"
                        >
                          {alert.agent_id.slice(0, 20)}...{alert.agent_id.slice(-6)}
                        </Link>
                        <div className="text-xs text-slate-500 mt-1">{alert.reasons.join(" · ")}</div>
                      </div>
                      <div className={`font-bold text-lg ${alert.level === "danger" ? "text-rose-400" : "text-amber-400"}`}>
                        {alert.score.toFixed(0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
