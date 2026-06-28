/**
 * useAlarm.ts — Smart Factory
 * ─────────────────────────────────────────────────────────────────────────────
 * Alarm logic for all 3 nodes:
 *
 *  🔥 FLAME  — triggers after 2 consecutive readings with flame=1 per node.
 *              Re-alarms every 5 s while fire persists (NOT the 15-s cooldown).
 *              Plays 3-beep siren pattern + speech. Toast stays for 20 s.
 *
 *  💨 GAS    — critical/warning with 15-s toast cooldown.
 *  🔥 SMOKE  — critical/warning with 15-s toast cooldown.
 *  📳 VIB    — critical/warning with 15-s toast cooldown.
 *  📏 DIST   — critical/warning with 15-s toast cooldown.
 *  🧠 ANOMALY— single critical toast with 15-s cooldown.
 *  📡 OFFLINE— node offline toast with 15-s cooldown.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { loadThresholds, getNodeThreshold } from "@/lib/thresholds";

// ── Speech dedup ─────────────────────────────────────────────────────────────
let lastSpeechText = "";
let lastSpeechTime = 0;
const SPEECH_COOLDOWN_MS = 5000;

// ── General toast cooldown (15 s) ────────────────────────────────────────────
const TOAST_COOLDOWN_MS = 15000;
const lastToastAt: Record<string, number> = {};

function allowToast(kind: string, overrideMs?: number): boolean {
  const now  = Date.now();
  const last = lastToastAt[kind] ?? 0;
  const cdMs = overrideMs ?? TOAST_COOLDOWN_MS;
  if (now - last < cdMs) return false;
  lastToastAt[kind] = now;
  return true;
}

// ── Per-node flame consecutive counter ───────────────────────────────────────
// Key: nodeId  Value: consecutive flame=1 readings received
const flameCount: Record<string, number> = {};
// How many consecutive readings required before alarm fires
const FLAME_CONSECUTIVE_NEEDED = 2;
// Cooldown for repeated flame toast while fire persists (shorter than normal)
const FLAME_REPEAT_MS = 5000;

/** Read the soundAlerts toggle saved by Settings */
function isSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem("sf_misc_settings");
    if (raw) {
      const p = JSON.parse(raw) as { soundAlerts?: boolean };
      if (typeof p.soundAlerts === "boolean") return p.soundAlerts;
    }
  } catch { /* ignore */ }
  return true; // default ON
}

// ── Singleton AudioContext (must survive user-gesture gate) ─────────────────
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  // Resume if suspended (browser pauses it between gestures on some browsers)
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {/* ignore */});
  }
  return _audioCtx;
}

// Pre-warm AudioContext on first user interaction — unlocks browser autoplay gate
if (typeof window !== "undefined") {
  const warmUp = () => {
    try {
      const ctx = getAudioCtx();
      const g   = ctx.createGain();
      g.gain.value = 0;
      g.connect(ctx.destination);
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(0);
    } catch { /* ignore */ }
  };
  ["click", "keydown", "touchstart", "pointerdown"].forEach(e =>
    window.addEventListener(e, warmUp, { once: true, capture: true })
  );
}

