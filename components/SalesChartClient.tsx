"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { buildChartSeries, type AgentDailyRow, type ChartMetric } from "@/lib/performance";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Select } from "@/components/ui/Field";

const METRICS: { key: ChartMetric; label: string }[] = [
  { key: "sales", label: "Daily Sales (₱)" },
  { key: "orders", label: "Order Quantity" },
  { key: "calls", label: "Calls Made" },
  { key: "conversion", label: "Conversion Rate" },
];

const CHART_TYPES = ["line", "bar", "area"] as const;
type ChartType = (typeof CHART_TYPES)[number];

const COLORS = ["#a9790f", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#ca8a04"];

function formatMetricValue(metric: ChartMetric, value: number): string {
  if (metric === "sales") return formatCurrency(value);
  if (metric === "conversion") return `${value}%`;
  return String(value);
}

function CustomTooltip({ active, payload, label, metric, groupLabels }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{formatDate(label)}</p>
      {payload.map((entry: any) => {
        const key = entry.dataKey as string;
        const point = entry.payload;
        return (
          <div key={key} className="mb-1.5 last:mb-0">
            <p className="font-medium" style={{ color: entry.color }}>
              {groupLabels[key] || key}: {formatMetricValue(metric, entry.value)}
            </p>
            <p className="text-slate-400">
              Calls {point[`${key}__calls`]} · Orders {point[`${key}__orders`]} · Sales{" "}
              {formatCurrency(point[`${key}__amount`] || 0)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function SalesChartClient({
  dailyData,
  agents,
}: {
  dailyData: AgentDailyRow[];
  agents: { id: string; name: string }[];
}) {
  const [metric, setMetric] = useState<ChartMetric>("sales");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selected, setSelected] = useState<string[]>(agents.slice(0, 1).map((a) => a.id));

  const groups = useMemo(() => {
    if (mode === "all") {
      return [{ key: "all", label: "All Agents", agentIds: agents.map((a) => a.id) }];
    }
    return agents
      .filter((a) => selected.includes(a.id))
      .map((a) => ({ key: a.id, label: a.name, agentIds: [a.id] }));
  }, [mode, selected, agents]);

  const groupLabels = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g.label])), [groups]);
  const series = useMemo(() => buildChartSeries(dailyData, groups, metric), [dailyData, groups, metric]);

  function toggleAgent(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const ChartComponent = chartType === "line" ? LineChart : chartType === "bar" ? BarChart : AreaChart;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Metric</label>
          <Select value={metric} onChange={(e) => setMetric(e.target.value as ChartMetric)} className="w-48">
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Chart type</label>
          <div className="flex rounded-md border border-slate-200 p-1 text-xs">
            {CHART_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setChartType(t)}
                className={`rounded px-3 py-1.5 font-medium capitalize ${
                  chartType === t ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Agents</label>
          <div className="flex rounded-md border border-slate-200 p-1 text-xs">
            <button
              onClick={() => setMode("all")}
              className={`rounded px-3 py-1.5 font-medium ${
                mode === "all" ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setMode("select")}
              className={`rounded px-3 py-1.5 font-medium ${
                mode === "select" ? "bg-[var(--brand-primary)] text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              Select agents
            </button>
          </div>
        </div>
        {mode === "select" && (
          <div className="flex flex-wrap gap-2">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => toggleAgent(a.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  selected.includes(a.id)
                    ? "border-[var(--brand-primary)] bg-[var(--brand-primary-10)] text-[var(--brand-primary)]"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-96 rounded-lg border border-slate-200 bg-white p-4">
        {series.length === 0 || groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {groups.length === 0 ? "Select at least one agent to plot." : "No data for this range."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ChartComponent data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip metric={metric} groupLabels={groupLabels} />} />
              <Legend />
              {groups.map((g, i) => {
                const color = COLORS[i % COLORS.length];
                if (chartType === "line")
                  return <Line key={g.key} type="monotone" dataKey={g.key} name={g.label} stroke={color} strokeWidth={2} dot={{ r: 3 }} />;
                if (chartType === "bar") return <Bar key={g.key} dataKey={g.key} name={g.label} fill={color} />;
                return <Area key={g.key} type="monotone" dataKey={g.key} name={g.label} stroke={color} fill={color} fillOpacity={0.2} />;
              })}
            </ChartComponent>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
