import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import API from "@/api/api";
import { useSensorSSE } from "@/hooks/useSensorSSE";
import type { SensorEvent } from "@/hooks/useSensorSSE";
import { loadThresholds, getNodeThreshold, type AllThresholds } from "@/lib/thresholds";

// ── Types ─────────────────────────────────────────────────────────────────────

type LivePoint = {
  time: string;
  rawTs: number;
  smoke: number;
  gas: number;
  flame: number;
  distance: number;
  vibration: number;
  anomaly: number;  // 0 | 1
  gatewayDist: number;
};

type NodeBuffer = Record<string, LivePoint[]>;

const NODES = ["NODE_01", "NODE_02", "NODE_03"] as const;
type NodeId = typeof NODES[number];

const MAX_PTS = 80;

const NODE_COLORS: Record<string, { stroke: string; fill: string }> = {
  NODE_01: { stroke: "#6366f1", fill: "#6366f1" },
  NODE_02: { stroke: "#22d3ee", fill: "#22d3ee" },
  NODE_03: { stroke: "#f59e0b", fill: "#f59e0b" },
};

// ── Shared chart UI constants ─────────────────────────────────────────────────

const CHART_MARGIN = { top: 6, right: 16, left: -10, bottom: 0 };
const AXIS_STYLE   = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const GRID_STYLE   = { strokeDasharray: "3 3", stroke: "hsl(var(--border))" };
const TOOLTIP_CONTENT_STYLE = {
  background:   "hsl(var(--card))",
  border:       "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize:     11,
};

// ── Alert config (no closure captures) ───────────────────────────────────────

type AlertCfg = {
  label:   string;
  unit:    string;
  warnLbl: string;
  critLbl: string;
  getVal:   (pt: LivePoint | undefined) => number;
  getPct:   (val: number, critVal: number) => number;
  getSev:   (val: number, warn: number, crit: number) => "normal" | "warning" | "critical";
  getWarn:  (thr: ReturnType<typeof getNodeThreshold>) => number;
  getCrit:  (thr: ReturnType<typeof getNodeThreshold>) => number;
  fmtVal:   (val: number) => string;
};

const ALERT_CFGS: AlertCfg[] = [
  {
    label: "🔥 Smoke", unit: "",
    warnLbl: "", critLbl: "",
    getVal:  pt => pt?.smoke ?? 0,
    getPct:  (v, c) => Math.min(100, c > 0 ? (v / c) * 100 : 0),
    getSev:  (v, w, c) => v >= c ? "critical" : v >= w ? "warning" : "normal",
    getWarn: t => t.smoke_warn,
    getCrit: t => t.smoke_critical,
    fmtVal:  v => String(Math.round(v)),
  },
  {
    label: "💨 Gas", unit: "",
    warnLbl: "", critLbl: "",
    getVal:  pt => pt?.gas ?? 0,
    getPct:  (v, c) => Math.min(100, c > 0 ? (v / c) * 100 : 0),
    getSev:  (v, w, c) => v >= c ? "critical" : v >= w ? "warning" : "normal",
    getWarn: t => t.gas_warn,
    getCrit: t => t.gas_critical,
    fmtVal:  v => String(Math.round(v)),
  },
  {
    label: "📳 Vibration", unit: " g",
    warnLbl: "", critLbl: "",
    getVal:  pt => pt?.vibration ?? 0,
    getPct:  (v, c) => Math.min(100, c > 0 ? (v / c) * 100 : 0),
    getSev:  (v, w, c) => v >= c ? "critical" : v >= w ? "warning" : "normal",
    getWarn: t => t.vib_warn,
    getCrit: t => t.vib_critical,
    fmtVal:  v => v.toFixed(3),
  },
  {
    label: "📏 Distance", unit: " cm",
    warnLbl: "", critLbl: "",
    getVal:  pt => pt?.distance ?? 0,
    // Closer = worse → invert pct
    getPct:  (v, _c) => v > 0 ? Math.min(100, (10 / v) * 50) : 0,
    getSev:  (v, w, c) => v > 0 && v <= c ? "critical" : v > 0 && v <= w ? "warning" : "normal",
    getWarn: t => t.dist_warn,
    getCrit: t => t.dist_critical,
    fmtVal:  v => v.toFixed(1),
  },
  {
    label: "🔴 Flame", unit: "",
    warnLbl: "any", critLbl: "any",
    getVal:  pt => pt?.flame ?? 0,
    getPct:  (v) => v > 0 ? 100 : 0,
    getSev:  (v) => v > 0 ? "critical" : "normal",
    getWarn: () => 0.5,
    getCrit: () => 0.5,
    fmtVal:  v => v > 0 ? "🔥 FIRE!" : "No Flame",
  },
  {
    label: "🧠 Anomaly", unit: "",
    warnLbl: "any", critLbl: "any",
    getVal:  pt => pt?.anomaly ?? 0,
    getPct:  (v) => v > 0 ? 100 : 0,
    getSev:  (v) => v > 0 ? "critical" : "normal",
    getWarn: () => 0.5,
    getCrit: () => 0.5,
    fmtVal:  v => v > 0 ? "⚠ YES" : "Normal",
  },
];

