import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import axios from "axios";
import API, { freshQueryParams } from "@/api/api";
import { formatChartTime, parseServerDateTime } from "@/lib/dateTime";

const DEFAULT_NODES = ["NODE_01", "NODE_02", "NODE_03"];

// ── Alert thresholds (must match sender firmware) ──────────────────────────
const SMOKE_ALERT_ADC  = 3500;   // MQ2  raw ADC — above warm-up baseline
const GAS_ALERT_ADC    = 1800;   // MQ135 raw ADC
const DIST_ALERT_CM    = 50;     // HC-SR04 — object closer than 50 cm
const VIB_ALERT_MS2    = 2.5;    // m/s² vibration deviation from gravity

type HistoricalPoint = {
  time: string;
  rawTime: number;
  node_id: string;
  vibration: number;
  distance: number;
  anomaly: number;
  smoke: number;
  gas: number;
  flame: number;
};

const timeRanges = [
  { value: "1h",  label: "1 Hour"   },
  { value: "24h", label: "24 Hours" },
];

type Props = { forcedNode?: string | null };

export default function HistoricalAnalysis({ forcedNode }: Props) {
  const [selectedRange, setSelectedRange] = useState("1h");
  const [allData,       setAllData]       = useState<HistoricalPoint[]>([]);
  const [selectedNode,  setSelectedNode]  = useState("ALL");
  const [availableNodes, setAvailableNodes] = useState<string[]>(DEFAULT_NODES);
  const [loading,       setLoading]       = useState(false);
  const [lastFetch,     setLastFetch]     = useState("");
  const [error,         setError]         = useState("");
  const abortRef  = useRef<AbortController | null>(null);

  // ── Data fetcher — single request with AbortController + 25s timeout ────
  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError("");

    try {
      const hoursParam = selectedRange === "24h" ? 24 : 1;
      const baseUrl = (API.defaults.baseURL || "https://smart-factory-backend-776.onrender.com/api").replace(/\/$/, "");
      const url = `${baseUrl}/sensor-data`;

      // Use axios directly with a 25s timeout (global API instance is 10s)
      const token = localStorage.getItem("token");
      const res = await axios.get(url, {
        params:  { ...freshQueryParams(), hours: hoursParam },
        timeout: 25000,
        signal:  ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const rows: any[] = Array.isArray(res.data) ? res.data : [];

      const points: HistoricalPoint[] = rows
        .map((item: any) => {
          const rawTime = parseServerDateTime(item.created_at).getTime();
          return {
            node_id:   String(item.node_id || "UNKNOWN"),
            time:      formatChartTime(item.created_at) || String(item.created_at || ""),
            rawTime:   isNaN(rawTime) ? 0 : rawTime,
            vibration: Math.abs(parseFloat(item.vib_magnitude ?? item.vib ?? 0) || 0),
            distance:  parseFloat(item.distance ?? 0) || 0,
            anomaly:   (item.anomaly === 1 || item.anomaly === true ||
                        item.anomaly_edge === 1 || item.anomaly_edge === true) ? 1 : 0,
            smoke:     parseFloat(item.smoke ?? item.smoke_raw ?? 0) || 0,
            gas:       parseFloat(item.gas   ?? item.gas_raw   ?? 0) || 0,
            flame:     parseFloat(item.flame ?? 0) || 0,
          };
        })
        .filter((p: HistoricalPoint) => p.rawTime > 0)
        .sort((a: HistoricalPoint, b: HistoricalPoint) => a.rawTime - b.rawTime);

      setAllData(points);
      setLastFetch(new Date().toLocaleTimeString());

      const seen = Array.from(new Set(points.map((p: HistoricalPoint) => p.node_id)));
      const merged = [...DEFAULT_NODES, ...seen.filter((n: string) => !DEFAULT_NODES.includes(n))];
      setAvailableNodes(merged.slice(0, 5));
    } catch (err: any) {
      if (axios.isCancel(err) || err?.name === "CanceledError") return; // aborted — ignore
      setError(err?.message || "Fetch failed — is the server running?");
    } finally {
      setLoading(false);
    }
  }, [selectedRange]);

  // ── Auto-refresh every 5 s ───────────────────────────────────────────────
  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => {
      clearInterval(iv);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchData]);

  // Reset node selection if the node disappears from data
  useEffect(() => {
    if (selectedNode !== "ALL" && !availableNodes.includes(selectedNode))
      setSelectedNode("ALL");
  }, [availableNodes]);

  // ── Filtered chart data ──────────────────────────────────────────────────
  const effectiveNode = forcedNode || selectedNode;
  const data = effectiveNode === "ALL"
    ? allData
    : allData.filter((r) => r.node_id === effectiveNode);

  // Dynamic Y-axis max (add 15% headroom, minimum floor)
  const maxVib   = Math.max(VIB_ALERT_MS2 * 1.2, ...data.map((d) => d.vibration));
  const maxDist  = Math.max(DIST_ALERT_CM  * 1.5, ...data.map((d) => d.distance));
  const vibDistTop = Math.ceil(Math.max(maxVib, maxDist) * 1.15);
  const maxSmoke = Math.max(SMOKE_ALERT_ADC * 1.2, ...data.map((d) => d.smoke));
  const maxGas   = Math.max(GAS_ALERT_ADC   * 1.2, ...data.map((d) => d.gas));
  const smokeGasTop = Math.ceil(Math.max(maxSmoke, maxGas) * 1.1 / 100) * 100;

  const tooltipStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card p-6"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg">Historical Analysis</h3>
          {loading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loading && lastFetch && (
            <span className="text-xs text-muted-foreground">↻ {lastFetch}</span>
          )}
          {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Node selector */}
          {!forcedNode && (
            <Tabs value={selectedNode} onValueChange={setSelectedNode}>
              <TabsList className="bg-muted/50 h-8">
                <TabsTrigger value="ALL" className="text-xs px-2">All</TabsTrigger>
                {availableNodes.map((n) => (
                  <TabsTrigger key={n} value={n} className="text-xs px-2">{n}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {forcedNode && (
            <span className="text-xs rounded px-2 py-1 bg-muted/50">Node: {forcedNode}</span>
          )}

          {/* Time range */}
          <Tabs value={selectedRange} onValueChange={setSelectedRange}>
            <TabsList className="bg-muted/50 h-8">
              {timeRanges.map((r) => (
                <TabsTrigger key={r.value} value={r.value} className="text-xs px-2">
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Manual refresh */}
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Download className="w-3 h-3" />
            Export
          </Button>
        </div>
      </div>

      {/* ── Info bar ────────────────────────────────────────────────────── */}
      <p className="text-xs text-muted-foreground mb-4">
        {data.length === 0
          ? "No data yet — waiting for sensor packets…"
          : `Showing ${data.length} packets · ${effectiveNode === "ALL" ? "All nodes" : effectiveNode}`}
      </p>

      {/* ── Charts (always rendered — empty data just shows blank axes) ── */}
      <div className="space-y-6">

        {/* Chart 1 — Vibration & Distance */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Vibration (m/s²) &amp; Distance (cm)
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={[0, vibDistTop]} tick={{ fontSize: 11 }} width={40} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [v.toFixed(2), n]} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                {/* Distance alert at 50 cm */}
                <ReferenceLine
                  y={DIST_ALERT_CM}
                  stroke="#38bdf8"
                  strokeDasharray="5 4"
                  label={{ value: `Dist Alert ${DIST_ALERT_CM}cm`, fill: "#38bdf8", fontSize: 10, position: "insideTopRight" }}
                />
                {/* Vib alert at 2.5 m/s² */}
                <ReferenceLine
                  y={VIB_ALERT_MS2}
                  stroke="#a78bfa"
                  strokeDasharray="5 4"
                  label={{ value: `Vib Alert ${VIB_ALERT_MS2}`, fill: "#a78bfa", fontSize: 10, position: "insideBottomRight" }}
                />
                <Line type="monotone" dataKey="distance"  stroke="#38bdf8" strokeWidth={2} dot={false} name="Distance (cm)" />
                <Line type="monotone" dataKey="vibration" stroke="#a78bfa" strokeWidth={2} dot={false} name="Vibration (m/s²)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2 — Smoke & Gas */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Smoke &amp; Gas (raw ADC 0–4095)
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={[0, smokeGasTop]} tick={{ fontSize: 11 }} width={50} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                {/* Smoke alert */}
                <ReferenceLine
                  y={SMOKE_ALERT_ADC}
                  stroke="#f59e0b"
                  strokeDasharray="5 4"
                  label={{ value: `Smoke Alert ${SMOKE_ALERT_ADC}`, fill: "#f59e0b", fontSize: 10, position: "insideTopRight" }}
                />
                {/* Gas alert */}
                <ReferenceLine
                  y={GAS_ALERT_ADC}
                  stroke="#ef4444"
                  strokeDasharray="5 4"
                  label={{ value: `Gas Alert ${GAS_ALERT_ADC}`, fill: "#ef4444", fontSize: 10, position: "insideTopRight" }}
                />
                <Line type="monotone" dataKey="smoke" stroke="#f59e0b" strokeWidth={2} dot={false} name="Smoke (ADC)" />
                <Line type="monotone" dataKey="gas"   stroke="#ef4444" strokeWidth={2} dot={false} name="Gas (ADC)"   />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3 — Flame & Anomaly */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Flame &amp; Anomaly (0 = normal, 1 = triggered)
          </p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={[0, 1]} ticks={[0, 1]} tick={{ fontSize: 11 }} width={35}
                       tickFormatter={(v) => v === 1 ? "YES" : "NO"} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n: string) => [v === 1 ? "TRIGGERED" : "Normal", n]}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey="flame"   stroke="#ff6b00" strokeWidth={2} dot={false} name="Flame" />
                <Line type="stepAfter" dataKey="anomaly" stroke="#ef4444" strokeWidth={2} dot={false} name="Anomaly" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </motion.div>
  );
}