"use client";
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { agentProof, type RiskScore } from "@/lib/agentproof-sdk";

// Demo 用：模拟恶意 Agent ID
const DEMO_AGENT = "MaliciousAgent111111111111111111111111111";

export default function MonitorPage() {
  const [riskHistory, setRiskHistory] = useState<
    Array<{ time: string; score: number }>
  >([]);
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

  const levelColor =
    currentRisk?.level === "danger"
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
              <div
                className={`text-6xl font-bold mt-1 ${
                  levelColor.split(" ")[0]
                }`}
              >
                {currentRisk.score.toFixed(0)}
              </div>
              <div
                className={`text-lg uppercase font-semibold mt-1 ${
                  levelColor.split(" ")[0]
                }`}
              >
                {currentRisk.level}
              </div>
            </div>
            <div className="space-y-2">
              {Object.entries(currentRisk.breakdown).map(([key, val]) => (
                <div key={key} className="text-sm">
                  <span className="text-gray-400 capitalize">
                    {key.replace("_", " ")}:{" "}
                  </span>
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
              🚨 <strong>FREEZE TRIGGERED</strong> — Submitting freeze
              transaction to Solana...
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
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 12, fill: "#6b7280" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111827",
                border: "1px solid #374151",
              }}
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
        <h2 className="text-lg font-semibold mb-4">
          Alert History ({alerts.length})
        </h2>
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
                      alert.level === "danger"
                        ? "text-red-400"
                        : "text-yellow-400"
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