// ── Data helpers ──────────────────────────────────────────────────────────────

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function rawToPoint(d: Record<string, unknown>): LivePoint {
  const n = (k: unknown) => Number(k ?? 0);
  return {
    time:        nowLabel(),
    rawTs:       Date.now(),
    smoke:       n((d.smoke      as number) ?? d.smoke_raw),
    gas:         n((d.gas        as number) ?? d.gas_raw),
    flame:       n(d.flame),
    distance:    n((d.distance   as number) ?? d.dist),
    vibration:   n((d.vib        as number) ?? d.vib_magnitude),
    anomaly:     (d.anomaly === true || d.anomaly === 1) ? 1 : 0,
    gatewayDist: n((d.gateway_distance_estimate_m as number) ?? d.node_gateway_distance_m),
  };
}

function evtToPoint(evt: SensorEvent): LivePoint {
  return rawToPoint(evt as unknown as Record<string, unknown>);
}

function appendPoint(prev: LivePoint[], pt: LivePoint): LivePoint[] {
  if (prev.length > 0 && prev[prev.length - 1].rawTs === pt.rawTs) return prev;
  const next = [...prev, pt];
  return next.length > MAX_PTS ? next.slice(next.length - MAX_PTS) : next;
}

// ── Empty state sub-component (defined outside to avoid re-create on render) ──

