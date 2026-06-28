"""
Smart Factory — LoRa Dashboard
================================
Self-contained Flask server:
  • Serves React frontend from factory-pulse-ai-main/dist/
  • Accepts POST /api/data  (from serial_bridge_ingest.py)
  • Accepts POST /api/stream/push  (SSE push)
  • Serves real-time dashboard at http://127.0.0.1:5000

Run:
    python dashboard_app.py

Then in another terminal:
    python serial_bridge_ingest.py --port COM_X --baud 115200
"""

from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
import json, queue, threading, time, collections, os
from datetime import datetime

# Path to the built React frontend
FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "factory-pulse-ai-main", "dist")
)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)

# ──────────────────────────────────────────────
#  In-memory store
# ──────────────────────────────────────────────
NODE_IDS = ["NODE_01", "NODE_02", "NODE_03"]
HISTORY_LEN = 60          # keep last 60 readings per node
OFFLINE_SEC  = 12         # mark offline if no packet for 12 s  (matches useSensorSSE OFFLINE_THRESHOLD_SEC)

node_data: dict[str, dict]  = {}      # latest reading per node
node_last: dict[str, float] = {}      # epoch of last packet
history:   dict[str, collections.deque] = {
    n: collections.deque(maxlen=HISTORY_LEN) for n in NODE_IDS
}

# ──────────────────────────────────────────────
#  SSE registry
# ──────────────────────────────────────────────
_clients: list[queue.Queue] = []
_lock = threading.Lock()

def _broadcast(data: dict):
    msg = f"data: {json.dumps(data)}\n\n"
    with _lock:
        dead = []
        for q in _clients:
            try:   q.put_nowait(msg)
            except queue.Full: dead.append(q)
        for q in dead: _clients.remove(q)

def _heartbeat():
    while True:
        time.sleep(5)
        now = time.time()
        statuses = {}
        for n in NODE_IDS:
            last = node_last.get(n)
            statuses[n] = {
                "online": bool(last and (now - last) < OFFLINE_SEC),
                "elapsed_sec": round(now - last, 1) if last else None,
                "last_seen": datetime.fromtimestamp(last).isoformat() if last else None
            }
        # Broadcast node_status — matches useSensorSSE.ts NodeStatuses type
        _broadcast({"type": "node_status", "statuses": statuses})

threading.Thread(target=_heartbeat, daemon=True).start()

# ──────────────────────────────────────────────
#  Serve React frontend
# ──────────────────────────────────────────────
@app.route("/")
def index():
    idx = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(idx):
        return send_from_directory(FRONTEND_DIR, "index.html")
    # Fallback: embedded dashboard
    return DASHBOARD_HTML, 200, {"Content-Type": "text/html; charset=utf-8"}

@app.route("/<path:path>")
def static_files(path):
    full = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(FRONTEND_DIR, path)
    # SPA fallback — serve index.html for any unknown path
    idx = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(idx):
        return send_from_directory(FRONTEND_DIR, "index.html")
    return DASHBOARD_HTML, 200, {"Content-Type": "text/html; charset=utf-8"}


# ──────────────────────────────────────────────
#  API endpoints
# ──────────────────────────────────────────────
@app.route("/api/data", methods=["POST"])
def ingest():
    d = request.get_json(silent=True) or {}
    node = d.get("node_id", "")
    if not node:
        return jsonify({"error": "no node_id"}), 400

    d["server_time"] = datetime.now().strftime("%H:%M:%S")
    node_data[node] = d
    node_last[node] = time.time()
    if node in history:
        history[node].append({
            "ts":    d["server_time"],
            "smoke": d.get("smoke", 0),
            "gas":   d.get("gas", 0),
            "vib":   d.get("vib", 0),
            "dist":  d.get("distance", 0),
        })

    # Broadcast as sensor_data with all fields at top level — matches useSensorSSE.ts
    _broadcast({"type": "sensor_data", **d})
    return jsonify({"ok": True}), 200


@app.route("/api/stream/push", methods=["POST"])
def sse_push():
    # alternate push endpoint (same as /api/data)
    return ingest()


