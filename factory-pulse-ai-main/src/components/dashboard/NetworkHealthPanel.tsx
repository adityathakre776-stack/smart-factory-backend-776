/**
 * NetworkHealthPanel — Real-time LoRa Network Health
 * Shows: RSSI gauge, SNR, Throughput (pkt/s), PDR, Air-Time,
 *         LARS Score, Adaptive SF, Retry count, Link quality
 * Data source: SSE (instant) + REST poll (8 s fallback)
 */

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import API from "@/api/api";
import { useSensorSSE } from "@/hooks/useSensorSSE";
import type { SFRankInfo } from "@/hooks/useSensorSSE";
import {
  Wifi, WifiOff, Radio, RefreshCw, BarChart2,
} from "lucide-react";
import LoRaMetricsCharts from "./LoRaMetricsCharts";

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeStatus = {
  node_id: string;
  online: boolean;
  last_seen: string | null;
  smoke: number; gas: number; flame: number;
  vib: number; distance: number; anomaly: boolean;
  rssi: number | null; snr: number | null;
};

type LinkRow = {
  node_id: string;
  rows_10m: number;
  last_seen: string | null;
  link_quality: "strong" | "moderate" | "weak";
  gateway_distance_estimate_m?: number;
  gateway_distance_exact_m?: number;
  gateway_distance_exact_valid?: boolean;
  lars_score?: number;
  retry_count?: number;
  delivery_status?: string;
  ack_timeouts_total?: number;
};

type FactoryProfile = {
  factory_name: string;
  industry: string;
  zones: { id: string; name: string }[];
};

