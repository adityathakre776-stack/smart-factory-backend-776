/**
 * useSensorSSE — Real-time sensor data via Server-Sent Events
 *
 * Connects to Flask /api/stream and pushes live updates to the dashboard.
 * Supports ALL 3 nodes (NODE_01, NODE_02, NODE_03) sending data simultaneously.
 * Falls back gracefully to the existing REST polling if SSE is unavailable.
 *
 * Usage:
 *   const { latestEvent, latestEventsByNode, nodeStatuses, isConnected } = useSensorSSE();
 *
 * Key: latestEventsByNode[nodeId] gives the most-recent SSE event for EACH node
 *      so simultaneous transmissions from 3 senders are never lost.
 */

import { useState, useEffect, useRef, useCallback } from "react";

export type NodeStatus = {
  online: boolean;
  last_seen: string | null;
  elapsed_sec: number | null;
};

export type NodeStatuses = {
  NODE_01: NodeStatus;
  NODE_02: NodeStatus;
  NODE_03: NodeStatus;
  [key: string]: NodeStatus;
};

export type SensorEvent = {
  type: "sensor_data" | "node_status" | "ml_score" | "auto_call_triggered" | "sf_rank_update";
  node_id?: string;
  seq?: number;
  smoke?: number;
  gas?: number;
  flame?: number;
  distance?: number;
  vib?: number;
  ax?: number;
  ay?: number;
  az?: number;
  lat?: number;
  lon?: number;
  anomaly?: boolean;
  gateway_rssi?: number;
  gateway_snr?: number;
  gateway_distance_estimate_m?: number;
  lars_score?: number;
  retry_count?: number;
  delivery_status?: string;
  acked?: boolean;
  created_at?: string;
  statuses?: NodeStatuses;
  // ML fields
  ml_anomaly?:    boolean;
  ml_label?:      string;
  ml_confidence?: number;
  ml_reason?:     string;
  ml_score?:      number;
  // SF rank fields (present when type === "sf_rank_update")
  ranks?:      Record<string, { sf: number; rank: number; distance_rank_label: string; rssi: number }>;
  updated_at?: string;
};

/** Per-node map of the latest sensor event from each sender */
export type LatestEventsByNode = Record<string, SensorEvent>;

/** Per-node ML anomaly score — updated only by ml_score SSE events, never overwritten by sensor_data */
export type MLScore = {
  ml_anomaly:    boolean;
  ml_label:      string;   // NORMAL | WARNING | CRITICAL
  ml_confidence: number;   // 0-100
  ml_reason:     string;
  ml_score:      number;
  updated_at:    string;
};
export type MLScoresByNode = Record<string, MLScore>;

/** Per-node real adaptive SF info — updated by sf_rank_update SSE events */
export type SFRankInfo = {
  adaptive_sf:          number;   // 5, 7, or 12
  distance_rank:        number;   // 0=closest, 1=middle, 2=farthest
  distance_rank_label:  string;   // "Closest" | "Middle" | "Farthest"
  rssi:                 number;
  air_time_ms:          number;
  updated_at:           string;
};
export type SFRanksByNode = Record<string, SFRankInfo>;

// Air-time lookup (ms) per SF for 100-byte packet, 125 kHz BW
export const SF_AIRTIME_MS: Record<number, number> = {
  5: 28, 6: 38, 7: 56, 8: 102, 9: 185, 10: 370, 11: 740, 12: 1480,
};

const DEFAULT_NODE_STATUS: NodeStatus = {
  online: false,
  last_seen: null,
  elapsed_sec: null,
};

const DEFAULT_STATUSES: NodeStatuses = {
  NODE_01: { ...DEFAULT_NODE_STATUS },
  NODE_02: { ...DEFAULT_NODE_STATUS },
  NODE_03: { ...DEFAULT_NODE_STATUS },
};

const SSE_RECONNECT_MS = 3000;
const OFFLINE_THRESHOLD_SEC = 12;   // mark offline if no data for 12 s (matches Flask OFFLINE_SEC=12)

