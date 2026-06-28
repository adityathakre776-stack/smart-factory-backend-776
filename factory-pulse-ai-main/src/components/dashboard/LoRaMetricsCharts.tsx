/**
 * LoRaMetricsCharts — Three per-node LoRa performance graphs
 *
 * Charts:
 *   1. RSSI vs Gateway Distance   (scatter + trend line)
 *   2. Distance vs PDR            (line, rolling session)
 *   3. Distance vs Latency        (scatter, inter-packet gap proxy)
 *
 * Data: accumulated from live SSE events stored in a rolling 60-point buffer
 * per node. No extra API calls needed.
 */

import { useEffect, useRef, useState } from "react";
import { useSensorSSE } from "@/hooks/useSensorSSE";
import {
  ScatterChart, Scatter, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { Activity } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Point = {
  dist: number;   // gateway distance estimate (m)
  rssi: number;   // dBm
  pdr:  number;   // 0-100 %
  lat:  number;   // inter-packet latency ms (proxy)
  seq:  number;
  ts:   number;   // epoch ms
};

const MAX_POINTS = 60;

const NODE_COLORS: Record<string, string> = {
  NODE_01: "#6366f1",
  NODE_02: "#22d3ee",
  NODE_03: "#f59e0b",
};

const NODE_LABELS: Record<string, string> = {
  NODE_01: "NODE 01 · Zone 1",
  NODE_02: "NODE 02 · Zone 2",
  NODE_03: "NODE 03 · Zone 3",
};

const NODES = ["NODE_01", "NODE_02", "NODE_03"] as const;

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, unit, xLabel, yLabel }: {
  active?: boolean;
  payload?: { value: number }[];
  unit?: string;
  xLabel: string;
  yLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card/90 backdrop-blur px-3 py-2 text-xs shadow-xl">
      <p className="text-muted-foreground">{xLabel}: <span className="font-mono text-foreground">{payload[0]?.value?.toFixed(1)}</span></p>
      <p className="text-muted-foreground">{yLabel}: <span className="font-mono text-foreground">{payload[1]?.value?.toFixed(1)}{unit}</span></p>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Activity className="w-4 h-4 text-primary" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// ── Node selector tabs ─────────────────────────────────────────────────────────

function NodeTabs({
  selected, onChange,
}: { selected: string; onChange: (n: string) => void }) {
  return (
    <div className="flex gap-1 mb-4">
      {NODES.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-200 ${
            selected === n
              ? "border-transparent text-black"
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
          style={selected === n ? { background: NODE_COLORS[n] } : {}}
        >
          {n.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}

// ── LoRaMetricsCharts component ────────────────────────────────────────────────

const LoRaMetricsCharts = () => {
  const { latestEventsByNode } = useSensorSSE();

  // Rolling buffer per node
  const bufRef = useRef<Record<string, Point[]>>({
    NODE_01: [], NODE_02: [], NODE_03: [],
  });
  const prevSeqRef = useRef<Record<string, number>>({});
  const prevTsRef  = useRef<Record<string, number>>({});
  const ackRef     = useRef<Record<string, { ok: number; fail: number }>>({
    NODE_01: { ok: 0, fail: 0 },
    NODE_02: { ok: 0, fail: 0 },
    NODE_03: { ok: 0, fail: 0 },
  });

  // Trigger re-render when buffer updates
  const [tick, setTick] = useState(0);
  const [activeNode, setActiveNode] = useState<string>("NODE_01");

  // Accumulate points from SSE
  useEffect(() => {
    let changed = false;
    for (const nodeId of NODES) {
      const evt = latestEventsByNode[nodeId] as Record<string, unknown> | undefined;
      if (!evt) continue;

      const seq  = Number(evt.seq  ?? 0);
      const dist = Number((evt.gateway_distance_estimate_m as number) ?? 0);
      const rssi = Number((evt.gateway_rssi as number) ?? 0);
      const ts   = Date.now();

      if (!seq || seq === prevSeqRef.current[nodeId]) continue;

      // PDR: if seq jumped > 1, count skipped seqs as drops
      const prevSeq = prevSeqRef.current[nodeId] ?? seq;
      const skipped = Math.max(0, seq - prevSeq - 1);
      ackRef.current[nodeId].ok   += 1;
      ackRef.current[nodeId].fail += skipped;
      const { ok, fail } = ackRef.current[nodeId];
      const total = ok + fail;
      const pdr   = total > 0 ? (ok / total) * 100 : 100;

      // Latency proxy: ms since last packet from this node
      const prevTs = prevTsRef.current[nodeId] ?? ts;
      const lat    = ts - prevTs;

      prevSeqRef.current[nodeId] = seq;
      prevTsRef.current[nodeId]  = ts;

      if (dist <= 0 || rssi >= 0) continue;   // skip invalid

      const buf = bufRef.current[nodeId];
      buf.push({ dist, rssi, pdr, lat: Math.min(lat, 5000), seq, ts });
      if (buf.length > MAX_POINTS) buf.shift();
      changed = true;
    }
    if (changed) setTick(t => t + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestEventsByNode]);

  const buf   = bufRef.current[activeNode] ?? [];
  const color = NODE_COLORS[activeNode];

  // Build chart data
  const rssiDistData = buf.map(p => ({ x: p.dist, y: p.rssi }));
  const pdrDistData  = buf.map(p => ({ dist: Math.round(p.dist), pdr: Math.round(p.pdr * 10) / 10 }));
  const latDistData  = buf.map(p => ({ x: p.dist, y: p.lat }));

  const hasData = buf.length > 0;

  return (
    <div className="glass-card p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            LoRa Performance Analytics
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Per-node RSSI · PDR · Latency vs Gateway Distance · Live rolling {MAX_POINTS}-packet window
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full border border-border/50 text-muted-foreground font-mono">
          {buf.length} / {MAX_POINTS} pts
        </span>
      </div>

      {/* Node selector */}
      <NodeTabs selected={activeNode} onChange={setActiveNode} />

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Activity className="w-8 h-8 animate-pulse opacity-40" />
          <p className="text-sm">Waiting for live packets from <span style={{ color }}>{activeNode}</span>…</p>
          <p className="text-xs opacity-60">Charts populate automatically as data arrives</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Chart 1: RSSI vs Distance ─────────────────────────────────── */}
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <SectionHeader
              title="RSSI vs Distance"
              sub="Signal strength across gateway range"
            />
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                <XAxis
                  dataKey="x" type="number" name="Distance"
                  label={{ value: "Distance (m)", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <YAxis
                  dataKey="y" type="number" name="RSSI"
                  label={{ value: "RSSI (dBm)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  content={<ChartTooltip xLabel="Dist" yLabel="RSSI" unit=" dBm" />}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                {/* Reference lines for RSSI quality bands */}
                <ReferenceLine y={-60} stroke="#34d399" strokeDasharray="4 2" label={{ value: "Excellent", fill: "#34d399", fontSize: 9 }} />
                <ReferenceLine y={-90} stroke="#fb923c" strokeDasharray="4 2" label={{ value: "Weak",      fill: "#fb923c", fontSize: 9 }} />
                <Scatter
                  data={rssiDistData}
                  fill={color}
                  opacity={0.8}
                  r={4}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              Green band ≥ -60 dBm · Orange band ≤ -90 dBm
            </p>
          </div>

          {/* ── Chart 2: Distance vs PDR ──────────────────────────────────── */}
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <SectionHeader
              title="Distance vs PDR"
              sub="Packet delivery rate over session"
            />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={pdrDistData} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                <XAxis
                  dataKey="dist"
                  label={{ value: "Distance (m)", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <YAxis
                  domain={[0, 100]}
                  label={{ value: "PDR (%)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 11,
                  }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, "PDR"]}
                  labelFormatter={(l) => `Dist: ${l} m`}
                />
                <ReferenceLine y={90} stroke="#34d399" strokeDasharray="4 2" label={{ value: "90%", fill: "#34d399", fontSize: 9 }} />
                <ReferenceLine y={70} stroke="#fb923c" strokeDasharray="4 2" label={{ value: "70%", fill: "#fb923c", fontSize: 9 }} />
                <Line
                  type="monotone" dataKey="pdr"
                  stroke={color} strokeWidth={2}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              Green ≥ 90% · Orange ≥ 70% · Red &lt; 70%
            </p>
          </div>

          {/* ── Chart 3: Distance vs Latency ─────────────────────────────── */}
          <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <SectionHeader
              title="Distance vs Latency"
              sub="Inter-packet gap proxy (ms)"
            />
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                <XAxis
                  dataKey="x" type="number" name="Distance"
                  label={{ value: "Distance (m)", position: "insideBottom", offset: -12, fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <YAxis
                  dataKey="y" type="number" name="Latency"
                  label={{ value: "Latency (ms)", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  content={<ChartTooltip xLabel="Dist" yLabel="Latency" unit=" ms" />}
                  cursor={{ strokeDasharray: "3 3" }}
                />
                {/* 2000 ms = typical 2-second TX interval */}
                <ReferenceLine y={2000} stroke="#6366f1" strokeDasharray="4 2" label={{ value: "2 s interval", fill: "#6366f1", fontSize: 9 }} />
                <Scatter
                  data={latDistData}
                  fill={color}
                  opacity={0.8}
                  r={4}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground text-center mt-1">
              Purple line = expected 2 s TX interval · spikes = retries / drops
            </p>
          </div>

        </div>
      )}

      {/* Per-node summary bar */}
      {hasData && (
        <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-4">
          {[
            {
              label: "Avg RSSI",
              value: buf.length
                ? `${Math.round(buf.reduce((a, p) => a + p.rssi, 0) / buf.length)} dBm`
                : "—",
              color: "text-cyan-400",
            },
            {
              label: "Session PDR",
              value: buf.length
                ? `${(buf[buf.length - 1].pdr).toFixed(1)}%`
                : "—",
              color: buf.length && buf[buf.length - 1].pdr >= 90
                ? "text-emerald-400"
                : buf.length && buf[buf.length - 1].pdr >= 70
                ? "text-amber-400"
                : "text-red-400",
            },
            {
              label: "Avg Latency",
              value: buf.length
                ? `${Math.round(buf.reduce((a, p) => a + p.lat, 0) / buf.length)} ms`
                : "—",
              color: "text-primary",
            },
          ].map(({ label, value, color: c }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`font-mono font-bold text-sm mt-0.5 ${c}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5"
                style={{ color }}>
                {NODE_LABELS[activeNode]}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LoRaMetricsCharts;
