import { useState, useEffect, useRef, useCallback } from "react";
import Vapi from "@vapi-ai/web";
import { Mic, MicOff, Phone, PhoneOff, Volume2, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Vapi Config ─────────────────────────────────────────────────────────────
// Your Vapi Agent ID — set via VITE_VAPI_PUBLIC_KEY env or hardcoded fallback
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY as string || "";
const AGENT_ID = "d5e9d153-0e86-4a93-a265-98eab9e2f90c";

type CallStatus = "idle" | "connecting" | "active" | "ending" | "error";

interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

export default function VapiAgentCall() {
  const vapiRef = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // ── Initialise Vapi once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) return; // need public key from env

    const vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setStatus("active");
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    });

    vapi.on("call-end", () => {
      setStatus("idle");
      setVolume(0);
      if (timerRef.current) clearInterval(timerRef.current);
    });

    vapi.on("volume-level", (lvl: number) => {
      setVolume(Math.round(lvl * 100));
    });

    vapi.on("message", (msg: any) => {
      if (msg.type === "transcript") {
        const role: "user" | "assistant" =
          msg.role === "assistant" ? "assistant" : "user";
        setTranscript((prev) => [
          ...prev,
          { role, text: msg.transcript, ts: Date.now() },
        ]);
      }
    });

    vapi.on("error", (err: any) => {
      console.error("Vapi error:", err);
      setStatus("error");
      setErrorMsg(
        err?.message || "Call failed. Check your Vapi public key & agent ID."
      );
      if (timerRef.current) clearInterval(timerRef.current);
    });

    return () => {
      vapi.stop();
    };
  }, []);

  // Scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    setStatus("connecting");
    setErrorMsg("");
    setTranscript([]);
    try {
      await vapiRef.current?.start(AGENT_ID);
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message || "Could not start call.");
    }
  }, []);

  const endCall = useCallback(() => {
    setStatus("ending");
    vapiRef.current?.stop();
  }, []);

  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const next = !isMuted;
    vapiRef.current.setMuted(next);
    setIsMuted(next);
  }, [isMuted]);

  // ── Timer formatter ───────────────────────────────────────────────────────
  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Volume bars ───────────────────────────────────────────────────────────
  const bars = Array.from({ length: 12 }, (_, i) => {
    const threshold = ((i + 1) / 12) * 100;
    return volume >= threshold;
  });

  const isActive = status === "active";
  const isConnecting = status === "connecting" || status === "ending";

  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-gradient-to-r from-primary/10 to-accent/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">AI Factory Agent</p>
            <p className="text-xs text-muted-foreground">Powered by Vapi</p>
          </div>
        </div>

        {/* Status pill */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
            isActive
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : isConnecting
              ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
              : status === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-400"
              : "border-border bg-muted text-muted-foreground"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isActive
                ? "bg-emerald-400 animate-pulse"
                : isConnecting
                ? "bg-yellow-400 animate-pulse"
                : status === "error"
                ? "bg-red-400"
                : "bg-muted-foreground"
            }`}
          />
          {isActive
            ? `LIVE · ${fmt(duration)}`
            : isConnecting
            ? "Connecting..."
            : status === "error"
            ? "Error"
            : "Ready"}
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* No public key warning */}
        {!VAPI_PUBLIC_KEY && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
            <strong>Setup needed:</strong> Add{" "}
            <code className="font-mono">VITE_VAPI_PUBLIC_KEY=your_key</code> in{" "}
            <code className="font-mono">factory-pulse-ai-main/.env</code> to enable calls.
            <br />
            <span className="text-muted-foreground">
              Get your public key from{" "}
              <a
                href="https://dashboard.vapi.ai"
                target="_blank"
                rel="noreferrer"
                className="underline text-yellow-400 hover:text-yellow-300"
              >
                dashboard.vapi.ai
              </a>
            </span>
          </div>
        )}

        {/* Error */}
        {status === "error" && errorMsg && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        {/* Volume visualizer */}
        {isActive && (
          <div className="flex items-center justify-center gap-1 py-2">
            {bars.map((active, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-75 ${
                  active ? "bg-primary" : "bg-muted"
                }`}
                style={{
                  width: 4,
                  height: active
                    ? `${12 + Math.sin(i * 0.8) * 10}px`
                    : "6px",
                }}
              />
            ))}
            <Volume2 className="w-4 h-4 text-primary ml-2" />
          </div>
        )}

        {/* Transcript */}
        {transcript.length > 0 && (
          <div className="rounded-xl border border-border bg-background/50 p-3 max-h-48 overflow-y-auto space-y-2">
            {transcript.map((line) => (
              <div
                key={line.ts}
                className={`flex gap-2 ${
                  line.role === "assistant" ? "flex-row" : "flex-row-reverse"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                    line.role === "assistant"
                      ? "bg-primary/10 text-primary-foreground border border-primary/20"
                      : "bg-accent/10 text-accent-foreground border border-accent/20 ml-auto"
                  }`}
                >
                  <span className="font-semibold opacity-60 mr-1">
                    {line.role === "assistant" ? "AI:" : "You:"}
                  </span>
                  {line.text}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {!isActive && !isConnecting ? (
            <Button
              onClick={startCall}
              disabled={!VAPI_PUBLIC_KEY || status === "error"}
              className="h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-500 border-2 border-emerald-400/40 shadow-lg shadow-emerald-900/30 transition-all duration-200 hover:scale-105"
              size="icon"
              title="Start AI Call"
            >
              <Phone className="w-6 h-6 text-white" />
            </Button>
          ) : isConnecting ? (
            <Button
              disabled
              className="h-14 w-14 rounded-full bg-yellow-600/80 border-2 border-yellow-500/40"
              size="icon"
            >
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </Button>
          ) : (
            <>
              {/* Mute */}
              <Button
                onClick={toggleMute}
                variant="outline"
                size="icon"
                title={isMuted ? "Unmute" : "Mute"}
                className={`h-11 w-11 rounded-full transition-all ${
                  isMuted
                    ? "border-red-500/50 bg-red-500/10 text-red-400"
                    : "border-border"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </Button>

              {/* End call */}
              <Button
                onClick={endCall}
                className="h-14 w-14 rounded-full bg-red-600 hover:bg-red-500 border-2 border-red-400/40 shadow-lg shadow-red-900/30 transition-all duration-200 hover:scale-105"
                size="icon"
                title="End Call"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </Button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {isActive
            ? "Tap mic to mute · Red button to end"
            : "Tap phone to talk to your AI factory agent"}
        </p>
      </div>
    </div>
  );
}