function getApiBase(): string {
  const saved = typeof window !== "undefined" ? localStorage.getItem("apiBaseUrl") : null;
  if (saved) {
    return saved.replace(/\/api$/, "");
  }
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:5000`;
}

export function useSensorSSE() {
  const [latestEvent, setLatestEvent] = useState<SensorEvent | null>(null);
  /** Per-node latest events so all 3 senders are visible simultaneously */
  const [latestEventsByNode, setLatestEventsByNode] = useState<LatestEventsByNode>({});
  /** Per-node ML scores — ONLY updated by ml_score SSE events, never cleared by sensor_data */
  const [latestMLByNode, setLatestMLByNode] = useState<MLScoresByNode>({});
  /** Per-node real SF ranks — ONLY updated by sf_rank_update SSE events */
  const [sfRanksByNode, setSfRanksByNode] = useState<SFRanksByNode>({});
  const [nodeStatuses, setNodeStatuses] = useState<NodeStatuses>({ ...DEFAULT_STATUSES });
  const [isConnected, setIsConnected] = useState(false);
  const [sseSupported, setSseSupported] = useState(true);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenRef = useRef<Record<string, number>>({});

  /**
   * Handle incoming sensor_data event.
   * - Updates latestEvent (global, for backward compat)
   * - Updates latestEventsByNode[nodeId] so all 3 nodes are tracked independently
   * - Marks the node as online
   */
  const handleSensorData = useCallback((evt: SensorEvent) => {
    const nodeId = evt.node_id;
    if (!nodeId) return;

    const now = Date.now() / 1000;
    lastSeenRef.current[nodeId] = now;

    // Global latest (kept for backward compatibility with older hook consumers)
    setLatestEvent(evt);

    // Per-node latest — all 3 nodes are tracked independently
    setLatestEventsByNode((prev) => ({
      ...prev,
      [nodeId]: evt,
    }));

    // Mark node online immediately on data arrival
    setNodeStatuses((prev) => ({
      ...prev,
      [nodeId]: {
        online: true,
        last_seen: evt.created_at ?? new Date().toISOString(),
        elapsed_sec: 0,
      },
    }));
  }, []);

  // SSE heartbeat is authoritative — directly replace our local status
  const handleNodeStatus = useCallback((statuses: NodeStatuses) => {
    setNodeStatuses(() => {
      // Start from defaults so nodes never seen don't linger as online
      const next: NodeStatuses = { ...DEFAULT_STATUSES };
      for (const [nodeId, status] of Object.entries(statuses)) {
        next[nodeId] = status;
        // Sync local timer so ticker stays consistent
        if (status.online && status.elapsed_sec != null) {
          lastSeenRef.current[nodeId] = Date.now() / 1000 - status.elapsed_sec;
        }
        // If server says offline, clear local lastSeen so ticker also says offline
        if (!status.online) {
          lastSeenRef.current[nodeId] = 0;
        }
      }
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    if (!("EventSource" in window)) {
      setSseSupported(false);
      return;
    }

    if (esRef.current) {
      esRef.current.close();
    }

    const base = getApiBase();
    const url = `${base}/api/stream`;

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      es.onmessage = (e: MessageEvent) => {
        try {
          // Parse as unknown first so we can safely branch on type
          const raw = JSON.parse(e.data) as Record<string, unknown>;
          const evtType = raw.type as string;

          if (evtType === "sensor_data") {
            handleSensorData(raw as unknown as SensorEvent);

          } else if (evtType === "node_status" && raw.statuses) {
            handleNodeStatus(raw.statuses as NodeStatuses);

          } else if (evtType === "ml_score" && raw.node_id) {
            const nid = raw.node_id as string;
            setLatestMLByNode(prev => ({
              ...prev,
              [nid]: {
                ml_anomaly:    Boolean(raw.ml_anomaly),
                ml_label:      String(raw.ml_label ?? "MODEL_NOT_READY"),
                ml_confidence: Number(raw.ml_confidence ?? 0),
                ml_reason:     String(raw.ml_reason ?? ""),
                ml_score:      Number(raw.ml_score ?? 0),
                updated_at:    String(raw.created_at ?? new Date().toISOString()),
              },
            }));

          } else if (evtType === "sf_rank_update" && raw.ranks) {
            // ── REAL-TIME SF RANK UPDATE ──
            // Backend re-ranks ALL nodes by live RSSI on every packet.
            // Closest RSSI → SF5 (Short), middle → SF7, farthest → SF12 (Longest)
            const now = new Date().toISOString();
            const rawRanks = raw.ranks as Record<string, Record<string, unknown>>;
            setSfRanksByNode(() => {
              const next: SFRanksByNode = {};
              for (const [nid, info] of Object.entries(rawRanks)) {
                const sf = Number(info.sf ?? 7);
                next[nid] = {
                  adaptive_sf:          sf,
                  distance_rank:        Number(info.rank ?? 0),
                  distance_rank_label:  String(info.distance_rank_label ?? "Unknown"),
                  rssi:                 Number(info.rssi ?? 0),
                  air_time_ms:          SF_AIRTIME_MS[sf] ?? 56,
                  updated_at:           String(raw.updated_at ?? now),
                };
              }
              return next;
            });
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        esRef.current = null;
        // Schedule reconnect
        reconnectTimer.current = setTimeout(connect, SSE_RECONNECT_MS);
      };
    } catch {
      setSseSupported(false);
    }
  }, [handleSensorData, handleNodeStatus]);

  // Elapsed-sec ticker — runs every 2 s for fast offline detection
  useEffect(() => {
    const ticker = setInterval(() => {
      const now = Date.now() / 1000;
      setNodeStatuses((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const nodeId of Object.keys(lastSeenRef.current)) {
          const last = lastSeenRef.current[nodeId];
          if (!last) continue;
          const elapsed   = now - last;
          const nowOnline = elapsed < OFFLINE_THRESHOLD_SEC;
          if (
            next[nodeId]?.online !== nowOnline ||
            Math.abs((next[nodeId]?.elapsed_sec ?? 0) - Math.round(elapsed)) >= 1
          ) {
            next[nodeId] = {
              ...next[nodeId],
              online:      nowOnline,
              elapsed_sec: Math.round(elapsed),
            };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);   // 2 s — fast enough to catch 12-s OFFLINE_SEC quickly
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { latestEvent, latestEventsByNode, latestMLByNode, sfRanksByNode, nodeStatuses, isConnected, sseSupported };
}
