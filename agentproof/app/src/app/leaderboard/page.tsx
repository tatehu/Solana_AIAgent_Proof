"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Shield, Search, SlidersHorizontal, ExternalLink, TrendingUp, LayoutGrid, List, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { RISK_MONITOR_URL } from "@/lib/solana";
import { ScoreBadge } from "@/components/ScoreBadge";
import { InsuranceModal } from "@/components/InsuranceModal";
import { useWallet } from "@solana/wallet-adapter-react";

interface LeaderboardAgent {
  agent_id: string;
  total_score: number;
  grade: string;
  completion_rate: number;
  behavior_safety: number;
  fund_risk: number;
  compliance: number;
  activity_decay: number;
  premium_multiplier: number | null;
  has_manifest: boolean;
  name: string | null;
  description: string | null;
  framework: string | null;
  external_url: string | null;
  owner_wallet: string | null;
  created_at: number | null;
  tx_count: number;
  anomaly_count: number;
}

const GRADE_OPTIONS = ["AAA", "AA", "A", "B", "C"];
const FRAMEWORK_OPTIONS = ["elizaos", "agent_kit", "goat"];
const SCORE_RANGE_OPTIONS = [
  { label: "All scores", min: 0, max: 100 },
  { label: "90-100 (Elite)", min: 90, max: 100 },
  { label: "75-89 (High)", min: 75, max: 89 },
  { label: "60-74 (Good)", min: 60, max: 74 },
  { label: "45-59 (Fair)", min: 45, max: 59 },
  { label: "< 45 (Low)", min: 0, max: 44 },
];

const GRADE_COLORS: Record<string, string> = {
  AAA: "from-emerald-500/20 to-teal-500/10 border-emerald-500/30",
  AA: "from-teal-500/20 to-cyan-500/10 border-teal-500/30",
  A: "from-blue-500/20 to-blue-500/10 border-blue-500/30",
  B: "from-amber-500/20 to-orange-500/10 border-amber-500/30",
  C: "from-rose-500/20 to-red-500/10 border-rose-500/30",
};

const PAGE_SIZE = 10;

