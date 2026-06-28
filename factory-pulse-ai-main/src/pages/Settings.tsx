/**
 * Settings.tsx — Smart Factory
 * Alert threshold configuration: Smoke & Gas only.
 * Saves to localStorage and dispatches a storage event so the
 * dashboard charts update immediately on the same tab.
 */

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Settings as SettingsIcon, Bell, Shield, Palette,
  Database, Save, CheckCircle2, Wind, Flame, Phone, PhoneCall, PhoneOff,
  AlertTriangle, Plus, Trash2, RefreshCw, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { STORAGE_KEY, loadThresholds, type AllThresholds } from "@/lib/thresholds";
import API from "@/api/api";

// ─── helpers ─────────────────────────────────────────────────────────────────
function saveThresholds(data: AllThresholds) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  // localStorage.setItem does NOT fire 'storage' on the same tab →
  // dispatch manually so LiveCharts / KPICards update instantly.
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

// ─── Threshold row component ──────────────────────────────────────────────────
function ThresholdRow({
  label, icon, color,
  warnValue, critValue,
  unit, min, max, step,
  onWarnChange, onCritChange,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  warnValue: number;
  critValue: number;
  unit: string;
  min: number; max: number; step: number;
  onWarnChange: (v: number) => void;
  onCritChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/10 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <span className="font-semibold">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">{unit}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Warning */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />
            Warning threshold
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={min} max={max} step={step}
              value={warnValue}
              onChange={e => onWarnChange(parseFloat(e.target.value) || 0)}
              className="h-10 text-base font-mono border-yellow-400/40 focus:border-yellow-400"
            />
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
          <input
            type="range" min={min} max={max} step={step}
            value={warnValue}
            onChange={e => onWarnChange(parseFloat(e.target.value))}
            className="w-full h-2 rounded accent-yellow-400 cursor-pointer"
          />
          <p className="text-xs text-muted-foreground">
            ⚠️ Show yellow alert above <strong className="text-yellow-400">{warnValue} {unit}</strong>
          </p>
        </div>

        {/* Critical */}
        <div className="space-y-2">
          <Label className="text-sm flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
            Critical threshold
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={min} max={max} step={step}
              value={critValue}
              onChange={e => onCritChange(parseFloat(e.target.value) || 0)}
              className="h-10 text-base font-mono border-red-500/40 focus:border-red-500"
            />
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
          <input
            type="range" min={min} max={max} step={step}
            value={critValue}
            onChange={e => onCritChange(parseFloat(e.target.value))}
            className="w-full h-2 rounded accent-red-500 cursor-pointer"
          />
          <p className="text-xs text-muted-foreground">
            🔴 Show red alert above <strong className="text-red-400">{critValue} {unit}</strong>
          </p>
        </div>
      </div>

      {/* Preview bar */}
      <div className="relative h-3 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-green-500/60 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, (warnValue / max) * 100)}%` }}
        />
        <div
          className="absolute left-0 top-0 h-full bg-red-500/40 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, (critValue / max) * 100)}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-yellow-400"
          style={{ left: `${Math.min(100, (warnValue / max) * 100)}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-red-500"
          style={{ left: `${Math.min(100, (critValue / max) * 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0</span>
        <span className="text-yellow-400">⚠ {warnValue}</span>
        <span className="text-red-400">🔴 {critValue}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Main Settings component ──────────────────────────────────────────────────
const Settings = () => {
  const { fullName } = useAuth();

  // Load initial values from localStorage (or defaults)
  const initial = loadThresholds();
  const [smokeWarn, setSmokeWarn]   = useState(initial.global.smoke_warn);
  const [smokeCrit, setSmokeCrit]   = useState(initial.global.smoke_critical);
  const [gasWarn, setGasWarn]       = useState(initial.global.gas_warn);
  const [gasCrit, setGasCrit]       = useState(initial.global.gas_critical);

  // Load misc settings from localStorage
  const loadMisc = () => {
    try {
      const raw = localStorage.getItem("sf_misc_settings");
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  };
  const misc0 = loadMisc();

  const [notifications, setNotifications] = useState<boolean>(misc0.notifications ?? true);
  const [soundAlerts, setSoundAlerts]     = useState<boolean>(misc0.soundAlerts   ?? true);
  const [refreshInterval, setRefreshInterval] = useState<string>(String(misc0.refreshInterval ?? "5"));

  const [saved, setSaved] = useState(false);

  // ── Auto-Call Agent Settings state ──────────────────────────────────────────
  const { toast } = useToast();
  const [autoCallEnabled, setAutoCallEnabled] = useState(false);
  const [acPhones, setAcPhones] = useState<string[]>(["+918149407616"]);
  const [verifyStatus, setVerifyStatus] = useState<Record<string, "unknown"|"verified"|"unverified"|"checking">>({}); 
  const [newPhone, setNewPhone] = useState("");
  const [addingPhone, setAddingPhone] = useState(false);
  const [acLoading, setAcLoading] = useState(false);
  const [acSaved, setAcSaved] = useState(false);

  // Manual call state
  const [callMsg, setCallMsg] = useState("Urgent: sensor alert at my node — please check dashboard.");
  const [callStatus, setCallStatus] = useState<"idle"|"calling"|"success"|"error">("idle");
  const [callResult, setCallResult] = useState("");

  // Load auto-call settings from backend on mount
  useEffect(() => {
    API.get("/auto-call-settings")
      .then(res => {
        setAutoCallEnabled(res.data.enabled ?? false);
        setAcPhones(res.data.phones ?? ["+918149407616"]);
      })
      .catch(() => {});
  }, []);

  // Verify a single number against Twilio
  const verifyPhone = async (phone: string) => {
    setVerifyStatus(prev => ({ ...prev, [phone]: "checking" }));
    try {
      const res = await API.post("/verify-number", { phone });
      setVerifyStatus(prev => ({ ...prev, [phone]: res.data.verified ? "verified" : "unverified" }));
      if (!res.data.verified) {
        toast({
          variant: "destructive",
          title: "Not Verified in Twilio",
          description: res.data.message,
        });
      }
    } catch {
      setVerifyStatus(prev => ({ ...prev, [phone]: "unknown" }));
    }
  };

  // Save toggle + phone list to backend
  const saveAutoCallSettings = async (enabled: boolean, phones: string[]) => {
    setAcLoading(true);
    try {
      await API.post("/auto-call-settings", { enabled, phones });
      setAcSaved(true);
      setTimeout(() => setAcSaved(false), 2500);
      toast({ title: "Auto-Call Settings Saved" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save Failed", description: e?.message });
    } finally {
      setAcLoading(false);
    }
  };

  const handleToggleAutoCall = async (val: boolean) => {
    setAutoCallEnabled(val);
    await saveAutoCallSettings(val, acPhones);
  };

  const handleAddPhone = async () => {
    const ph = newPhone.trim();
    if (!ph) return;
    setAddingPhone(true);
    try {
      const res = await API.post("/auto-call-settings/add-phone", { phone: ph });
      setAcPhones(res.data.phones);
      setNewPhone("");
      // Auto-verify the new number
      verifyPhone(ph);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Add Failed", description: e?.message });
    } finally {
      setAddingPhone(false);
    }
  };

  const handleRemovePhone = async (phone: string) => {
    try {
      const res = await API.post("/auto-call-settings/remove-phone", { phone });
      setAcPhones(res.data.phones);
      setVerifyStatus(prev => { const s = { ...prev }; delete s[phone]; return s; });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Remove Failed", description: e?.message });
    }
  };

  const handleCallManager = async () => {
    setCallStatus("calling");
    setCallResult("");
    try {
      const res = await API.post("/call-manager", {
        caller_name: fullName || "A factory worker",
        message: callMsg,
      });
      setCallStatus("success");
      setCallResult(res.data?.message || "Call initiated!");
      toast({ title: "Manager Called!", description: `Status: ${res.data?.status}` });
    } catch (err: any) {
      setCallStatus("error");
      const errMsg = err?.response?.data?.error || err?.message || "Call failed.";
      setCallResult(errMsg);
      toast({ variant: "destructive", title: "Call Failed", description: errMsg });
    }
  };

  const handleSave = () => {
    // Build full threshold object, update smoke & gas in ALL node slots + global
    const current = loadThresholds();
    const patch = {
      smoke_warn:     smokeWarn,
      smoke_critical: smokeCrit,
      gas_warn:       gasWarn,
      gas_critical:   gasCrit,
    };
    const updated: AllThresholds = {
      global:  { ...current.global,  ...patch },
      NODE_01: { ...current.NODE_01, ...patch },
      NODE_02: { ...current.NODE_02, ...patch },
      NODE_03: { ...current.NODE_03, ...patch },
    };
    saveThresholds(updated);

    // Misc settings — dispatch storage event so dashboard reacts immediately
    const miscData = { notifications, soundAlerts, refreshInterval };
    localStorage.setItem("sf_misc_settings", JSON.stringify(miscData));
    window.dispatchEvent(new StorageEvent("storage", { key: "sf_misc_settings" }));

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <SettingsIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-sm text-muted-foreground">Alert thresholds and dashboard preferences</p>
              </div>
            </div>
          </div>
          <Button
            onClick={handleSave}
            className="gap-2 min-w-[140px]"
            variant={saved ? "secondary" : "default"}
          >
            {saved
              ? <><CheckCircle2 className="w-4 h-4 text-green-400" /> Saved!</>
              : <><Save className="w-4 h-4" /> Save Changes</>}
          </Button>
        </div>

        <div className="space-y-6">

          {/* ── Alert Thresholds (Smoke & Gas only) ── */}
          <Card className="p-6 border border-border/60">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
                <Bell className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Alert Thresholds</h2>
                <p className="text-sm text-muted-foreground">
                  Set when dashboard graphs show warning (yellow) or critical (red) alert lines.
                  Changes apply to <strong>all nodes</strong> and update the chart immediately after Save.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Smoke */}
              <ThresholdRow
                label="Smoke Alert (MQ2 Raw ADC)"
                icon={<Wind className="w-5 h-5" />}
                color="text-orange-400"
                unit="ADC"
                min={0} max={4095} step={50}
                warnValue={smokeWarn}
                critValue={smokeCrit}
                onWarnChange={setSmokeWarn}
                onCritChange={setSmokeCrit}
              />

              {/* Gas */}
              <ThresholdRow
                label="Gas Alert (MQ135 Raw ADC)"
                icon={<Flame className="w-5 h-5" />}
                color="text-yellow-400"
                unit="ADC"
                min={0} max={4095} step={50}
                warnValue={gasWarn}
                critValue={gasCrit}
                onWarnChange={setGasWarn}
                onCritChange={setGasCrit}
              />
            </div>

            {/* Live preview */}
            <motion.div
              key={`${smokeWarn}-${smokeCrit}-${gasWarn}-${gasCrit}`}
              initial={{ opacity: 0.6, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 rounded-xl bg-muted/20 border border-border/30 p-4"
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Graph label preview (as shown below Smoke &amp; Gas chart)
              </p>
              <p className="text-sm text-center font-mono text-muted-foreground">
                Smoke Alert: <span className="text-orange-400 font-bold">{smokeWarn}</span>
                &nbsp;|&nbsp;
                Gas Alert: <span className="text-yellow-400 font-bold">{gasWarn}</span>
              </p>
              <p className="text-xs text-center text-muted-foreground mt-1">
                Critical — Smoke: <span className="text-red-400">{smokeCrit}</span> &nbsp;/&nbsp;
                Gas: <span className="text-red-400">{gasCrit}</span>
              </p>
            </motion.div>
          </Card>

          {/* ── Notifications ── */}
          <Card className="p-6 border border-border/60">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
                <Bell className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-xl font-semibold">Notifications</h2>
            </div>
            <div className="space-y-4">
              {[
                { id: "notif", label: "Browser Notifications", desc: "Show system popup on critical alert", val: notifications, set: setNotifications },
                { id: "sound", label: "Sound Alerts", desc: "Play alarm when alert triggers", val: soundAlerts, set: setSoundAlerts },
              ].map(item => (
                <div key={item.id} className="flex items-center justify-between">
                  <div>
                    <Label htmlFor={item.id} className="text-sm font-medium">{item.label}</Label>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch id={item.id} checked={item.val} onCheckedChange={item.set} />
                </div>
              ))}
            </div>
          </Card>

          {/* ── Data Refresh ── */}
          <Card className="p-6 border border-border/60">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-green-500/15 flex items-center justify-center">
                <Database className="w-5 h-5 text-green-400" />
              </div>
              <h2 className="text-xl font-semibold">Data Refresh</h2>
            </div>
            <Label htmlFor="refresh" className="text-sm font-medium">Refresh Interval (seconds)</Label>
            <div className="flex items-center gap-3 mt-2">
              <Input
                id="refresh" type="number"
                value={refreshInterval}
                onChange={e => setRefreshInterval(e.target.value)}
                className="w-28 h-9" min="1" max="60"
              />
              <span className="text-sm text-muted-foreground">seconds (fallback when SSE unavailable)</span>
            </div>
          </Card>

          {/* ── Security & Appearance ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Card className="p-5 border border-border/60">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-red-400" />
                </div>
                <h2 className="text-lg font-semibold">Security</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-1">Logged in as</p>
              <p className="font-medium mb-4">{fullName || "User"}</p>
              <Button variant="outline" size="sm">Change Password</Button>
            </Card>
            <Card className="p-5 border border-border/60">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <Palette className="w-5 h-5 text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold">Appearance</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Use the <strong>⚙ icon</strong> in the top-right header to toggle light / dark mode.
              </p>
            </Card>
          </div>

          {/* ── CALL MANAGER + AUTO-CALL SECTION ── */}
          <Card className="p-6 border border-emerald-500/30 bg-emerald-500/5 space-y-6">

            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <PhoneCall className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Call Manager Settings</h2>
                <p className="text-sm text-muted-foreground">Auto-call on flame alert + manual call via Twilio</p>
              </div>
            </div>

            {/* ── AUTO-CALL TOGGLE ── */}
            <div className="rounded-xl border border-border/50 bg-background/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Auto-Call on Flame Alert</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically call all numbers below when flame is detected on <strong>any node</strong> (NODE_01, NODE_02, or NODE_03)
                  </p>
                </div>
                <Switch
                  checked={autoCallEnabled}
                  onCheckedChange={handleToggleAutoCall}
                  disabled={acLoading}
                />
              </div>
              {autoCallEnabled ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  AUTO-CALL ACTIVE — will call when flame is detected on any of NODE_01, NODE_02, NODE_03
                </motion.div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/30 rounded-lg px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                  Auto-call is OFF — turn on to enable automatic emergency calls
                </div>
              )}
            </div>

            {/* ── PHONE NUMBERS LIST ── */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Call Numbers (called on flame alert)</Label>
              <div className="space-y-2">
                {acPhones.map((phone) => {
                  const vs = verifyStatus[phone] || "unknown";
                  return (
                    <div key={phone} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2">
                      <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="font-mono text-sm flex-1">{phone}</span>

                      {/* Verification badge */}
                      {vs === "verified" && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                          <CheckCircle2 className="w-3 h-3" /> Verified
                        </span>
                      )}
                      {vs === "unverified" && (
                        <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
                          <AlertTriangle className="w-3 h-3" /> Not Verified
                        </span>
                      )}
                      {vs === "checking" && (
                        <span className="flex items-center gap-1 text-xs text-yellow-400">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Checking...
                        </span>
                      )}
                      {vs === "unknown" && (
                        <button
                          onClick={() => verifyPhone(phone)}
                          className="text-xs text-primary hover:underline"
                        >Check</button>
                      )}

                      <button
                        onClick={() => handleRemovePhone(phone)}
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add new number */}
              <div className="flex gap-2">
                <Input
                  placeholder="+91XXXXXXXXXX"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddPhone()}
                  className="h-9 font-mono text-sm"
                />
                <Button
                  size="sm"
                  onClick={handleAddPhone}
                  disabled={addingPhone || !newPhone.trim()}
                  className="gap-1 bg-emerald-600 hover:bg-emerald-500 shrink-0"
                >
                  <Plus className="w-4 h-4" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Numbers must be verified in Twilio Console (trial accounts only). Enter with country code e.g. <code>+918149407616</code>
              </p>

              {/* Unverified warning */}
              {Object.values(verifyStatus).includes("unverified") && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-red-400 font-semibold">Some numbers are NOT verified in Twilio</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Go to{" "}
                      <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noreferrer" className="underline text-red-400">
                        Twilio Console &gt; Verified Caller IDs
                      </a>
                      {" "} and verify the number. Calls to unverified numbers will fail on trial accounts.
                    </p>
                  </div>
                </motion.div>
              )}
            </div>

            {/* ── MANUAL CALL ── */}
            <div className="rounded-xl border border-border/50 bg-background/40 p-5 space-y-4">
              <p className="font-semibold text-sm">Manual Emergency Call</p>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Alert message (spoken when manager picks up)</Label>
                <textarea
                  value={callMsg}
                  onChange={e => setCallMsg(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Describe the emergency..."
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleCallManager}
                  disabled={callStatus === "calling"}
                  className={`gap-2 h-10 px-5 font-semibold ${
                    callStatus === "calling"
                      ? "bg-yellow-600 hover:bg-yellow-600"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {callStatus === "calling" ?
                    <><PhoneOff className="w-4 h-4 animate-pulse" /> Calling...</> :
                    <><Phone className="w-4 h-4" /> Call Manager Now</>
                  }
                </Button>
                {callStatus === "success" && (
                  <span className="flex items-center gap-1 text-sm text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" /> {callResult}
                  </span>
                )}
                {callStatus === "error" && (
                  <span className="text-sm text-red-400">{callResult}</span>
                )}
              </div>
            </div>
          </Card>

          {/* Bottom save bar */}
          <div className="flex justify-end gap-3 pb-8">
            <Button
              variant="outline"
              onClick={() => {
                const t = loadThresholds();
                const m = loadMisc();
                setSmokeWarn(t.global.smoke_warn);
                setSmokeCrit(t.global.smoke_critical);
                setGasWarn(t.global.gas_warn);
                setGasCrit(t.global.gas_critical);
                setNotifications(m.notifications ?? true);
                setSoundAlerts(m.soundAlerts ?? true);
                setRefreshInterval(String(m.refreshInterval ?? "5"));
              }}
            >
              Discard Changes
            </Button>
            <Button onClick={handleSave} className="gap-2 min-w-[140px]" variant={saved ? "secondary" : "default"}>
              {saved ? <><CheckCircle2 className="w-4 h-4 text-green-400" /> Saved!</> : <><Save className="w-4 h-4" /> Save Changes</>}
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Settings;