export const useAlarm = () => {

  // ── Single beep (singleton AudioContext \u2014 never blocked after first click) ──
  const playBeep = useCallback((critical = false) => {
    if (!isSoundEnabled()) return;
    try {
      const ctx  = getAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = critical ? 1100 : 800;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.55);
    } catch { /* audio blocked */ }
  }, []);

  // ── Emergency fire siren \u2014 5 rapid square-wave beeps ─────────────────────
  const playSiren = useCallback(() => {
    if (!isSoundEnabled()) return;
    try {
      const ctx   = getAudioCtx();
      const freqs = [1400, 900, 1400, 900, 1400]; // high-low alternating
      const gap   = 0.22;
      freqs.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "square";
        const t0 = ctx.currentTime + i * gap;
        gain.gain.setValueAtTime(0,    t0);
        gain.gain.linearRampToValueAtTime(0.5, t0 + 0.03);
        gain.gain.setValueAtTime(0.5,  t0 + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.20);
        osc.start(t0);
        osc.stop(t0 + 0.21);
      });
    } catch { /* audio blocked */ }
  }, []);

  // ── Speech ─────────────────────────────────────────────────────────────────
  const speak = useCallback((msg: string) => {
    if (!isSoundEnabled()) return;

    const now = Date.now();
    if (msg === lastSpeechText && now - lastSpeechTime < SPEECH_COOLDOWN_MS) return;
    lastSpeechText = msg;
    lastSpeechTime = now;
    try {
      window.speechSynthesis.cancel();              // interrupt any ongoing speech
      const utt    = new SpeechSynthesisUtterance(msg);
      utt.lang     = "en-IN";
      utt.rate     = 1.1;
      utt.volume   = 1.0;
      utt.pitch    = 1.1;
      window.speechSynthesis.speak(utt);
    } catch { /* ignore */ }
  }, []);

  // ── Main alarm trigger ──────────────────────────────────────────────────────
  const triggerAlarm = useCallback(
    (data: Record<string, unknown>) => {

      const all       = loadThresholds();
      const rawNode   = String(data.node_id ?? data.nodeId ?? "Unknown");
      const thr       = getNodeThreshold(all, rawNode);
      const nodeLabel = rawNode.replace(/NODE_0?(\d+)/i, "Node $1");

      const flame    = Number(data.flame    ?? 0);
      const gas      = Number(data.gas      ?? data.gas_raw      ?? 0);
      const smoke    = Number(data.smoke    ?? data.smoke_raw    ?? 0);
      const vib      = Number(data.vib      ?? data.vib_magnitude ?? 0);
      const distance = Number(data.distance ?? 0);
      const anomaly  = data.anomaly === true || data.anomaly === 1;

      // ──────────────────────────────────────────────────────────────────────
      // 1. FLAME — consecutive-reading guard (2 in a row → alarm)
      // ──────────────────────────────────────────────────────────────────────
      if (flame >= 1) {
        flameCount[rawNode] = (flameCount[rawNode] ?? 0) + 1;
      } else {
        // Reset counter — flame gone
        flameCount[rawNode] = 0;
      }

      if (flame >= 1 && (flameCount[rawNode] ?? 0) >= FLAME_CONSECUTIVE_NEEDED) {
        // Shorter cooldown for fire so the alert repeats while flame persists
        if (allowToast(`flame_${rawNode}`, FLAME_REPEAT_MS)) {
          playSiren();                             // 3-beep emergency siren
          speak(`FIRE ALERT! Fire confirmed at ${nodeLabel}! Evacuate immediately!`);
          toast({
            variant:     "destructive",
            title:       `🔥 FIRE CONFIRMED — ${nodeLabel}`,
            description: `Flame sensor shows ${flameCount[rawNode]}+ consecutive readings. Evacuate area NOW!`,
            duration:    20000,
          });
        }
        return;   // don't check other sensors when fire is active
      }

      // ──────────────────────────────────────────────────────────────────────
      // Single flame reading — warn but wait for confirmation
      // ──────────────────────────────────────────────────────────────────────
      if (flame >= 1 && (flameCount[rawNode] ?? 0) === 1) {
        if (allowToast(`flame_warn_${rawNode}`, FLAME_REPEAT_MS * 2)) {
          playBeep(true);
          speak(`Warning! Possible fire at ${nodeLabel}. Confirming with next reading.`);
          toast({
            variant:     "destructive",
            title:       `⚠️ Flame Detected — ${nodeLabel}`,
            description: `Single flame reading. Monitoring for confirmation (${FLAME_CONSECUTIVE_NEEDED} needed).`,
            duration:    8000,
          });
        }
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 2. Gas
      // ──────────────────────────────────────────────────────────────────────
      if (gas > 0 && gas >= thr.gas_critical) {
        if (!allowToast(`gas_crit_${rawNode}`)) return;
        playBeep(true);
        speak(`Critical gas level at ${nodeLabel}. Reading ${gas.toFixed(0)}.`);
        toast({
          variant:     "destructive",
          title:       `🚨 CRITICAL Gas — ${nodeLabel}`,
          description: `Gas: ${gas.toFixed(0)} (critical ≥ ${thr.gas_critical}). Evacuate area!`,
          duration:    12000,
        });
        return;
      }
      if (gas > 0 && gas >= thr.gas_warn) {
        if (!allowToast(`gas_warn_${rawNode}`)) return;
        playBeep(false);
        speak(`Warning! Gas elevated at ${nodeLabel}. Level ${gas.toFixed(0)}.`);
        toast({
          title:       `⚠️ High Gas — ${nodeLabel}`,
          description: `Gas: ${gas.toFixed(0)} (warn ≥ ${thr.gas_warn}). Investigate.`,
          duration:    8000,
        });
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 3. Smoke
      // ──────────────────────────────────────────────────────────────────────
      if (smoke > 0 && smoke >= thr.smoke_critical) {
        if (!allowToast(`smoke_crit_${rawNode}`)) return;
        playBeep(true);
        speak(`Critical smoke level at ${nodeLabel}. Reading ${smoke.toFixed(0)}.`);
        toast({
          variant:     "destructive",
          title:       `🚨 CRITICAL Smoke — ${nodeLabel}`,
          description: `Smoke: ${smoke.toFixed(0)} (critical ≥ ${thr.smoke_critical}). Check immediately!`,
          duration:    12000,
        });
        return;
      }
      if (smoke > 0 && smoke >= thr.smoke_warn) {
        if (!allowToast(`smoke_warn_${rawNode}`)) return;
        playBeep(false);
        speak(`Warning! Smoke detected at ${nodeLabel}. Level ${smoke.toFixed(0)}.`);
        toast({
          title:       `💨 Smoke Alert — ${nodeLabel}`,
          description: `Smoke: ${smoke.toFixed(0)} (warn ≥ ${thr.smoke_warn}). Investigate.`,
          duration:    8000,
        });
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 4. Vibration
      // ──────────────────────────────────────────────────────────────────────
      if (vib >= thr.vib_critical) {
        if (!allowToast(`vib_crit_${rawNode}`)) return;
        playBeep(true);
        speak(`Alert! Abnormal vibration at ${nodeLabel}. Magnitude ${vib.toFixed(2)} G.`);
        toast({
          variant:     "destructive",
          title:       `📳 Critical Vibration — ${nodeLabel}`,
          description: `Vibration: ${vib.toFixed(3)} g (critical ≥ ${thr.vib_critical} g). Check machinery!`,
          duration:    8000,
        });
        return;
      }
      if (vib >= thr.vib_warn) {
        if (!allowToast(`vib_warn_${rawNode}`)) return;
        playBeep(false);
        speak(`Warning! Elevated vibration at ${nodeLabel}. Magnitude ${vib.toFixed(2)} G.`);
        toast({
          title:       `📳 High Vibration — ${nodeLabel}`,
          description: `Vibration: ${vib.toFixed(3)} g (warn ≥ ${thr.vib_warn} g). Monitor closely.`,
          duration:    6000,
        });
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 5. Distance / Proximity
      // ──────────────────────────────────────────────────────────────────────
      if (distance > 0 && distance <= thr.dist_critical) {
        if (!allowToast(`dist_crit_${rawNode}`)) return;
        playBeep(true);
        speak(`Alert! Object very close to machine at ${nodeLabel}. Distance ${distance.toFixed(1)} centimetres.`);
        toast({
          variant:     "destructive",
          title:       `⚠️ Object Too Close — ${nodeLabel}`,
          description: `Distance: ${distance.toFixed(1)} cm (critical ≤ ${thr.dist_critical} cm). Check area!`,
          duration:    8000,
        });
        return;
      }
      if (distance > 0 && distance <= thr.dist_warn) {
        if (!allowToast(`dist_warn_${rawNode}`)) return;
        playBeep(false);
        speak(`Warning! Object approaching machine at ${nodeLabel}. Distance ${distance.toFixed(1)} centimetres.`);
        toast({
          title:       `📏 Proximity Warning — ${nodeLabel}`,
          description: `Distance: ${distance.toFixed(1)} cm (warn ≤ ${thr.dist_warn} cm). Monitor.`,
          duration:    6000,
        });
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 6. Anomaly (AI multi-sensor flag)
      // ──────────────────────────────────────────────────────────────────────
      if (anomaly) {
        if (!allowToast(`anomaly_${rawNode}`)) return;
        playBeep(true);
        speak(`Warning! Sensor anomaly detected at ${nodeLabel}. Multiple sensors indicate abnormal conditions.`);
        toast({
          variant:     "destructive",
          title:       `🧠 Anomaly Detected — ${nodeLabel}`,
          description: `Multi-sensor anomaly flag on ${nodeLabel}. Inspect immediately.`,
          duration:    10000,
        });
      }
    },
    [playBeep, playSiren, speak]
  );

  // ── Node offline toast ──────────────────────────────────────────────────────
  const triggerNodeOffline = useCallback(
    (nodeId: string) => {
      const nodeLabel = nodeId.replace(/NODE_0?(\d+)/i, "Node $1");
      if (!allowToast(`offline_${nodeId}`)) return;
      playBeep(false);
      speak(`Warning! ${nodeLabel} is offline. No data received.`);
      toast({
        variant:     "destructive",
        title:       `📡 Node Offline — ${nodeLabel}`,
        description: `${nodeLabel} has stopped sending data. Check power and LoRa connection.`,
        duration:    12000,
      });
    },
    [playBeep, speak]
  );

  return { triggerAlarm, triggerNodeOffline };
};