export default function LeaderboardPage() {
  const { publicKey } = useWallet();
  const myWallet = publicKey?.toBase58();

  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [frameworkFilter, setFrameworkFilter] = useState("");
  const [scoreRange, setScoreRange] = useState(0);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [insuranceAgent, setInsuranceAgent] = useState<LeaderboardAgent | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sortedAgents = [...agents].sort((a, b) =>
    sortDir === "desc" ? b.total_score - a.total_score : a.total_score - b.total_score
  );

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [gradeFilter, frameworkFilter, scoreRange, debouncedSearch]);

  const fetchPage = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      const range = SCORE_RANGE_OPTIONS[scoreRange];
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((pageNum - 1) * PAGE_SIZE),
      });
      if (gradeFilter) params.set("grade", gradeFilter);
      if (frameworkFilter) params.set("framework", frameworkFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (range.min > 0) params.set("min_score", String(range.min));
      if (range.max < 100) params.set("max_score", String(range.max));

      try {
        const [res, ownRes, searchRes] = await Promise.all([
          fetch(`${RISK_MONITOR_URL}/api/v1/leaderboard?${params}`),
          pageNum === 1 && myWallet
            ? fetch(`${RISK_MONITOR_URL}/api/v1/leaderboard?limit=50&offset=0&owner_wallet=${myWallet}`)
            : Promise.resolve(null),
          // Also search by agent_id in case the wallet itself is an agent
          pageNum === 1 && myWallet
            ? fetch(`${RISK_MONITOR_URL}/api/v1/leaderboard?limit=10&offset=0&search=${myWallet}`)
            : Promise.resolve(null),
        ]);
        const data = await res.json();
        let list: LeaderboardAgent[] = data.agents ?? [];

        if (pageNum === 1 && myWallet) {
          // Collect from owner_wallet filter
          const ownFromManifest: LeaderboardAgent[] = ownRes
            ? ((await ownRes.json()).agents ?? []).map(
                (a: LeaderboardAgent) => ({ ...a, owner_wallet: a.owner_wallet ?? myWallet })
              )
            : [];
          // Collect from agent_id search — keep only exact matches
          const ownFromSearch: LeaderboardAgent[] = searchRes
            ? ((await searchRes.json()).agents ?? [])
                .filter((a: LeaderboardAgent) => a.agent_id === myWallet)
                .map((a: LeaderboardAgent) => ({ ...a, owner_wallet: myWallet }))
            : [];

          const merged = [
            ...ownFromManifest,
            ...ownFromSearch.filter(
              (a) => !ownFromManifest.some((m) => m.agent_id === a.agent_id)
            ),
          ];

          // Only pin "my agents" to top if they actually appear in the current filtered results
          if (merged.length > 0) {
            const filteredIds = new Set(list.map((a) => a.agent_id));
            const myAgentsInResults = merged.filter((a) => filteredIds.has(a.agent_id));
            if (myAgentsInResults.length > 0) {
              const ownIds = new Set(myAgentsInResults.map((a) => a.agent_id));
              list = [...myAgentsInResults, ...list.filter((a) => !ownIds.has(a.agent_id))];
            }
          }
        }

        setAgents(list);
        setTotal(data.total ?? 0);
      } catch {
        setAgents([]);
      } finally {
        setLoading(false);
      }
    },
    [gradeFilter, frameworkFilter, scoreRange, debouncedSearch, myWallet]
  );

  useEffect(() => {
    fetchPage(page);
  }, [page, fetchPage]);

  return (
    <div className="space-y-8">
      <div className="relative py-12">
        <div className="relative z-10 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center"
                style={{ boxShadow: "rgba(59,130,246,0.4) 0px 10px 40px" }}
              >
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-4xl font-bold text-white">Agent Reputation Board</h1>
            </div>
            <p className="text-slate-400">
              {total} agents ranked by on-chain reputation - Updated on every proof submission
            </p>
          </div>
          <Link href="/register" className="gradient-btn text-white font-bold px-6 py-3 rounded-2xl">
            + Register Agent
          </Link>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-6 border border-white/10">
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-3">Score Legend</p>
        <div className="flex flex-wrap gap-2">
          {[
            { grade: "AAA", range: "90-100", fee: "x0.5", desc: "Lowest premium" },
            { grade: "AA", range: "75-89", fee: "x0.8", desc: "Discounted" },
            { grade: "A", range: "60-74", fee: "x1.0", desc: "Standard" },
            { grade: "B", range: "45-59", fee: "x1.5", desc: "Higher premium" },
            { grade: "C", range: "< 45", fee: "-", desc: "Not insurable" },
          ].map(({ grade, range, fee, desc }) => (
            <div
              key={grade}
              className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-xs"
            >
              <ScoreBadge grade={grade} score={0} />
              <span className="text-slate-400">{range}</span>
              <span className="text-blue-400 font-mono font-semibold">{fee}</span>
              <span className="text-slate-600 hidden sm:inline">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            className="w-full bg-slate-800/50 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            placeholder="Search wallet or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="h-4 w-4 text-slate-500 shrink-0" />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="bg-slate-800/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">All grades</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={frameworkFilter}
            onChange={(e) => setFrameworkFilter(e.target.value)}
            className="bg-slate-800/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">All frameworks</option>
            {FRAMEWORK_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            value={scoreRange}
            onChange={(e) => setScoreRange(Number(e.target.value))}
            className="bg-slate-800/50 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          >
            {SCORE_RANGE_OPTIONS.map((opt, i) => (
              <option key={i} value={i}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center bg-slate-800/50 border border-white/10 rounded-xl p-1 gap-1 shrink-0">
          <button
            onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            title={sortDir === "desc" ? "Score: High → Low" : "Score: Low → High"}
          >
            {sortDir === "desc" ? <ArrowDown className="h-3.5 w-3.5 text-blue-400" /> : <ArrowUp className="h-3.5 w-3.5 text-blue-400" />}
            Score
          </button>
        </div>
        <div className="flex items-center bg-slate-800/50 border border-white/10 rounded-xl p-1 gap-1 shrink-0">
          <button
            onClick={() => setViewMode("card")}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === "card" ? "bg-blue-500/20 text-blue-400" : "text-slate-500 hover:text-slate-300"
            }`}
            title="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-lg transition-colors ${
              viewMode === "list" ? "bg-blue-500/20 text-blue-400" : "text-slate-500 hover:text-slate-300"
            }`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        viewMode === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-5 h-44 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="glass-card rounded-2xl divide-y divide-white/5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse bg-white/[0.02] m-1 rounded-xl" />
            ))}
          </div>
        )
      ) : agents.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <Shield className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-2">No agents found.</p>
          <Link href="/register" className="text-blue-400 hover:text-violet-300 text-sm font-medium">
            Register the first agent
          </Link>
        </div>
      ) : viewMode === "card" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAgents.map((agent, i) => (
            <AgentCard
              key={agent.agent_id}
              agent={agent}
              rank={(page - 1) * PAGE_SIZE + i + 1}
              myWallet={myWallet}
              onInsure={() => setInsuranceAgent(agent)}
            />
          ))}
        </div>
      ) : (
        <div className="glass-card rounded-2xl divide-y divide-white/5 overflow-hidden">
          {sortedAgents.map((agent, i) => (
            <AgentRow
              key={agent.agent_id}
              agent={agent}
              rank={(page - 1) * PAGE_SIZE + i + 1}
              myWallet={myWallet}
              onInsure={() => setInsuranceAgent(agent)}
            />
          ))}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            <span className="text-slate-300 font-semibold">{total}</span> agents · Page <span className="text-slate-300 font-semibold">{page}</span> of {totalPages}
          </span>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}

      {insuranceAgent && (
        <InsuranceModal agent={insuranceAgent} onClose={() => setInsuranceAgent(null)} />
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages: (number | "e")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("e");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("e");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pages.map((p, i) =>
        p === "e" ? (
          <span key={`ellipsis-${i}`} className="w-8 text-center text-slate-600 text-sm">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            className={`w-8 h-8 rounded-xl text-sm font-medium transition-colors ${
              p === page
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function AgentCard({
  agent,
  rank,
  myWallet,
  onInsure,
}: {
  agent: LeaderboardAgent;
  rank: number;
  myWallet?: string;
  onInsure: () => void;
}) {
  const gradientCls = GRADE_COLORS[agent.grade] ?? GRADE_COLORS.C;
  const isOwn = myWallet && (agent.owner_wallet === myWallet || agent.agent_id === myWallet);
  return (
    <div
      className={`relative rounded-3xl border glass-card p-6 flex flex-col gap-4 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300 hover:-translate-y-1 bg-gradient-to-br ${gradientCls}`}
    >
      <div className="absolute top-5 right-5 flex items-center gap-2">
        {isOwn && (
          <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
            My Agent
          </span>
        )}
        <span className="text-xs font-mono text-slate-500">#{rank}</span>
      </div>
      <Link href={`/agent/${agent.agent_id}`} className="flex flex-col gap-1 group">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white group-hover:text-blue-400 transition-colors truncate max-w-[180px]">
            {agent.name ?? `${agent.agent_id.slice(0, 10)}...`}
          </span>
          {agent.framework && agent.framework !== "unknown" && (
            <span className="text-xs bg-slate-800/60 text-slate-400 px-2 py-0.5 rounded-xl shrink-0">
              {agent.framework}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {agent.agent_id.slice(0, 14)}...{agent.agent_id.slice(-6)}
        </div>
        {agent.description && (
          <p className="text-xs text-slate-500 line-clamp-2 mt-1">{agent.description}</p>
        )}
      </Link>
      <div className="flex items-center gap-3">
        <ScoreBadge grade={agent.grade} score={agent.total_score} />
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
            style={{ width: `${agent.total_score}%` }}
          />
        </div>
        <span className="text-sm font-bold text-white w-6 shrink-0">{agent.total_score}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>
          Tasks:{" "}
          <span className="text-slate-300 font-medium">{agent.tx_count}</span>
        </span>
        {agent.anomaly_count > 0 && (
          <span className="text-rose-400">{agent.anomaly_count} anomaly</span>
        )}
      </div>
      <div className="flex gap-2">
        <Link
          href={`/agent/${agent.agent_id}`}
          className="flex-1 text-center py-2 bg-slate-700/50 hover:bg-slate-600/50 border border-white/10 hover:border-blue-500/40 rounded-2xl text-xs font-semibold text-slate-300 transition-colors"
        >
          View Profile
        </Link>
        {agent.external_url && (
          <a
            href={agent.external_url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-2xl text-xs font-semibold transition-colors flex items-center gap-1 text-blue-400"
          >
            Use <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {agent.grade !== "C" && (
          <button
            onClick={onInsure}
            className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-xs font-semibold transition-colors text-emerald-400"
          >
            Insure
          </button>
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  rank,
  myWallet,
  onInsure,
}: {
  agent: LeaderboardAgent;
  rank: number;
  myWallet?: string;
  onInsure: () => void;
}) {
  const isOwn = myWallet && (agent.owner_wallet === myWallet || agent.agent_id === myWallet);
  return (
    <div
      className={`flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.03] transition-colors ${
        isOwn ? "bg-blue-500/5" : ""
      }`}
    >
      <span className="text-xs font-mono text-slate-600 w-6 shrink-0">#{rank}</span>
      <ScoreBadge grade={agent.grade} score={agent.total_score} />
      <Link href={`/agent/${agent.agent_id}`} className="flex-1 min-w-0 group">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white group-hover:text-blue-400 transition-colors truncate text-sm">
            {agent.name ?? `${agent.agent_id.slice(0, 14)}...`}
          </span>
          {agent.framework && agent.framework !== "unknown" && (
            <span className="text-xs bg-slate-800/30 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
              {agent.framework}
            </span>
          )}
          {isOwn && (
            <span className="text-xs bg-blue-500/20 text-violet-300 border border-blue-500/30 px-1.5 py-0.5 rounded-full shrink-0">
              My Agent
            </span>
          )}
        </div>
        <div className="text-xs text-slate-600 font-mono">
          {agent.agent_id.slice(0, 16)}...{agent.agent_id.slice(-6)}
        </div>
      </Link>
      <div className="hidden md:flex items-center gap-1.5 w-28 shrink-0">
        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-pink-500"
            style={{ width: `${agent.total_score}%` }}
          />
        </div>
        <span className="text-sm font-bold text-white w-6 text-right">{agent.total_score}</span>
      </div>
      <span className="hidden sm:block text-xs text-slate-600 w-16 shrink-0 text-right">
        {agent.tx_count} tasks
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        {agent.external_url && (
          <a
            href={agent.external_url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 text-blue-500 hover:text-violet-300 transition-colors"
            title="Agent page"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {agent.grade !== "C" && (
          <button
            onClick={onInsure}
            className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs font-medium text-emerald-400 transition-colors"
          >
            Insure
          </button>
        )}
      </div>
    </div>
  );
}