// Per-node live LoRa telemetry (populated from SSE events)
type LoraLive = {
  rssi: number | null;
  snr: number | null;
  lars: number;
  retry: number;
  seq: number;
  delivery: string;
  gw_dist_m: number;
  // computed
  pkt_count: number;       // total packets received this session
  pkt_ts: number[];        // timestamps of last 60 packets (for throughput)
  ack_total: number;
  drop_total: number;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const NODES = ["NODE_01", "NODE_02", "NODE_03"] as const;

const NODE_COLORS: Record<string, string> = {
  NODE_01: "#6366f1",
  NODE_02: "#22d3ee",
  NODE_03: "#f59e0b",
};

const ZONE_LABELS: Record<string, string> = {
  NODE_01: "ZONE_1 — Solvent Mixing Bay",
  NODE_02: "ZONE_2 — Drum Filling Conveyor",
  NODE_03: "ZONE_3 — Storage & Dispatch",
};

const quality: Record<"strong" | "moderate" | "weak", string> = {
  strong:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/15   text-amber-400   border-amber-500/30",
  weak:     "bg-red-500/15     text-red-400     border-red-500/30",
};

// RSSI → quality label & color (per spec: -40=excellent, -85=warn, -120=critical)
function rssiLabel(rssi: number | null): { text: string; color: string; pct: number } {
  if (rssi === null) return { text: "—", color: "text-muted-foreground", pct: 0 };
  if (rssi >= -60) return { text: "EXCELLENT", color: "text-emerald-400", pct: 100 };
  if (rssi >= -75) return { text: "GOOD",      color: "text-cyan-400",    pct: 75  };
  if (rssi >= -90) return { text: "MODERATE",  color: "text-amber-400",   pct: 50  };
  if (rssi >= -105) return { text: "WEAK",     color: "text-orange-400",  pct: 30  };
  return              { text: "CRITICAL",       color: "text-red-400",     pct: 10  };
}

// SNR → quality
function snrLabel(snr: number | null): string {
  if (snr === null) return "—";
  if (snr >= 10) return "EXCELLENT";
  if (snr >= 7)  return "GOOD";
  if (snr >= 5)  return "MODERATE";
  if (snr >= 0)  return "WEAK";
  return "CRITICAL";
}

// ── Real SF helpers (server-driven, not fake) ─────────────────────────────────
// Rank 0 = Short distance (closest)  → SF5 — fast, low power
// Rank 1 = Medium distance (middle)  → SF7 — balanced
// Rank 2 = Longest distance (farthest)→ SF12 — maximum range

// Rank → badge colour
const SF_RANK_STYLE: Record<number, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" }, // Short
  1: { bg: "bg-amber-500/15",   text: "text-amber-400",   border: "border-amber-500/30"   }, // Medium
  2: { bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30"     }, // Longest
};

const RANK_ICON: Record<number, string> = { 0: "🟢", 1: "🟡", 2: "🔴" };
// Human-readable distance label per rank
const RANK_DISTANCE_LABEL: Record<number, string> = {
  0: "Short",
  1: "Medium",
  2: "Longest",
};

function sfBadge(sfInfo: SFRankInfo | undefined) {
  if (!sfInfo) return { label: "SF?", rankLabel: "—", style: SF_RANK_STYLE[2], icon: "" };
  const style = SF_RANK_STYLE[sfInfo.distance_rank] ?? SF_RANK_STYLE[2];
  // Override the server label with our UI label (Short / Medium / Longest)
  const rankLabel = RANK_DISTANCE_LABEL[sfInfo.distance_rank] ?? sfInfo.distance_rank_label;
  return {
    label:     `SF${sfInfo.adaptive_sf}`,
    rankLabel,
    style,
    icon:      RANK_ICON[sfInfo.distance_rank] ?? "",
  };
}

function realAirTime(sfInfo: SFRankInfo | undefined): string {
  if (!sfInfo) return "—";
  return `~${sfInfo.air_time_ms} ms`;
}

// Throughput: packets per second over last 60 s
function calcThroughput(ts_list: number[]): string {
  const now = Date.now();
  const window60 = ts_list.filter(t => now - t < 60_000);
  const pps = window60.length / 60;
  return pps.toFixed(2);
}

// PDR (Packet Delivery Rate)
function calcPDR(ack: number, drop: number): string {
  const total = ack + drop;
  if (total === 0) return "—";
  return ((ack / total) * 100).toFixed(1) + "%";
}

function elapsed(isoStr: string | null): string {
  if (!isoStr) return "—";
  const sec = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

// ── RSSI Gauge component ───────────────────────────────────────────────────────

function RSSIGauge({ rssi, snr }: { rssi: number | null; snr: number | null }) {
  const { text, color, pct } = rssiLabel(rssi);
  // Gauge arc: semi-circle, 180° sweep
  const angle = (pct / 100) * 180;
  const rad = (angle - 90) * (Math.PI / 180);
  const cx = 60, cy = 60, r = 48;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="120" height="70" viewBox="0 0 120 75">
        {/* Background arc */}
        <path d="M 12 62 A 48 48 0 0 1 108 62" fill="none" stroke="currentColor"
          strokeWidth="8" className="text-muted/30" strokeLinecap="round" />
        {/* Colored fill arc */}
        {pct > 0 && (
          <motion.path
            d={`M 12 62 A 48 48 0 ${pct > 50 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)}`}
            fill="none"
            strokeWidth="8" strokeLinecap="round"
            stroke={
              pct >= 75 ? "#34d399" :
              pct >= 50 ? "#38bdf8" :
              pct >= 30 ? "#fb923c" : "#f87171"
            }
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.6 }}
          />
        )}
        {/* Needle */}
        <motion.line
          x1="60" y1="62"
          animate={{
            x2: x.toFixed(1),
            y2: y.toFixed(1),
          }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
          stroke="#fff" strokeWidth="2" strokeLinecap="round"
        />
        <circle cx="60" cy="62" r="4" fill="#fff" />
        {/* Value */}
        <text x="60" y="50" textAnchor="middle" fontSize="11" fontWeight="700"
          fill="currentColor" className="fill-foreground font-mono">
          {rssi !== null ? `${rssi}` : "—"}
        </text>
        <text x="60" y="61" textAnchor="middle" fontSize="7" fill="#64748b">dBm</text>
      </svg>
      <span className={`text-xs font-bold ${color}`}>{text}</span>
      {snr !== null && (
        <span className="text-xs text-muted-foreground">SNR {snr > 0 ? "+" : ""}{snr} dB — {snrLabel(snr)}</span>
      )}
    </div>
  );
}

// ── Mini metric tile ───────────────────────────────────────────────────────────

