/**
 * AIInsights.tsx — Real-time Isolation Forest ML Anomaly Panel
 * Receives ML scores via SSE (type="ml_score") on every sensor packet.
 * Polls /api/ml-status and /api/ml-anomalies for persistent history.
 */

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, AlertTriangle, CheckCircle2, RefreshCw,
  Lightbulb, Zap, BarChart2, Shield, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import API from "@/api/api";
import { useSensorSSE } from "@/hooks/useSensorSSE";
import type { MLScore } from "@/hooks/useSensorSSE";

// ── Types ─────────────────────────────────────────────────────────────────────

type MLLabel = "NORMAL" | "WARNING" | "CRITICAL" | "MODEL_NOT_READY" | "ERROR";

type NodeMLState = {
  label:      MLLabel;
  confidence: number;
  reason:     string;
  score:      number;
  updated_at: string;
};

type MLAnomaly = {
  node_id:    string;
  timestamp:  string;
  label:      MLLabel;
  confidence: number;
  reason:     string;
  smoke: number; gas: number; vib: number;
  distance: number; flame: number;
  rssi: number; snr: number;
};

type MLStatus = {
  sklearn_available:    boolean;
  model_status:         string;
  train_rows:           number;
  total_scored:         number;
  new_since_retrain:    number;
  retrain_every:        number;
  contamination:        number;
  features:             string[];
  recent_anomaly_count: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_IDS  = ["NODE_01", "NODE_02", "NODE_03"];
const NODE_COLORS: Record<string, string> = {
  NODE_01: "#6366f1", NODE_02: "#22d3ee", NODE_03: "#f59e0b",
};

const LABEL_STYLE: Record<MLLabel, { bg: string; text: string; border: string; dot: string }> = {
  NORMAL:           { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  WARNING:          { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/30",   dot: "bg-amber-400 animate-pulse" },
  CRITICAL:         { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/30",     dot: "bg-red-500 animate-pulse" },
  MODEL_NOT_READY:  { bg: "bg-muted/20",       text: "text-muted-foreground", border: "border-border", dot: "bg-muted-foreground" },
  ERROR:            { bg: "bg-muted/20",       text: "text-muted-foreground", border: "border-border", dot: "bg-muted-foreground" },
};

function timeAgo(iso: string): string {
  if (!iso) return "—";
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5)   return "just now";
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfBar({ pct, label }: { pct: number; label: MLLabel }) {
  const color =
    label === "CRITICAL" ? "bg-red-500" :
    label === "WARNING"  ? "bg-amber-500" :
    label === "NORMAL"   ? "bg-emerald-500" : "bg-muted-foreground";
  return (
    <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 60 }}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type Props = { nodeId?: string };

const AIInsights = (_props?: Props) => {
  const { latestMLByNode } = useSensorSSE();

  // Per-node live ML state — directly from dedicated SSE state, no manual merging needed
  const nodeML = latestMLByNode;

  // ML model status from REST
  const [mlStatus, setMlStatus] = useState<MLStatus | null>(null);
  // Recent anomaly history from REST
  const [anomalies, setAnomalies] = useState<MLAnomaly[]>([]);
  const [retraining, setRetraining] = useState(false);
  const [tab, setTab] = useState<"live" | "history">("live");
  const prevKeyRef = useRef<Record<string, string>>({});

  // (nodeML is now directly from latestMLByNode — no useEffect needed)

  // ── Poll /api/ml-status every 10s ────────────────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await API.get("/ml-status");
        setMlStatus(res.data);
      } catch { /* silent */ }
    };
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, []);

  // ── Poll /api/ml-anomalies every 15s ─────────────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await API.get("/ml-anomalies?limit=20");
        if (Array.isArray(res.data)) setAnomalies(res.data);
      } catch { /* silent */ }
    };
    fetch();
    const id = setInterval(fetch, 15_000);
    return () => clearInterval(id);
  }, []);

  const handleRetrain = async () => {
    setRetraining(true);
    try {
      await API.post("/ml-retrain");
      setTimeout(() => {
        API.get("/ml-status").then(r => setMlStatus(r.data)).catch(() => {});
        setRetraining(false);
      }, 3000);
    } catch {
      setRetraining(false);
    }
  };

  const modelReady = mlStatus?.model_status === "ready";
  const anomalyNodes = NODE_IDS.filter(n => nodeML[n]?.ml_label === "CRITICAL" || nodeML[n]?.ml_label === "WARNING");

  return (
    <div className="space-y-4">

      {/* ── Model Status Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
          modelReady
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            modelReady ? "bg-emerald-500/15" : "bg-amber-500/15"
          }`}>
            <Brain className={`w-5 h-5 ${modelReady ? "text-emerald-400" : "text-amber-400"}`} />
          </div>
          <div>
            <p className="font-semibold text-sm">
              Isolation Forest{" "}
              <span className={`text-xs font-normal ml-1 ${modelReady ? "text-emerald-400" : "text-amber-400"}`}>
                {mlStatus?.model_status ?? "initialising…"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {mlStatus
                ? `Trained on ${mlStatus.train_rows} rows · ${mlStatus.total_scored} packets scored · ${mlStatus.recent_anomaly_count} anomalies found`
                : "Loading model status…"
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {modelReady && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE SCORING
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetrain}
            disabled={retraining}
            className="h-8 text-xs gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${retraining ? "animate-spin" : ""}`} />
            {retraining ? "Retraining…" : "Retrain"}
          </Button>
        </div>
      </motion.div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 w-fit">
        {(["live", "history"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "live" ? "Live Node Scores" : "Anomaly History"}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "live" ? (
          <motion.div
            key="live"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            {NODE_IDS.map(nodeId => {
              const ml    = nodeML[nodeId];   // MLScore | undefined
              const color = NODE_COLORS[nodeId];
              const label = (ml?.ml_label ?? "MODEL_NOT_READY") as MLLabel;
              const style = LABEL_STYLE[label] ?? LABEL_STYLE["MODEL_NOT_READY"];

              return (
                <motion.div
                  key={nodeId}
                  animate={{
                    boxShadow: label === "CRITICAL" ? "0 0 20px rgba(239,68,68,0.3)" :
                               label === "WARNING"  ? "0 0 14px rgba(245,158,11,0.2)" : "none"
                  }}
                  className={`rounded-xl border ${style.border} ${style.bg} p-4 space-y-3`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                      <span className="font-bold text-sm" style={{ color }}>{nodeId}</span>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${style.border} ${style.text}`}>
                      {label === "MODEL_NOT_READY" ? "—" : label}
                    </span>
                  </div>

                  {/* Confidence bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Anomaly confidence</span>
                      <span className={`font-mono font-bold ${style.text}`}>
                        {ml ? `${ml.ml_confidence}%` : "—"}
                      </span>
                    </div>
                    <ConfBar pct={ml?.ml_confidence ?? 0} label={label} />
                  </div>

                  {/* Reason */}
                  <p className="text-xs text-muted-foreground min-h-[2rem]">
                    {ml?.ml_reason || (modelReady ? "Waiting for first ML score…" : "Model not ready yet")}
                  </p>

                  {/* Footer */}
                  <div className="flex justify-between items-center text-xs text-muted-foreground pt-1 border-t border-border/30">
                    <span>Score: <span className="font-mono">{ml ? ml.ml_score.toFixed(3) : "—"}</span></span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />{ml ? timeAgo(ml.updated_at) : "—"}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="history"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="space-y-2"
          >
            {anomalies.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400 opacity-50" />
                <p className="text-sm font-medium">No anomalies detected</p>
                <p className="text-xs">The Isolation Forest model has not flagged any anomalies yet.</p>
              </div>
            ) : (
              anomalies.map((a, i) => {
                const style = LABEL_STYLE[a.label];
                const nodeColor = NODE_COLORS[a.node_id] ?? "#888";
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`rounded-lg border ${style.border} ${style.bg} px-4 py-3`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
                        <span className="font-semibold text-sm" style={{ color: nodeColor }}>{a.node_id}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${style.border} ${style.text}`}>
                          {a.label}
                        </span>
                        <span className="text-xs text-muted-foreground">{a.confidence}% confidence</span>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />{timeAgo(a.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{a.reason}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs font-mono text-muted-foreground">
                      <span>Smoke:{a.smoke}</span>
                      <span>Gas:{a.gas}</span>
                      <span>Vib:{Number(a.vib).toFixed(2)}g</span>
                      <span>Dist:{a.distance}cm</span>
                      {a.flame > 0 && <span className="text-red-400 font-bold">Flame:YES</span>}
                      <span>RSSI:{a.rssi}dBm</span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ML Model Info Cards ── */}
      {mlStatus && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: <BarChart2 className="w-4 h-4" />, label: "Training Rows", val: mlStatus.train_rows.toLocaleString(), color: "text-primary" },
            { icon: <Zap className="w-4 h-4" />, label: "Packets Scored", val: mlStatus.total_scored.toLocaleString(), color: "text-cyan-400" },
            { icon: <AlertTriangle className="w-4 h-4" />, label: "Anomalies Found", val: mlStatus.recent_anomaly_count.toString(), color: "text-amber-400" },
            { icon: <Shield className="w-4 h-4" />, label: "Contamination", val: `${(mlStatus.contamination * 100).toFixed(0)}%`, color: "text-purple-400" },
          ].map(({ icon, label, val, color }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-muted/10 p-3 flex items-center gap-2">
              <span className={color}>{icon}</span>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`font-bold text-sm font-mono ${color}`}>{val}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Recommendations (dynamic based on live ML) ── */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-sm">AI Recommendations</h3>
          {anomalyNodes.length > 0 && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
              {anomalyNodes.length} node{anomalyNodes.length > 1 ? "s" : ""} need attention
            </span>
          )}
        </div>
        {NODE_IDS.map(nodeId => {
          const ml = nodeML[nodeId];
          if (!ml || ml.ml_label === "NORMAL" || ml.ml_label === "MODEL_NOT_READY") return null;
          const lbl = (ml.ml_label ?? "MODEL_NOT_READY") as MLLabel;
          const style = LABEL_STYLE[lbl] ?? LABEL_STYLE["MODEL_NOT_READY"];
          return (
            <motion.div
              key={nodeId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className={`rounded-lg border ${style.border} ${style.bg} p-3`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm mb-0.5">
                    <span style={{ color: NODE_COLORS[nodeId] }}>{nodeId}</span>
                    {" "}<span className={style.text}>— {lbl} anomaly detected</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{ml.ml_reason}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {lbl === "CRITICAL"
                      ? "Immediate inspection required. Evacuate zone if flame or gas levels are high."
                      : "Monitor closely. Check sensor readings and inspect zone within 10 minutes."}
                  </p>
                </div>
                <span className={`text-xs font-mono font-bold ml-4 shrink-0 ${style.text}`}>
                  {ml.ml_confidence}%
                </span>
              </div>
            </motion.div>
          );
        })}
        {anomalyNodes.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            All nodes operating within normal parameters
          </div>
        )}
      </div>
    </div>
  );
};

export default AIInsights;