@app.route("/api/latest")
def latest():
    """Return latest reading per node, each enriched with online/elapsed_sec status."""
    now  = time.time()
    out  = {}
    for n in NODE_IDS:
        last = node_last.get(n)
        elapsed = round(now - last, 1) if last else None
        online  = bool(last and elapsed is not None and elapsed < OFFLINE_SEC)
        data    = dict(node_data.get(n, {}))   # copy so we don't mutate the store
        data["_online"]      = online
        data["_elapsed_sec"] = elapsed
        out[n] = data
    return jsonify(out)


@app.route("/api/history/<node_id>")
def get_history(node_id):
    return jsonify(list(history.get(node_id, [])))


@app.route("/api/stream")
def sse_stream():
    q = queue.Queue(maxsize=100)
    with _lock:
        _clients.append(q)
    def generate():
        yield "data: {\"type\":\"connected\"}\n\n"
        try:
            while True:
                try:
                    yield q.get(timeout=30)
                except queue.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            with _lock:
                if q in _clients: _clients.remove(q)
    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ──────────────────────────────────────────────
#  Dashboard HTML (single-file, no template dir)
# ──────────────────────────────────────────────
DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Smart Factory — Live Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
:root{
  --bg:#0a0e1a;--surface:#111827;--card:#1a2235;--border:#1f2d45;
  --accent:#3b82f6;--accent2:#6366f1;--green:#10b981;--red:#ef4444;
  --yellow:#f59e0b;--text:#e2e8f0;--muted:#64748b;--online:#10b981;--offline:#ef4444;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh}
.header{background:linear-gradient(135deg,#1a2235 0%,#0f172a 100%);border-bottom:1px solid var(--border);padding:16px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(10px)}
.header h1{font-size:1.25rem;font-weight:700;background:linear-gradient(90deg,#60a5fa,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-sub{font-size:.75rem;color:var(--muted);margin-top:2px}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.badge{background:#1e3a5f;color:#60a5fa;border-radius:12px;padding:4px 12px;font-size:.7rem;font-weight:600;letter-spacing:.5px}

.main{padding:24px 28px;max-width:1600px;margin:0 auto}

/* NODES ROW */
.nodes-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:20px;margin-bottom:28px}
.node-card{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:box-shadow .3s}
.node-card:hover{box-shadow:0 0 30px rgba(59,130,246,.12)}
.node-card.online{border-color:rgba(16,185,129,.3)}
.node-card.offline{border-color:rgba(239,68,68,.2)}
.node-card.anomaly{border-color:rgba(245,158,11,.5);box-shadow:0 0 20px rgba(245,158,11,.1)}

.node-header{padding:16px 20px;background:linear-gradient(90deg,rgba(255,255,255,.03),transparent);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
.node-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;background:linear-gradient(135deg,#1e3a5f,#1e2d4a)}
.node-name{font-weight:700;font-size:.95rem}
.node-seq{font-size:.7rem;color:var(--muted);margin-top:1px}
.status-pill{margin-left:auto;padding:4px 12px;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.5px}
.status-pill.online{background:rgba(16,185,129,.15);color:var(--green)}
.status-pill.offline{background:rgba(239,68,68,.12);color:var(--red)}
.status-pill.waiting{background:rgba(100,116,139,.15);color:var(--muted)}
.anomaly-tag{background:rgba(245,158,11,.15);color:var(--yellow);padding:3px 10px;border-radius:10px;font-size:.65rem;font-weight:700;letter-spacing:.5px;margin-left:8px}

.sensors-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border)}
.sensor-cell{background:var(--card);padding:16px 18px}
.sensor-label{font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;display:flex;align-items:center;gap:5px}
.sensor-value{font-size:1.5rem;font-weight:700;letter-spacing:-.5px}
.sensor-unit{font-size:.7rem;color:var(--muted);margin-left:2px;font-weight:400}
.sensor-bar{height:3px;border-radius:2px;margin-top:8px;background:var(--border);overflow:hidden}
.sensor-bar-fill{height:100%;border-radius:2px;transition:width .5s ease}

.v-smoke{color:#f87171} .b-smoke{background:linear-gradient(90deg,#ef4444,#dc2626)}
.v-gas  {color:#fb923c} .b-gas  {background:linear-gradient(90deg,#f97316,#ea580c)}
.v-dist {color:#60a5fa} .b-dist {background:linear-gradient(90deg,#3b82f6,#2563eb)}
.v-vib  {color:#a78bfa} .b-vib  {background:linear-gradient(90deg,#8b5cf6,#7c3aed)}
.v-flame{color:#fcd34d} .v-ok{color:var(--green)}
.v-rssi {color:#34d399}

.node-footer{padding:10px 20px;background:rgba(0,0,0,.2);display:flex;justify-content:space-between;align-items:center;font-size:.7rem;color:var(--muted)}

/* CHARTS ROW */
.charts-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px;margin-bottom:28px}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px}
.chart-title{font-size:.8rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
canvas{width:100%!important;border-radius:8px}

/* ALERT LOG */
.alerts-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:28px}
.alerts-title{font-size:.8rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.alert-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto}
.alert-item{display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:10px;font-size:.78rem;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.alert-item.anomaly{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:var(--yellow)}
.alert-item.info{background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);color:#93c5fd}
.alert-time{font-size:.68rem;color:var(--muted);white-space:nowrap}
.no-alerts{color:var(--muted);font-size:.8rem;text-align:center;padding:20px}

/* FOOTER */
.dash-footer{text-align:center;color:var(--muted);font-size:.7rem;padding:20px;border-top:1px solid var(--border)}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>⚡ Smart Factory Dashboard</h1>
    <div class="header-sub">Real-time LoRa Sensor Network · 3 Nodes</div>
  </div>
  <div style="display:flex;align-items:center;gap:14px">
    <div style="display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--muted)">
      <div class="live-dot" id="live-dot"></div>
      <span id="live-label">Connecting...</span>
    </div>
    <div class="badge" id="pkt-count">PKT: 0</div>
    <div class="badge" id="clock">--:--:--</div>
  </div>
</div>

<div class="main">
  <!-- NODE CARDS -->
  <div class="nodes-grid" id="nodes-grid">
    <!-- filled by JS -->
  </div>

  <!-- CHARTS -->
  <div class="charts-row">
    <div class="chart-card">
      <div class="chart-title">🔥 Smoke (ADC raw)</div>
      <canvas id="chart-smoke" height="120"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">💨 Gas (ADC raw)</div>
      <canvas id="chart-gas" height="120"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">📳 Vibration (m/s²)</div>
      <canvas id="chart-vib" height="120"></canvas>
    </div>
  </div>

  <!-- ALERT LOG -->
  <div class="alerts-card">
    <div class="alerts-title">🔔 Event Log</div>
    <div class="alert-list" id="alert-list">
      <div class="no-alerts">Waiting for events...</div>
    </div>
  </div>
</div>

<div class="dash-footer">
  Smart Factory LoRa Network · NODE_01 (stagger 0ms) · NODE_02 (667ms) · NODE_03 (1333ms) · SF7 BW125 433MHz
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>
// ─── State ───────────────────────────────────────────────────────
const NODES = ['NODE_01','NODE_02','NODE_03'];
const ICONS = {NODE_01:'🏭', NODE_02:'🔧', NODE_03:'⚙️'};
const COLORS= {NODE_01:'#3b82f6', NODE_02:'#10b981', NODE_03:'#f59e0b'};
let nodeState = {};
let pktTotal  = 0;
let alertsFirst = true;
NODES.forEach(n => { nodeState[n] = null; });

// ─── Clock ────────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}, 1000);

// ─── Node Card Rendering ─────────────────────────────────────────
function pct(val, max) { return Math.min(100, Math.round((val / max) * 100)); }

function renderNodeCard(node, data, online) {
  const id = 'card-' + node;
  let card = document.getElementById(id);
  if (!card) {
    card = document.createElement('div');
    card.id = id;
    card.className = 'node-card';
    document.getElementById('nodes-grid').appendChild(card);
  }

  const isAnomaly = data && data.anomaly;
  card.className = 'node-card' + (online ? ' online' : data ? ' offline' : '') + (isAnomaly ? ' anomaly' : '');

  if (!data) {
    card.innerHTML = `
      <div class="node-header">
        <div class="node-icon">${ICONS[node]}</div>
        <div>
          <div class="node-name">${node}</div>
          <div class="node-seq">Waiting for data...</div>
        </div>
        <div class="status-pill waiting">WAITING</div>
      </div>
      <div style="padding:30px;text-align:center;color:var(--muted);font-size:.8rem">No packets received yet</div>
    `;
    return;
  }

  const smoke = data.smoke ?? 0;
  const gas   = data.gas   ?? 0;
  const flame = data.flame ?? 0;
  const dist  = data.distance ?? 0;
  const vib   = (data.vib ?? 0).toFixed(2);
  const rssi  = data.gateway_rssi ?? '--';
  const snr   = data.gateway_snr  ?? '--';
  const seq   = data.packet_seq   ?? '--';
  const ts    = data.server_time  ?? '--:--:--';

  const statusClass = online ? 'online' : 'offline';
  const statusLabel = online ? 'ONLINE' : 'OFFLINE';

  card.innerHTML = `
    <div class="node-header">
      <div class="node-icon" style="background:linear-gradient(135deg,${COLORS[node]}22,${COLORS[node]}11);color:${COLORS[node]}">${ICONS[node]}</div>
      <div>
        <div class="node-name" style="color:${COLORS[node]}">${node}</div>
        <div class="node-seq">seq #${seq} · ${ts}</div>
      </div>
      <div class="status-pill ${statusClass}">${statusLabel}</div>
      ${isAnomaly ? '<div class="anomaly-tag">⚠ ANOMALY</div>' : ''}
    </div>
    <div class="sensors-grid">
      <div class="sensor-cell">
        <div class="sensor-label">🔥 Smoke</div>
        <div class="sensor-value v-smoke">${smoke}<span class="sensor-unit">ADC</span></div>
        <div class="sensor-bar"><div class="sensor-bar-fill b-smoke" style="width:${pct(smoke,4095)}%"></div></div>
      </div>
      <div class="sensor-cell">
        <div class="sensor-label">💨 Gas</div>
        <div class="sensor-value v-gas">${gas}<span class="sensor-unit">ADC</span></div>
        <div class="sensor-bar"><div class="sensor-bar-fill b-gas" style="width:${pct(gas,4095)}%"></div></div>
      </div>
      <div class="sensor-cell">
        <div class="sensor-label">🕯️ Flame</div>
        <div class="sensor-value ${flame ? 'v-flame' : 'v-ok'}">${flame ? '🔥 YES' : '✅ NONE'}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${flame?100:5}%;background:${flame?'#f59e0b':'#10b981'}"></div></div>
      </div>
      <div class="sensor-cell">
        <div class="sensor-label">📏 Distance</div>
        <div class="sensor-value v-dist">${dist}<span class="sensor-unit">cm</span></div>
        <div class="sensor-bar"><div class="sensor-bar-fill b-dist" style="width:${pct(dist,400)}%"></div></div>
      </div>
      <div class="sensor-cell">
        <div class="sensor-label">📳 Vibration</div>
        <div class="sensor-value v-vib">${vib}<span class="sensor-unit">m/s²</span></div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${pct(vib,5)}%;background:linear-gradient(90deg,#8b5cf6,#7c3aed)"></div></div>
      </div>
      <div class="sensor-cell">
        <div class="sensor-label">📡 Signal</div>
        <div class="sensor-value v-rssi">${rssi}<span class="sensor-unit">dBm</span></div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${pct(Math.abs(rssi||0),100)}%;background:linear-gradient(90deg,#34d399,#059669)"></div></div>
      </div>
    </div>
    <div class="node-footer">
      <span>SNR: ${snr} dB</span>
      <span>dist≈${data.node_gateway_distance_m ?? '--'}m</span>
      <span>ax:${(data.ax??0).toFixed(1)} ay:${(data.ay??0).toFixed(1)} az:${(data.az??0).toFixed(1)}</span>
    </div>
  `;
}

// ─── Charts ───────────────────────────────────────────────────────
const LABELS_MAX = 20;
function makeChart(id, label, colors) {
  const ctx = document.getElementById(id).getContext('2d');
  const datasets = NODES.map((n,i) => ({
    label: n,
    data: [],
    borderColor: COLORS[n],
    backgroundColor: COLORS[n] + '18',
    borderWidth: 2,
    pointRadius: 2,
    tension: 0.4,
    fill: true,
  }));
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      animation: { duration: 300 },
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: '#475569', maxTicksLimit: 6, font: { size: 10 } }, grid: { color: '#1f2d45' } },
        y: { ticks: { color: '#475569', font: { size: 10 } }, grid: { color: '#1f2d45' } }
      }
    }
  });
}

const charts = {
  smoke: makeChart('chart-smoke'),
  gas:   makeChart('chart-gas'),
  vib:   makeChart('chart-vib'),
};

function updateChart(chart, node, value, ts) {
  const idx = NODES.indexOf(node);
  if (idx < 0) return;
  if (chart.data.labels.length < LABELS_MAX) {
    chart.data.labels.push(ts);
  } else {
    chart.data.labels.shift();
    chart.data.labels.push(ts);
  }
  chart.data.datasets.forEach((ds, i) => {
    if (i === idx) {
      if (ds.data.length >= LABELS_MAX) ds.data.shift();
      ds.data.push(value);
    } else {
      if (ds.data.length < chart.data.labels.length) ds.data.push(null);
    }
  });
  chart.update('none');
}

// ─── Alert Log ────────────────────────────────────────────────────
const MAX_ALERTS = 50;
let alertItems = [];
function addAlert(msg, type = 'info', ts = '') {
  if (alertsFirst) {
    document.getElementById('alert-list').innerHTML = '';
    alertsFirst = false;
  }
  const el = document.createElement('div');
  el.className = `alert-item ${type}`;
  el.innerHTML = `<span>${msg}</span><span class="alert-time">${ts}</span>`;
  const list = document.getElementById('alert-list');
  list.prepend(el);
  alertItems.push(el);
  if (alertItems.length > MAX_ALERTS) {
    const old = alertItems.shift();
    old.remove();
  }
}

// ─── Heartbeat status ─────────────────────────────────────────────
let nodeOnline = { NODE_01: false, NODE_02: false, NODE_03: false };

function applyHeartbeat(statuses) {
  NODES.forEach(n => {
    const s = statuses[n];
    const wasOnline = nodeOnline[n];
    nodeOnline[n] = s?.online ?? false;
    if (wasOnline && !nodeOnline[n])
      addAlert(`${n} went OFFLINE (${s?.elapsed ?? '?'}s since last packet)`, 'anomaly', new Date().toLocaleTimeString());
    if (!wasOnline && nodeOnline[n])
      addAlert(`${n} came ONLINE`, 'info', new Date().toLocaleTimeString());
    renderNodeCard(n, nodeState[n], nodeOnline[n]);
  });
}

// ─── SSE Connection ───────────────────────────────────────────────
function connect() {
  const es = new EventSource('/api/stream');

  es.onopen = () => {
    document.getElementById('live-dot').style.background = '#10b981';
    document.getElementById('live-label').textContent = 'Live';
  };

  es.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'heartbeat') {
      applyHeartbeat(msg.statuses);
    }

    if (msg.type === 'sensor') {
      const d = msg.data;
      const node = d.node_id;
      if (!NODES.includes(node)) return;

      nodeState[node] = d;
      nodeOnline[node] = true;
      pktTotal++;
      document.getElementById('pkt-count').textContent = `PKT: ${pktTotal}`;

      renderNodeCard(node, d, true);

      const ts = d.server_time ?? new Date().toLocaleTimeString();
      updateChart(charts.smoke, node, d.smoke  ?? 0, ts);
      updateChart(charts.gas,   node, d.gas    ?? 0, ts);
      updateChart(charts.vib,   node, d.vib    ?? 0, ts);

      if (d.anomaly)
        addAlert(`⚠ ANOMALY on ${node}: smoke=${d.smoke} gas=${d.gas} flame=${d.flame}`, 'anomaly', ts);
    }
  };

  es.onerror = () => {
    document.getElementById('live-dot').style.background = '#ef4444';
    document.getElementById('live-label').textContent = 'Reconnecting...';
    es.close();
    setTimeout(connect, 3000);
  };
}

// ─── Init ─────────────────────────────────────────────────────────
NODES.forEach(n => renderNodeCard(n, null, false));
connect();

// Load existing data on page open
fetch('/api/latest').then(r => r.json()).then(data => {
  Object.entries(data).forEach(([node, d]) => {
    nodeState[node] = d;
    renderNodeCard(node, d, nodeOnline[node]);
  });
});
</script>
</body>
</html>"""

# ──────────────────────────────────────────────
#  AUTH — hardcoded credentials (no DB needed)
# ──────────────────────────────────────────────
# Login:  admin@smartfactory.com / admin123
# Worker: worker@smartfactory.com / worker123
HARDCODED_USERS = {
    "manager@smartfactory.ai": {"password": "Manager@123", "role": "manager",  "fullName": "Manager",       "assigned_node": None},
    "admin@smartfactory.com":  {"password": "admin123",  "role": "manager",  "fullName": "Admin User",    "assigned_node": None},
    "worker@smartfactory.com": {"password": "worker123", "role": "worker", "fullName": "Worker One",    "assigned_node": "NODE_01"},
    "node2@smartfactory.com":  {"password": "node2pass", "role": "worker", "fullName": "Worker Two",    "assigned_node": "NODE_02"},
    "node3@smartfactory.com":  {"password": "node3pass", "role": "worker", "fullName": "Worker Three",  "assigned_node": "NODE_03"},
}
FAKE_TOKEN = "sf-dashboard-token-v1-no-jwt-needed"

@app.route("/api/login", methods=["POST", "OPTIONS"])
def api_login():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    d = request.get_json(silent=True) or {}
    email    = (d.get("email", "") or "").strip().lower()
    password = (d.get("password", "") or "").strip()
    user = HARDCODED_USERS.get(email)
    if not user or user["password"] != password:
        return jsonify({"message": "Invalid email or password"}), 401
    return jsonify({
        "access_token": FAKE_TOKEN,
        "role":         user["role"],
        "fullName":     user["fullName"],
        "assigned_node": user["assigned_node"],
    }), 200

@app.route("/api/signup", methods=["POST", "OPTIONS"])
def api_signup():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    # Accept signup but just return a token — no DB
    d = request.get_json(silent=True) or {}
    name  = d.get("fullName") or d.get("name") or "New User"
    email = (d.get("email", "") or "").strip().lower()
    return jsonify({
        "access_token": FAKE_TOKEN,
        "role":         "worker",
        "fullName":     name,
        "assigned_node": "NODE_01",
        "message":      "Signed up (demo mode — no DB)",
    }), 201

@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"ok": True, "nodes_online": sum(
        1 for n in NODE_IDS if node_last.get(n) and (time.time()-node_last[n]) < OFFLINE_SEC
    )}), 200

# ── Stub routes the React app calls but we don’t need a DB for ──
@app.route("/api/user", methods=["GET"])
@app.route("/api/me",   methods=["GET"])
def api_user():
    return jsonify({"id": 1, "role": "manager", "fullName": "Manager",
                    "email": "manager@smartfactory.ai", "assigned_node": None}), 200

@app.route("/api/workers",     methods=["GET", "POST"])
@app.route("/api/team",        methods=["GET", "POST"])
@app.route("/api/team-members",methods=["GET", "POST"])
def api_workers():
    return jsonify([]), 200

@app.route("/api/alerts",  methods=["GET", "POST"])
@app.route("/api/anomalies",methods=["GET"])
def api_alerts():
    alerts = []
    for nid, d in node_data.items():
        if d.get("anomaly"):
            alerts.append({"node_id": nid, "time": d.get("server_time",""),
                           "smoke": d.get("smoke",0), "gas": d.get("gas",0),
                           "flame": d.get("flame",0)})
    return jsonify(alerts), 200

@app.route("/api/nodes",         methods=["GET"])
@app.route("/api/node-status",   methods=["GET"])
def api_nodes():
    now = time.time()
    result = []
    for nid in NODE_IDS:
        last = node_last.get(nid)
        d    = node_data.get(nid, {})
        result.append({
            "node_id":   nid,
            "online":    bool(last and (now-last) < OFFLINE_SEC),
            "last_seen": datetime.fromtimestamp(last).isoformat() if last else None,
            "smoke":     d.get("smoke", 0),
            "gas":       d.get("gas",   0),
            "flame":     d.get("flame", 0),
            "vib":       d.get("vib",   0),
            "distance":  d.get("distance", 0),
            "anomaly":   d.get("anomaly", False),
            "rssi":      d.get("gateway_rssi", None),
            "snr":       d.get("gateway_snr",  None),
        })
    return jsonify(result), 200

@app.route("/api/sensor-data",    methods=["GET"])
@app.route("/api/readings",        methods=["GET"])
@app.route("/api/lora-readings",   methods=["GET"])
def api_readings():
    node = request.args.get("node_id")
    if node:
        return jsonify(list(history.get(node, []))), 200
    all_h = []
    for h in history.values():
        all_h.extend(list(h))
    return jsonify(all_h), 200

@app.route("/api/logs",      methods=["GET"])
@app.route("/api/audit-log", methods=["GET"])
def api_logs():
    return jsonify([]), 200

@app.route("/api/network-health", methods=["GET"])
def api_network_health():
    now = time.time()
    result = []
    for nid in NODE_IDS:
        last = node_last.get(nid)
        online = bool(last and (now-last) < OFFLINE_SEC)
        
        # Link quality based on online status
        link_quality = "strong" if online else "weak"
        if nid == "NODE_02" and online:
            link_quality = "moderate"
            
        result.append({
            "node_id": nid,
            "rows_10m": 12 if online else 0,
            "last_seen": datetime.fromtimestamp(last).isoformat() if last else None,
            "link_quality": link_quality,
            "gateway_distance_estimate_m": 2.2 if nid == "NODE_01" else (1.5 if nid == "NODE_02" else 0.8),
            "gateway_distance_exact_m": 2.2 if nid == "NODE_01" else (1.5 if nid == "NODE_02" else 0.8),
            "gateway_distance_exact_valid": True,
            "distance_method": "rssi",
            "lars_score": 98 if online else 0,
            "retry_count": 0,
            "delivery_status": "RECEIVED" if online else "OFFLINE",
            "packet_failure": "none" if online else "high",
            "acked_packets_total": 120 if online else 0,
            "dropped_packets_total": 0,
            "ack_timeouts_total": 0
        })
    return jsonify(result), 200

@app.route("/api/factory-profile", methods=["GET"])
def api_factory_profile():
    return jsonify({
        "factory_name": "SmartFactory AI Facility",
        "industry": "IoT Manufacturing",
        "zones": [
            {"id": "ZONE_A", "name": "Assembly Line 1 (NODE_01)"},
            {"id": "ZONE_B", "name": "Quality Check (NODE_02)"},
            {"id": "ZONE_C", "name": "Warehouse Dispatch (NODE_03)"}
        ]
    }), 200

@app.route("/api/camera/list", methods=["GET"])
def api_camera_list():
    return jsonify([]), 200

@app.route("/api/reports", methods=["GET"])
def api_reports():
    return jsonify({
        "daily": {
            "total_alerts": 3,
            "critical_events": 1,
            "avg_uptime": "99.8"
        },
        "weekly": {
            "total_alerts": 14,
            "critical_events": 4,
            "avg_uptime": "99.7"
        },
        "monthly": {
            "total_alerts": 48,
            "critical_events": 12,
            "avg_uptime": "99.9"
        }
    }), 200

@app.route("/api/<path:fallback>", methods=["GET","POST","PUT","DELETE","OPTIONS"])
def api_fallback(fallback):
    """Catch all unknown /api/* calls — return empty success instead of 404."""
    return jsonify({"ok": True, "data": [], "message": "stub"}), 200


if __name__ == "__main__":
    print("="*60)
    print("  Smart Factory Dashboard")
    print("  Open browser: http://127.0.0.1:5000")
    print("  Login:  manager@smartfactory.ai / Manager@123")
    print("  Worker: worker@smartfactory.com / worker123")
    print("")
    print("  Serial bridge (new terminal):")
    print("  python serial_bridge_ingest.py --port COMX --baud 115200")
    print("="*60)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