const EmptyState = ({ label, node }: { label: string; node: string }) => (
  <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
    <span className="text-3xl animate-pulse">📡</span>
    <span className="text-xs">{label} — waiting for {node}…</span>
  </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

type LiveChartsProps = { forcedNode?: string | null };

const LiveCharts = ({ forcedNode }: LiveChartsProps) => {
  const [selectedNode, setSelectedNode] = useState<string>(forcedNode ?? "NODE_01");
  const [buffers, setBuffers] = useState<NodeBuffer>({
    NODE_01: [], NODE_02: [], NODE_03: [],
  });

  const lastSeqRef   = useRef<Record<string, number>>({});
  const lastPollRef  = useRef<Record<string, number>>({}); 

  const { latestEventsByNode, nodeStatuses } = useSensorSSE();
  const [thresholds, setThresholds] = useState<AllThresholds>(loadThresholds);
  // per-node online status derived from SSE heartbeat + poll
  const [nodeOnline, setNodeOnline] = useState<Record<string, boolean>>(
    { NODE_01: false, NODE_02: false, NODE_03: false }
  );

  // Reload thresholds when Settings page saves
  useEffect(() => {
    const h = () => setThresholds(loadThresholds());
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Sync nodeOnline from SSE heartbeat (authoritative, every 5 s)
  useEffect(() => {
    setNodeOnline({
      NODE_01: nodeStatuses?.NODE_01?.online ?? false,
      NODE_02: nodeStatuses?.NODE_02?.online ?? false,
      NODE_03: nodeStatuses?.NODE_03?.online ?? false,
    });
  }, [nodeStatuses]);

  // Honour forcedNode prop
  useEffect(() => {
    if (forcedNode) setSelectedNode(forcedNode);
  }, [forcedNode]);

  // ── Path 1: SSE real-time push ────────────────────────────────────────────
  useEffect(() => {
    const entries = Object.entries(latestEventsByNode) as [string, SensorEvent][];
    if (entries.length === 0) return;

    setBuffers(prev => {
      const next = { ...prev };
      let changed = false;

      for (const [nodeId, evt] of entries) {
        if (!NODES.includes(nodeId as NodeId)) continue;
        if (!evt) continue;
        // Accept sensor_data (new) or sensor (legacy)
        const t = (evt as { type?: string }).type;
        if (t && t !== "sensor_data" && t !== "sensor") continue;

        const seq = Number((evt as { seq?: number; packet_seq?: number }).seq
          ?? (evt as { packet_seq?: number }).packet_seq ?? 0);
        if (seq > 0 && lastSeqRef.current[nodeId] === seq) continue;
        if (seq > 0) lastSeqRef.current[nodeId] = seq;

        const pt = evtToPoint(evt);
        next[nodeId] = appendPoint(next[nodeId] ?? [], pt);
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [latestEventsByNode]);

  // ── Path 2: Poll /api/latest every 2 s (guaranteed fallback) ─────────────
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await API.get<Record<string, Record<string, unknown>>>("/latest");
        const nodeMap = res.data ?? {};
        if (cancelled) return;

        setBuffers(prev => {
          const next = { ...prev };
          let changed = false;

          for (const nodeId of NODES) {
            const d = nodeMap[nodeId];
            if (!d) continue;

            // Respect the _online flag — don't plot stale offline data
            if (d._online === false) {
              // Update online state without adding a chart point
              setNodeOnline(prev2 => prev2[nodeId] === false ? prev2 : { ...prev2, [nodeId]: false });
              continue;
            }
            setNodeOnline(prev2 => prev2[nodeId] === true ? prev2 : { ...prev2, [nodeId]: true });

            const seq = Number((d.packet_seq as number | undefined)
              ?? (d.seq as number | undefined) ?? 0);
            if (seq > 0 && lastPollRef.current[nodeId] === seq) continue;
            lastPollRef.current[nodeId] = seq || Date.now();

            const pt = rawToPoint(d);
            next[nodeId] = appendPoint(next[nodeId] ?? [], pt);
            changed = true;
          }

          return changed ? next : prev;
        });
      } catch {
        // silent — SSE is primary
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const activeNode = forcedNode ?? selectedNode;
  const data       = buffers[activeNode] ?? [];
  const latest     = data[data.length - 1];
  const thr        = getNodeThreshold(thresholds, activeNode);
  const nc         = NODE_COLORS[activeNode] ?? { stroke: "#6366f1", fill: "#6366f1" };

  const smokeGasMax = Math.max(thr.smoke_critical * 1.2, thr.gas_critical * 1.2,
    ...data.map(d => Math.max(d.smoke, d.gas)), 200);
  const vibMax  = Math.max(thr.vib_critical * 1.2, ...data.map(d => d.vibration), 1);
  const distMax = Math.max(...data.map(d => d.distance), 30);
  const gwMax   = Math.max(...data.map(d => d.gatewayDist), 5);

  return (
    <div className="space-y-4">

      {/* ── Header + Node Tabs ── */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              nodeOnline[activeNode] ? "bg-emerald-400 animate-pulse" : "bg-red-500"
            }`} />
            <h3 className="font-semibold text-sm">Live Node View</h3>
            {nodeOnline[activeNode] ? (
              data.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {data.length} pts · {latest?.time}
                </span>
              )
            ) : (
              <span className="text-xs font-semibold text-red-400 animate-pulse">
                ⬤ OFFLINE — no data from {activeNode}
              </span>
            )}
          </div>

          {!forcedNode && (
            <div className="flex gap-1.5">
              {NODES.map(n => {
                const hasData = (buffers[n]?.length ?? 0) > 0;
                const nc2     = NODE_COLORS[n];
                const active  = selectedNode === n;
                const online  = nodeOnline[n];
                return (
                  <button
                    key={n}
                    onClick={() => setSelectedNode(n)}
                    className={`relative px-3 py-1 rounded-md text-xs font-semibold transition-all border ${
                      active
                        ? "border-transparent text-white shadow-lg scale-105"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                    }`}
                    style={active ? { background: nc2.stroke } : {}}
                  >
                    {n.replace("NODE_", "N")}
                    {/* Online/offline dot */}
                    <span
                      className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-background"
                      style={{ background: online ? "#22c55e" : "#ef4444" }}
                      title={online ? "Online" : "Offline"}
                    />
                    {hasData && online && (
                      <span
                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-background animate-pulse"
                        style={{ background: nc2.stroke }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Charts 2×2 grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Smoke & Gas */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }} className="glass-card p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">🔥 Smoke &amp; Gas</h3>
            {latest && (
              <div className="flex gap-3 text-xs">
                <span className="text-amber-400 font-mono">Smoke: {latest.smoke.toFixed(0)}</span>
                <span className="text-red-400 font-mono">Gas: {latest.gas.toFixed(0)}</span>
              </div>
            )}
          </div>
          <div className="h-52">
            {data.length === 0
              ? <EmptyState label="Smoke & Gas" node={activeNode} />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
                    <YAxis domain={[0, smokeGasMax]} tick={AXIS_STYLE} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                    <ReferenceLine y={thr.smoke_warn} stroke="#f59e0b" strokeDasharray="4 3"
                      label={{ value: "Smoke⚠", fill: "#f59e0b", fontSize: 9 }} />
                    <ReferenceLine y={thr.smoke_critical} stroke="#ef4444" strokeDasharray="4 3"
                      label={{ value: "Smoke🔴", fill: "#ef4444", fontSize: 9 }} />
                    <ReferenceLine y={thr.gas_warn} stroke="#fb923c" strokeDasharray="4 3"
                      label={{ value: "Gas⚠", fill: "#fb923c", fontSize: 9 }} />
                    <Area type="monotone" dataKey="smoke" stroke="#f59e0b" fill="#f59e0b"
                      fillOpacity={0.2} name="Smoke" dot={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="gas" stroke="#ef4444" fill="#ef4444"
                      fillOpacity={0.2} name="Gas" dot={false} isAnimationActive={false} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>
        </motion.div>

        {/* Vibration & Anomaly */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }} className="glass-card p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">📳 Vibration &amp; Anomaly</h3>
            {latest && (
              <div className="flex gap-3 text-xs">
                <span className="font-mono" style={{ color: nc.stroke }}>
                  {latest.vibration.toFixed(3)} g
                </span>
                {latest.anomaly === 1 && (
                  <span className="text-red-400 font-bold animate-pulse">⚠ ANOMALY</span>
                )}
              </div>
            )}
          </div>
          <div className="h-52">
            {data.length === 0
              ? <EmptyState label="Vibration" node={activeNode} />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
                    <YAxis domain={[0, vibMax]} tick={AXIS_STYLE} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE}
                      formatter={(v: number, name: string) =>
                        name === "Anomaly"
                          ? [(v ? "YES" : "NO") as string, name]
                          : [v.toFixed(3), name]
                      }
                    />
                    <ReferenceLine y={thr.vib_warn} stroke="#f59e0b" strokeDasharray="4 3"
                      label={{ value: "Warn", fill: "#f59e0b", fontSize: 9 }} />
                    <ReferenceLine y={thr.vib_critical} stroke="#ef4444" strokeDasharray="4 3"
                      label={{ value: "Critical", fill: "#ef4444", fontSize: 9 }} />
                    <Area type="monotone" dataKey="vibration" stroke={nc.stroke} fill={nc.fill}
                      fillOpacity={0.25} name="Vibration (g)" dot={false} isAnimationActive={false} />
                    <Area type="stepAfter" dataKey="anomaly" stroke="#ef4444" fill="#ef4444"
                      fillOpacity={0.15} name="Anomaly" dot={false} isAnimationActive={false} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>
        </motion.div>

        {/* Distance */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }} className="glass-card p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">📏 Distance Sensor (cm)</h3>
            {latest && (
              <span className="text-xs font-mono text-cyan-400">
                {latest.distance.toFixed(1)} cm
              </span>
            )}
          </div>
          <div className="h-52">
            {data.length === 0
              ? <EmptyState label="Distance" node={activeNode} />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
                    <YAxis domain={[0, distMax + 5]} tick={AXIS_STYLE} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE}
                      formatter={(v: number) => [`${v.toFixed(1)} cm`, "Distance"]}
                    />
                    <Area type="monotone" dataKey="distance" stroke="#22d3ee" fill="#22d3ee"
                      fillOpacity={0.2} name="Distance (cm)" dot={false} isAnimationActive={false} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>
        </motion.div>

        {/* Flame + Gateway Distance */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.24 }} className="glass-card p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">🔴 Flame &amp; GW Distance</h3>
            {latest && (
              <div className="flex gap-3 text-xs">
                <span className={latest.flame ? "text-red-400 font-bold animate-pulse" : "text-emerald-400"}>
                  {latest.flame ? "🔥 FLAME!" : "No Flame"}
                </span>
                <span className="text-purple-400 font-mono">GW: {latest.gatewayDist.toFixed(2)} m</span>
              </div>
            )}
          </div>
          <div className="h-52">
            {data.length === 0
              ? <EmptyState label="Flame & GW Distance" node={activeNode} />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={CHART_MARGIN}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
                    <YAxis yAxisId="left" domain={[0, 1.2]} tick={AXIS_STYLE} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, gwMax + 1]} tick={AXIS_STYLE} />
                    <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE}
                      formatter={(v: number, name: string) =>
                        name === "Flame"
                          ? [(v ? "🔥 YES" : "No") as string, name]
                          : [`${v.toFixed(2)} m`, name]
                      }
                    />
                    <ReferenceLine yAxisId="left" y={0.5} stroke="#ef4444" strokeDasharray="4 3"
                      label={{ value: "Flame Alert", fill: "#ef4444", fontSize: 9 }} />
                    <Area yAxisId="left" type="stepAfter" dataKey="flame"
                      stroke="#ff6b00" fill="#ff6b00" fillOpacity={0.35}
                      name="Flame" dot={false} isAnimationActive={false} />
                    <Area yAxisId="right" type="monotone" dataKey="gatewayDist"
                      stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.2}
                      name="GW Dist (m)" dot={false} isAnimationActive={false} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </div>
        </motion.div>

      </div>

      {/* ── Alert & Threshold Status Panel ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="glass-card p-5"
      >
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            🚨 Alert &amp; Threshold Status
            <span className="text-xs text-muted-foreground font-normal">— {activeNode}</span>
          </h3>
          {latest && (
            <span className="text-xs text-muted-foreground">Live at {latest.time}</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {ALERT_CFGS.map(cfg => {
            const val    = cfg.getVal(latest);
            const warn   = cfg.getWarn(thr);
            const crit   = cfg.getCrit(thr);
            const sev    = cfg.getSev(val, warn, crit);
            const pct    = cfg.getPct(val, crit);
            const col    = sev === "critical" ? "#ef4444" : sev === "warning" ? "#f59e0b" : "#22c55e";

            const warnLbl = cfg.warnLbl || String(warn) + cfg.unit;
            const critLbl = cfg.critLbl || String(crit) + cfg.unit;

            const cardCls = sev === "critical"
              ? "border-red-500/40 bg-red-500/5"
              : sev === "warning"
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-border bg-card/40";

            const badgeCls = sev === "critical"
              ? "bg-red-500/20 text-red-400 border-red-500/40"
              : sev === "warning"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";

            const badgeLabel = sev === "critical" ? "CRIT" : sev === "warning" ? "WARN" : "OK";

            return (
              <div
                key={cfg.label}
                className={`rounded-xl border p-3 space-y-2 transition-colors duration-500 ${cardCls}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-muted-foreground font-medium truncate">
                    {cfg.label}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border whitespace-nowrap ${badgeCls}`}>
                    {badgeLabel}
                  </span>
                </div>
                <div className="text-lg font-bold font-mono leading-tight" style={{ color: col }}>
                  {cfg.fmtVal(val)}{cfg.unit && !cfg.fmtVal(val).includes(cfg.unit) ? cfg.unit : ""}
                </div>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <div>⚠ <span className="text-amber-400 font-mono">{warnLbl}</span></div>
                  <div>🔴 <span className="text-red-400 font-mono">{critLbl}</span></div>
                </div>
                <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: col }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

    </div>
  );
};

export default LiveCharts;