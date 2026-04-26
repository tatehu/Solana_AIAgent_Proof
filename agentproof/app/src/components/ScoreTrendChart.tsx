"use client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface DataPoint {
  scored_at: number; // unix timestamp (seconds)
  total_score: number;
}

interface ScoreTrendChartProps {
  data: DataPoint[];
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ScoreTrendChart({ data }: ScoreTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-gray-600 text-sm">
        No history yet — scores accumulate over time
      </div>
    );
  }

  const formatted = data.map((d) => ({
    date: formatDate(d.scored_at),
    score: d.total_score,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={formatted} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fill: "#6b7280", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#6b7280", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "#111827",
            border: "1px solid #374151",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#9ca3af" }}
          itemStyle={{ color: "#10b981" }}
        />
        {/* Grade boundary lines */}
        <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={75} stroke="#3b82f6" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={60} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={45} stroke="#f97316" strokeDasharray="3 3" strokeOpacity={0.4} />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#10b981"
          strokeWidth={2}
          dot={data.length <= 10}
          activeDot={{ r: 4, fill: "#10b981" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