function MetricTile({
  label, value, unit, sub, color = "text-foreground",
}: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-center">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-mono font-bold text-sm ${color}`}>
        {value}<span className="text-xs font-normal ml-0.5 text-muted-foreground">{unit}</span>
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

type Props = { forcedNode?: string | null };

const NetworkHealthPanel = ({ forcedNode }: Props) => {
  const [nodeStatData, setNodeStatData] = useState<NodeStatus[]>([]);
  const [links, setLinks]               = useState<LinkRow[]>([]);
  const [profile, setProfile]           = useState<FactoryProfile | null>(null);
  const [lastPoll, setLastPoll]         = useState<Date | null>(null);

  // Per-node live LoRa data, updated from SSE
  const [loraLive, setLoraLive] = useState<Record<string, LoraLive>>({});
  const prevKeyRef              = useRef<Record<string, string>>({});

  const { nodeStatuses, isConnected, latestEventsByNode, sfRanksByNode } = useSensorSSE();

  // ── Update LoRa live data every time SSE fires ────────────────────────────
  useEffect(() => {
    for (const [nodeId, evt] of Object.entries(latestEventsByNode)) {
      const e = evt as Record<string, unknown>;
      const key = `${nodeId}:${e.seq ?? e.created_at ?? Date.now()}`;
      if (prevKeyRef.current[nodeId] === key) continue;
      prevKeyRef.current[nodeId] = key;

      setLoraLive(prev => {
        const cur = prev[nodeId] ?? {
          rssi: null, snr: null, lars: 0, retry: 0, seq: 0,
          delivery: "RECEIVED", gw_dist_m: 0,
          pkt_count: 0, pkt_ts: [],
          ack_total: 0, drop_total: 0,
        };
        const now = Date.now();
        const newTs = [...cur.pkt_ts, now].filter(t => now - t < 120_000); // keep 2 min
        return {
          ...prev,
          [nodeId]: {
            rssi:      (e.gateway_rssi as number) ?? cur.rssi,
            snr:       (e.gateway_snr  as number) ?? cur.snr,
            lars:      (e.lars_score   as number) ?? cur.lars,
            retry:     (e.retry_count  as number) ?? cur.retry,
            seq:       (e.seq          as number) ?? cur.seq,
            delivery:  (e.delivery_status as string) ?? cur.delivery,
            gw_dist_m: (e.gateway_distance_estimate_m as number) ?? cur.gw_dist_m,
            pkt_count: cur.pkt_count + 1,
            pkt_ts:    newTs,
            ack_total: e.acked ? cur.ack_total + 1 : cur.ack_total,
            drop_total:(e.acked === false) ? cur.drop_total + 1 : cur.drop_total,
          },
        };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestEventsByNode]);

  // ── REST poll every 8 s ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const [nsRes, nhRes, pfRes] = await Promise.all([
          API.get("/node-status"),
          API.get("/network-health"),
          API.get("/factory-profile"),
        ]);
        if (cancelled) return;
        if (Array.isArray(nsRes.data)) setNodeStatData(nsRes.data);
        if (Array.isArray(nhRes.data)) setLinks(nhRes.data);
        if (pfRes.data && typeof pfRes.data === "object") setProfile(pfRes.data);
        setLastPoll(new Date());
      } catch (e) {
        console.error("NetworkHealthPanel poll error", e);
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const visibleNodes = forcedNode ? NODES.filter(n => n === forcedNode) : [...NODES];
  const visibleLinks = forcedNode ? links.filter(l => l.node_id === forcedNode) : links;

  const getOnline = (nodeId: string) => {
    const sseOnline = nodeStatuses[nodeId]?.online;
    if (sseOnline !== undefined) return sseOnline;
    return nodeStatData.find(n => n.node_id === nodeId)?.online ?? false;
  };

  const getNodeData = (nodeId: string): NodeStatus | undefined => {
    const online = getOnline(nodeId);
    if (!online) return undefined;
    const sseEvt = latestEventsByNode[nodeId] as Record<string, unknown> | undefined;
    if (sseEvt && sseEvt.smoke !== undefined) {
      return {
        node_id: nodeId, online,
        last_seen: (sseEvt.created_at as string) ?? new Date().toISOString(),
        smoke:    Number(sseEvt.smoke    ?? 0),
        gas:      Number(sseEvt.gas      ?? 0),
        flame:    Number(sseEvt.flame    ?? 0),
        vib:      Number(sseEvt.vib      ?? 0),
        distance: Number(sseEvt.distance ?? 0),
        anomaly:  !!(sseEvt.anomaly),
        rssi:     (sseEvt.gateway_rssi as number) ?? null,
        snr:      (sseEvt.gateway_snr  as number) ?? null,
      };
    }
    const polled = nodeStatData.find(n => n.node_id === nodeId);
    return polled?.online ? polled : undefined;
  };

  return (
    <div className="glass-card p-5 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold">LoRa Network Health</h3>
          <p className="text-xs text-muted-foreground">
            {profile?.factory_name || "ApexChem Blending Works"} — Real-time RSSI · SNR · Throughput · PDR
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {isConnected ? (
            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
              <Wifi className="w-3 h-3" /> LIVE SSE
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-400 font-semibold">
              <WifiOff className="w-3 h-3" /> POLLING
            </span>
          )}
          {lastPoll && (
            <span className="text-muted-foreground">
              <RefreshCw className="w-3 h-3 inline mr-1" />Polled {elapsed(lastPoll.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* ── Per-node cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {visibleNodes.map((nodeId) => {
          const online  = getOnline(nodeId);
          const nd      = getNodeData(nodeId);
          const ll      = loraLive[nodeId];
          const lr      = links.find(l => l.node_id === nodeId);
          const color   = NODE_COLORS[nodeId];
          const sseElapsed = nodeStatuses[nodeId]?.elapsed_sec;

          // Prefer SSE live RSSI, fallback to REST
          const rssi   = ll?.rssi ?? nd?.rssi ?? null;
          const snr    = ll?.snr  ?? nd?.snr  ?? null;
          const sfInfo = sfRanksByNode[nodeId];         // real server-driven SF
          const { label: sfLabel, rankLabel, style: sfStyle, icon: sfIcon } = sfBadge(sfInfo);
          const { text: rssiTxt, color: rssiColor, pct: rssiPct } = rssiLabel(rssi);
          const throughput = ll ? calcThroughput(ll.pkt_ts) : "0.00";
          const pdr        = ll ? calcPDR(ll.ack_total, ll.drop_total) : "—";
          const pkts10m    = lr?.rows_10m ?? 0;
          const linkQ      = lr?.link_quality ?? (online ? "moderate" : "weak");

          return (
            <motion.div
              key={nodeId}
              layout
              animate={{
                borderColor: online ? `${color}55` : "hsl(var(--border))",
                boxShadow:   online ? `0 0 18px ${color}22` : "none",
              }}
              transition={{ duration: 0.4 }}
              className="rounded-xl border bg-card/60 backdrop-blur-sm p-4 space-y-3"
            >
              {/* Node header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={online ? "on" : "off"}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? "bg-emerald-400" : "bg-red-500"}`}
                      style={online ? { boxShadow: `0 0 6px ${color}` } : {}}
                    />
                  </AnimatePresence>
                  <span className="font-bold text-sm" style={{ color: online ? color : undefined }}>
                    {nodeId}
                  </span>
                  {online && ll && ll.pkt_count > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-emerald-400">
                      <Radio className="w-2.5 h-2.5 animate-pulse" />×{ll.pkt_count}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Real Adaptive SF badge — driven by live RSSI rank */}
                  {sfInfo && online && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                      sfStyle.bg} ${sfStyle.text} ${sfStyle.border}`}
                    >
                      {sfIcon} {sfLabel}
                      <span className="font-normal opacity-70">
                        ({sfInfo.rssi} dBm)
                      </span>
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                    online
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-red-500/10 text-red-400 border-red-500/30"
                  }`}>
                    {online ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{ZONE_LABELS[nodeId]}</p>

              {online && nd ? (
                <>
                  {/* ── RSSI Gauge ── */}
                  <div className="flex justify-center py-1">
                    <RSSIGauge rssi={rssi} snr={snr} />
                  </div>

                  {/* ── LoRa metrics grid ── */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <MetricTile
                      label="Throughput"
                      value={throughput}
                      unit=" pkt/s"
                      color="text-cyan-400"
                    />
                    <MetricTile
                      label="PDR"
                      value={pdr === "—" ? "—" : pdr}
                      color={pdr === "—" ? "text-muted-foreground" :
                        parseFloat(pdr) >= 90 ? "text-emerald-400" :
                        parseFloat(pdr) >= 70 ? "text-amber-400" : "text-red-400"}
                      sub="delivery rate"
                    />
                    <MetricTile
                      label="Pkts/10m"
                      value={pkts10m.toString()}
                      color={pkts10m >= 20 ? "text-emerald-400" : pkts10m >= 10 ? "text-amber-400" : "text-red-400"}
                    />
                    {/* ─ REAL Adaptive SF — auto-ranked by live RSSI every packet ─ */}
                    <div className={`rounded-lg border ${
                      sfInfo ? `${sfStyle.border} ${sfStyle.bg}` : "border-border/50 bg-muted/10"
                    } px-3 py-2 text-center`}>
                      <p className="text-xs text-muted-foreground mb-0.5">Adaptive SF</p>
                      <p className={`font-mono font-bold text-sm ${sfInfo ? sfStyle.text : "text-muted-foreground"}`}>
                        {sfLabel}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                        {sfInfo ? `${sfIcon} ${rankLabel}` : "—"}
                      </p>
                      {/* Live RSSI that drove the SF assignment */}
                      {sfInfo && (
                        <p className="text-[10px] font-mono mt-0.5" style={{ color: rssiColor }}>
                          {sfInfo.rssi} dBm
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {realAirTime(sfInfo)}
                      </p>
                    </div>
                    <MetricTile
                      label="LARS Score"
                      value={(ll?.lars ?? lr?.lars_score ?? 0).toString()}
                      color="text-primary"
                    />
                    <MetricTile
                      label="Retry"
                      value={(ll?.retry ?? lr?.retry_count ?? 0).toString()}
                      color={(ll?.retry ?? 0) > 2 ? "text-amber-400" : "text-foreground"}
                    />
                  </div>

                  {/* ── Sensor readings ── */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-border/40 pt-2">
                    {[
                      { label: "Smoke", val: nd.smoke, alert: nd.smoke > 1200, unit: "" },
                      { label: "Gas",   val: nd.gas,   alert: nd.gas > 400,   unit: "" },
                      { label: "Vib",   val: Number(nd.vib).toFixed(2), alert: nd.vib > 9.5, unit: " g" },
                      { label: "Dist",  val: nd.distance, alert: nd.distance < 50 && nd.distance > 0, unit: " cm" },
                    ].map(({ label, val, alert, unit }) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`font-mono font-medium ${alert ? "text-red-400" : "text-foreground"}`}>
                          {val}{unit}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Flame</span>
                      <span className={`font-mono font-bold ${nd.flame ? "text-red-400 animate-pulse" : "text-emerald-400"}`}>
                        {nd.flame ? "🔥 YES" : "No"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Anomaly</span>
                      <span className={`font-bold ${nd.anomaly ? "text-red-400" : "text-emerald-400"}`}>
                        {nd.anomaly ? "⚠ YES" : "No"}
                      </span>
                    </div>
                  </div>

                  {/* ── GW distance + status ── */}
                  {ll && ll.gw_dist_m > 0 && (
                    <p className="text-xs text-muted-foreground">
                      GW Distance est.: <span className="font-mono text-primary">{ll.gw_dist_m.toFixed(1)} m</span>
                      {" · "}Seq #{ll.seq}
                      {" · "}<span className={ll.delivery === "ACKED" ? "text-emerald-400" : "text-amber-400"}>{ll.delivery}</span>
                    </p>
                  )}
                </>
              ) : online ? (
                <p className="text-xs text-muted-foreground italic text-center py-4">
                  📡 Waiting for first packet…
                </p>
              ) : (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-3 text-center space-y-1">
                  <p className="text-red-400 font-semibold text-xs">⬤ NODE OFFLINE</p>
                  <p className="text-xs text-muted-foreground">
                    No data for {nodeStatuses[nodeId]?.elapsed_sec ?? "?"} s
                  </p>
                  {nodeStatuses[nodeId]?.last_seen && (
                    <p className="text-xs text-muted-foreground">
                      Last seen {elapsed(nodeStatuses[nodeId]?.last_seen ?? null)}
                    </p>
                  )}
                </div>
              )}

              {/* ── Link quality footer ── */}
              <div className="flex items-center justify-between pt-1 border-t border-border/50 text-xs">
                <span className={`px-2 py-0.5 rounded-full border font-semibold ${quality[linkQ]}`}>
                  {linkQ.toUpperCase()}
                </span>
                <span className="text-muted-foreground">
                  {online && sseElapsed !== undefined && sseElapsed !== null
                    ? `${sseElapsed}s ago`
                    : nd?.last_seen ? elapsed(nd.last_seen) : "never"}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Gateway summary bar ── */}
      {!forcedNode && (
        <div className="rounded-xl border border-border/40 bg-muted/10 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Network-wide throughput */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Total Throughput</p>
            <p className="font-mono font-bold text-primary">
              {(
                NODES.reduce((acc, n) => {
                  const ll = loraLive[n];
                  return acc + (ll ? parseFloat(calcThroughput(ll.pkt_ts)) : 0);
                }, 0)
              ).toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground ml-1">pkt/s</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Online Nodes</p>
            <p className="font-mono font-bold text-emerald-400">
              {NODES.filter(n => getOnline(n)).length} / {NODES.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">Avg RSSI</p>
            <p className="font-mono font-bold">
              {(() => {
                const vals = NODES.map(n => loraLive[n]?.rssi).filter(v => v !== null && v !== undefined) as number[];
                if (!vals.length) return "—";
                return `${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} dBm`;
              })()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-0.5">LoRa Band</p>
            <p className="font-mono font-bold text-purple-400">433 MHz · 125kHz BW</p>
          </div>
        </div>
      )}

      {/* ── LoRa Link Health table (manager view only) ── */}
      {!forcedNode && visibleLinks.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" /> LoRa Link Health (last 10 min)
          </h4>
          <div className="space-y-1.5">
            {visibleLinks.map(r => {
              const online  = getOnline(r.node_id);
              const color   = NODE_COLORS[r.node_id];
              const ll      = loraLive[r.node_id];
              // Use real server-ranked SF — same data as node cards
              const sfInfo  = sfRanksByNode[r.node_id];
              const { label: sfLabel, rankLabel: sfRankLabel, style: sfStyle, icon: sfRankIcon } = sfBadge(sfInfo);
              return (
                <div
                  key={r.node_id}
                  className="flex flex-wrap items-center justify-between border border-border rounded-lg px-3 py-2 text-xs gap-2"
                  style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
                      <span style={{ color }}>{r.node_id}</span>
                      <span className="text-muted-foreground font-normal">{r.rows_10m} pkts/10m</span>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-2">
                      <span>RSSI: <span className={`font-mono ${rssiLabel(ll?.rssi ?? null).color}`}>{ll?.rssi ?? "—"} dBm</span></span>
                      <span>SNR: <span className="font-mono">{ll?.snr ?? "—"} dB</span></span>
                      <span>SF: <span className={`font-mono font-bold ${sfInfo ? sfStyle.text : "text-purple-400"}`}>
                        {sfRankIcon} {sfLabel} <span className="text-muted-foreground font-normal">({sfRankLabel})</span>
                      </span></span>
                      <span>Air: <span className="font-mono">{realAirTime(sfInfo)}</span></span>
                      <span>Throughput: <span className="text-cyan-400 font-mono">{ll ? calcThroughput(ll.pkt_ts) : "0.00"} pkt/s</span></span>
                      <span>PDR: <span className="font-mono">{ll ? calcPDR(ll.ack_total, ll.drop_total) : "—"}</span></span>
                      <span>Retry: {r.retry_count ?? 0}</span>
                      <span>LARS: {r.lars_score ?? 0}</span>
                      <span>GW Dist:{" "}
                        {r.gateway_distance_exact_valid
                          ? `${Number(r.gateway_distance_exact_m || 0).toFixed(1)} m`
                          : `${Number(r.gateway_distance_estimate_m || 0).toFixed(1)} m est.`}
                      </span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${quality[r.link_quality]}`}>
                    {r.link_quality.toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LoRa Performance Charts ── */}
      <LoRaMetricsCharts />

    </div>
  );
};

export default NetworkHealthPanel;
