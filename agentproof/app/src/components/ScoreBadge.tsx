interface ScoreBadgeProps {
  grade: string;
  score: number;
}

const GRADE_CONFIG: Record<string, { label: string; color: string }> = {
  AAA: { label: "AAA", color: "text-emerald-400 bg-emerald-500/20 border-emerald-500/30" },
  AA:  { label: "AA",  color: "text-teal-400 bg-teal-500/20 border-teal-500/30" },
  A:   { label: "A",   color: "text-blue-400 bg-blue-500/20 border-blue-500/30" },
  B:   { label: "B",   color: "text-amber-400 bg-amber-500/20 border-amber-500/30" },
  C:   { label: "C",   color: "text-rose-400 bg-rose-500/20 border-rose-500/30" },
};

export function ScoreBadge({ grade, score }: ScoreBadgeProps) {
  const cfg = GRADE_CONFIG[grade] ?? GRADE_CONFIG["C"];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${cfg.color}`}
    >
      <span>{cfg.label}</span>
      {score > 0 && <span className="opacity-60 font-normal">{score}</span>}
    </span>
  );
}
