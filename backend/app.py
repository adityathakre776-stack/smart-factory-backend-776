from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from flask_mysqldb import MySQL
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    jwt_required,
    get_jwt_identity,
    get_jwt,
)
from config import Config
from zoneinfo import ZoneInfo

import os, uuid, datetime, re, json, hashlib, queue, threading, time
import ml_model  # Isolation Forest anomaly detection

app = Flask(__name__)
app.config.from_object(Config)
latest_gateway_meta = {}

# ─────────────────────── SSE REGISTRY ───────────────────────────
# Thread-safe set of per-client queues. Each connected browser gets its own.
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()

NODE_IDS = ["NODE_01", "NODE_02", "NODE_03"]
NODE_OFFLINE_THRESHOLD_SEC = 60
_node_last_seen: dict[str, float] = {}   # node_id -> epoch seconds

# ─────────────────── ADAPTIVE SF RANKING ENGINE ──────────────────────────────
# Tracks the latest gateway_rssi for each node.
# On every packet: re-rank all ONLINE nodes by RSSI strength.
# Best signal (highest / least-negative RSSI) = shortest distance = SF5
# Middle signal                               = medium distance   = SF7
# Worst  signal (lowest / most-negative RSSI) = longest distance  = SF12
# When only 1-2 nodes are online, ranks still work correctly.

# SF values to assign per rank slot (index 0 = shortest distance)
_SF_BY_RANK = [5, 7, 12]   # rank0→SF5 (Short), rank1→SF7 (Medium), rank2→SF12 (Longest)
# Label descriptions per rank
_RANK_LABELS = ["Short", "Medium", "Longest"]

# Per-node live RSSI tracking
_node_rssi: dict[str, float] = {}      # node_id -> latest gateway_rssi
_node_rssi_ts: dict[str, float] = {}   # node_id -> last update epoch
_node_sf_rank: dict[str, dict] = {}    # node_id -> {sf, rank, label, rssi}
_sf_lock = threading.Lock()

RSSI_STALE_SEC = 90   # treat node as offline for ranking if no packet for 90s


def _compute_sf_ranks() -> dict:
    """
    Re-rank all nodes whose RSSI was updated within RSSI_STALE_SEC seconds.
    Returns mapping: node_id -> {sf, rank, distance_rank_label, rssi}
    Sorted so rank 0 = closest (strongest RSSI), rank N-1 = farthest.
    """
    now = time.time()
    # Collect fresh RSSI readings
    fresh = {
        nid: rssi
        for nid, rssi in _node_rssi.items()
        if (now - _node_rssi_ts.get(nid, 0)) < RSSI_STALE_SEC
    }
    if not fresh:
        return {}

    # Sort descending: highest RSSI (e.g. -45) first = closest to gateway
    ranked = sorted(fresh.items(), key=lambda x: x[1], reverse=True)

    result = {}
    for rank_idx, (nid, rssi) in enumerate(ranked):
        sf = _SF_BY_RANK[rank_idx] if rank_idx < len(_SF_BY_RANK) else _SF_BY_RANK[-1]
        label = _RANK_LABELS[rank_idx] if rank_idx < len(_RANK_LABELS) else "Farthest"
        result[nid] = {
            "sf":                sf,
            "rank":              rank_idx,
            "distance_rank_label": label,
            "rssi":              rssi,
        }
    return result


def _update_sf_for_node(node_id: str, rssi: float) -> dict:
    """
    Update RSSI for this node, recompute ranks for ALL nodes, persist result.
    Returns the rank info for the current node.
    """
    global _node_sf_rank
    with _sf_lock:
        _node_rssi[node_id] = rssi
        _node_rssi_ts[node_id] = time.time()
        _node_sf_rank = _compute_sf_ranks()
        return _node_sf_rank.get(node_id, {"sf": 7, "rank": 0, "distance_rank_label": "Unknown", "rssi": rssi})

_flame_status: dict = {}       # node_id -> {"on": bool, "ts": float}
_last_auto_call_time: float = 0.0
AUTO_CALL_SETTINGS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auto_call_settings.json")


def normalize_phone_number(phone: str) -> str:
    cleaned = str(phone).strip()
    cleaned = re.sub(r'[\s\-()]+', '', cleaned)
    if cleaned and not cleaned.startswith("+"):
        if len(cleaned) == 10 and cleaned.isdigit():
            cleaned = "+91" + cleaned
        elif len(cleaned) == 12 and cleaned.startswith("91") and cleaned.isdigit():
            cleaned = "+" + cleaned
    return cleaned


def _load_auto_call_settings() -> dict:
    defaults = {
        "enabled": False,
        "phones": ["+918149407616"],
        "cooldown_sec": 300,
        "trigger_all_nodes": True,
    }
    try:
        if os.path.exists(AUTO_CALL_SETTINGS_FILE):
            with open(AUTO_CALL_SETTINGS_FILE, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
                defaults.update(saved)
    except Exception:
        pass
    defaults["phones"] = [normalize_phone_number(p) for p in defaults["phones"] if p]
    return defaults


def _save_auto_call_settings(settings: dict) -> None:
    try:
        with open(AUTO_CALL_SETTINGS_FILE, "w", encoding="utf-8") as fh:
            json.dump(settings, fh, indent=2)
    except Exception:
        pass


def _auto_call_phones_bg(phones: list, caller_name: str, message: str) -> None:
    """Background thread: call every phone in the list via Twilio."""
    try:
        from twilio.rest import Client as TwilioClient
        account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "")
        from_number = os.getenv("TWILIO_FROM_NUMBER", "")
        if not all([account_sid, auth_token, from_number, phones]):
            return
        client = TwilioClient(account_sid, auth_token)
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">
    URGENT FACTORY ALERT. Flame detected on ALL nodes simultaneously.
    {message}
    Please check your Smart Factory dashboard immediately.
  </Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">This is an automated emergency alert. Goodbye.</Say>
</Response>"""
        for phone in phones:
            try:
                target_phone = normalize_phone_number(phone)
                client.calls.create(to=target_phone, from_=from_number, twiml=twiml)
            except Exception:
                pass
    except Exception:
        pass


def _sse_broadcast(payload: dict) -> None:
    """Push a JSON payload to all connected SSE clients."""
    msg = f"data: {json.dumps(payload)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


def _node_status_event() -> dict:
    """Build a node-status dict for the heartbeat event."""
    now = time.time()
    statuses = {}
    for node in NODE_IDS:
        last = _node_last_seen.get(node)
        if last is None:
            statuses[node] = {"online": False, "last_seen": None, "elapsed_sec": None}
        else:
            elapsed = now - last
            statuses[node] = {
                "online": elapsed < NODE_OFFLINE_THRESHOLD_SEC,
                "last_seen": datetime.datetime.fromtimestamp(last).isoformat(),
                "elapsed_sec": round(elapsed, 1),
            }
    return {"type": "node_status", "statuses": statuses}


def _sse_heartbeat_thread():
    """Sends a heartbeat+node_status event every 10 seconds to keep connections alive."""
    while True:
        time.sleep(10)
        try:
            _sse_broadcast(_node_status_event())
        except Exception:
            pass


def _normalize_jwt_secret(secret: str) -> str:
    """
    PyJWT / RFC 7518 recommend HS256 keys >= 32 bytes. Short strings (e.g. 17-char .env
    values) trigger InsecureKeyLengthWarning and can cause verify failures → 422 on every
    protected route. Stretch deterministically so the same .env always maps to the same key.
    """
    if not secret:
        secret = "dev-only-set-JWT_SECRET_KEY-in-backend-.env"
    raw = secret.encode("utf-8")
    if len(raw) >= 32:
        return secret
    return hashlib.sha256(raw).hexdigest()


# Flask-JWT-Extended requires a non-empty secret.
_secret = app.config.get("JWT_SECRET_KEY") or os.getenv("JWT_SECRET_KEY") or ""
app.config["JWT_SECRET_KEY"] = _normalize_jwt_secret(_secret)
app.config["JWT_ALGORITHM"] = "HS256"


def current_jwt_identity():
    """
    Build a consistent identity dict for routes.
    Prefer tokens issued with string `sub` + `additional_claims` (role, assigned_node).
    Legacy tokens may still use dict / JSON string in `sub`.
    """
    ident = get_jwt_identity()
    claims = get_jwt()
    if isinstance(ident, dict):
        return ident
    if ident is not None and claims.get("role") is not None:
        try:
            uid_int = int(ident)
        except (TypeError, ValueError):
            uid_int = ident
        an = claims.get("assigned_node")
        return {
            "id": uid_int,
            "role": claims.get("role"),
            "assigned_node": an if an else None,
        }
    if isinstance(ident, str):
        try:
            return json.loads(ident)
        except json.JSONDecodeError:
            return {}
    return {}


# Explicit CORS: browsers must be allowed to send Authorization on cross-origin requests
CORS(
    app,
    origins="*",
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Authorization"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)

mysql = MySQL(app)
jwt = JWTManager(app)

# Start SSE heartbeat daemon
_hb = threading.Thread(target=_sse_heartbeat_thread, daemon=True)
_hb.start()


@app.route("/")
@app.route("/api")
@app.route("/api/")
def api_index():
    return jsonify({
        "ok": True,
        "message": "Smart Factory IoT Backend API is running successfully!",
        "version": "1.0.0",
        "endpoints": {
            "health": "/api/health",
            "stream": "/api/stream",
            "login": "/api/login",
            "signup": "/api/signup"
        }
    }), 200


# ─────────────────────── SSE STREAM ENDPOINT ─────────────────────────
@app.route("/api/stream")
def sse_stream():
    """
    Server-Sent Events endpoint. Dashboard connects here via EventSource.
    Delivers real-time sensor packets as they arrive.
    No JWT required — use a query param ?token=... if you want auth.
    CORS is handled by Flask-CORS for all /api/* routes.
    """
    client_q: queue.Queue = queue.Queue(maxsize=50)
    with _sse_lock:
        _sse_clients.append(client_q)

    def generate():
        # Send current node status immediately on connect
        try:
            yield f"data: {json.dumps(_node_status_event())}\n\n"
        except Exception:
            pass

        try:
            while True:
                try:
                    msg = client_q.get(timeout=15)
                    yield msg
                except queue.Empty:
                    # SSE retry directive + keepalive comment
                    yield "retry: 3000\n"
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if client_q in _sse_clients:
                    _sse_clients.remove(client_q)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return Response(stream_with_context(generate()), headers=headers)


# ─────────────────────── SSE PUSH (internal, from serial bridge) ───────
@app.route("/api/stream/push", methods=["POST"])
def sse_push():
    """
    Internal endpoint: serial_bridge_ingest.py POSTs here to push events
    to all connected SSE clients instantly (no DB write — just fan-out).
    """
    payload = request.json
    if not payload:
        return jsonify({"error": "empty payload"}), 400

    node_id = payload.get("node_id")
    if node_id:
        _node_last_seen[node_id] = time.time()

    payload["type"] = "sensor_data"
    _sse_broadcast(payload)
    return jsonify({"pushed": True, "clients": len(_sse_clients)}), 200


@app.route("/api/health", methods=["GET"])
def health():
    # Simple unauthenticated health check for ESP32 gateway failover.
    return jsonify({"ok": True}), 200


@jwt.invalid_token_loader
def _invalid_token_callback(err):
    return jsonify({"msg": "Invalid or expired token", "detail": str(err)}), 422


@jwt.unauthorized_loader
def _missing_token_callback(err):
    return jsonify({"msg": "Authorization header missing or bad", "detail": str(err)}), 401

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def isoformat_server_datetime(value):
    """
    MySQL DATETIME is naive. Attach APP_TIMEZONE (default Asia/Kolkata) so JSON uses
    ISO-8601 with offset; browsers then show correct local time on charts.
    Set APP_TIMEZONE=UTC in .env if your database stores UTC.
    """
    if value is None:
        return None
    if not isinstance(value, datetime.datetime):
        return value
    tz_name = os.getenv("APP_TIMEZONE") or getattr(Config, "APP_TIMEZONE", "Asia/Kolkata")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        return value.isoformat(sep="T", timespec="seconds")
    if value.tzinfo is None:
        value = value.replace(tzinfo=tz)
    return value.isoformat(timespec="seconds")


def as_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def as_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def as_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return False


def infer_assigned_node(email: str, full_name: str = ""):
    """
    Infer worker->node binding from user identity without DB schema change.
    Supports patterns like:
    - worker1@... / worker_2@...
    - node01@... / node-3@...
    - Full name containing worker 1/2/3
    """
    text = f"{email or ''} {full_name or ''}".lower()

    patterns = [
        r"worker[\s_\-]*([1-3])",
        r"node[\s_\-]*0?([1-3])",
        r"\b([1-3])\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            idx = int(match.group(1))
            return f"NODE_0{idx}"
    return None

# ───────────────── SIGNUP ─────────────────
@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.json
    company = data.get("companyName")
    name = data.get("fullName")
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")

    if not all([company, name, email, password]):
        return jsonify({"message": "Missing fields"}), 400

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
    if cursor.fetchone():
        cursor.close()
        return jsonify({"message": "Email exists"}), 409

    pwd = generate_password_hash(password)
    cursor.execute("""
        INSERT INTO users (company_name, full_name, email, password_hash, role)
        VALUES (%s,%s,%s,%s,'worker')
    """, (company, name, email, pwd))
    mysql.connection.commit()
    cursor.close()
    return jsonify({"message": "Signup success", "role": "worker"}), 201


# ───────────────── LOGIN ─────────────────
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")

    cursor = mysql.connection.cursor()
    row = None
    try:
        cursor.execute(
            "SELECT id, full_name, password_hash, role, assigned_node FROM users WHERE email=%s",
            (email,)
        )
        row = cursor.fetchone()
    except Exception:
        # Backward compatibility if assigned_node column is not yet migrated.
        cursor.execute(
            "SELECT id, full_name, password_hash, role FROM users WHERE email=%s",
            (email,)
        )
        fallback = cursor.fetchone()
        if fallback:
            row = (*fallback, None)
    finally:
        cursor.close()

    if not row:
        return jsonify({"message": "Invalid credentials"}), 401

    user_id, full_name, password_hash, role, assigned_node_db = row

    if not check_password_hash(password_hash, password):
        return jsonify({"message": "Invalid credentials"}), 401

    assigned_node = assigned_node_db if role == "worker" else None
    if role == "worker" and not assigned_node:
        assigned_node = infer_assigned_node(email, full_name)

    # String sub + additional_claims (avoids dict-in-JWT quirks across PyJWT / F-JWT versions)
    uid = int(user_id) if user_id is not None else None
    token = create_access_token(
        identity=str(uid),
        additional_claims={
            "role": role,
            "assigned_node": assigned_node or "",
        },
    )

    return jsonify({
        "access_token": token,
        "role": role,
        "fullName": full_name,
        "assigned_node": assigned_node
    }), 200


# ───────────────── SENSOR DATA INGEST ─────────────────
@app.route("/api/data", methods=["POST"])
def ingest_sensor():
    data = request.json
    if not data:
        return jsonify({"error": "Invalid payload"}), 400

    # Accept both normalized gateway payload and raw node payload keys.
    gateway_id = data.get("gateway_id") or data.get("gateway") or "GATEWAY_01"
    node_id = data.get("node_id")
    vib = data.get("vib", data.get("vib_magnitude", 0))
    flame = data.get("flame", 0)
    smoke = data.get("smoke", data.get("smoke_ppm", data.get("smoke_raw", 0)))
    gas = data.get("gas", data.get("gas_ppm", data.get("gas_raw", 0)))
    distance = data.get("distance", data.get("object_distance_cm", 0))
    anomaly = data.get("anomaly", data.get("anomaly_edge", False))
    msg_id = data.get("msg_id")
    packet_seq = as_int(data.get("packet_seq"), 0)
    retry_count = as_int(data.get("retry_count"), 0)
    delivery_status = data.get("delivery_status") or ("ACKED" if as_bool(data.get("acked")) else "RECEIVED")
    gateway_rssi = as_float(data.get("gateway_rssi"), 0.0)
    gateway_snr = as_float(data.get("gateway_snr"), 0.0)
    gateway_distance_estimate_m = as_float(
        data.get("node_gateway_distance_m", data.get("gateway_distance_estimate_m")),
        0.0,
    )
    gateway_distance_exact_m = as_float(data.get("gateway_distance_exact_m"), -1.0)
    gateway_distance_exact_valid = 1 if as_bool(data.get("gateway_distance_exact_valid")) else 0
    distance_method = data.get("distance_method") or "radio_estimate_only"
    lars_score = as_int(data.get("lars_score"), 0)
    acked = 1 if as_bool(data.get("acked")) else 0
    message_duplicate = 1 if as_bool(data.get("message_duplicate")) else 0
    gateway_ack_sent = 1 if as_bool(data.get("gateway_ack_sent")) else 0
    acked_packets_total = as_int(data.get("acked_packets_total"), 0)
    dropped_packets_total = as_int(data.get("dropped_packets_total"), 0)
    ack_timeouts_total = as_int(data.get("ack_timeouts_total"), 0)
    tx_attempts_total = as_int(data.get("tx_attempts_total"), 0)

    if not node_id:
        return jsonify({"error": "node_id missing"}), 400

    # Backward-compatible storage:
    # persist legacy columns in MySQL, and return all reliability metadata to the client.
    # If msg_id duplicates are resent from serial-bridge or gateway retry, skip DB insert.
    # Update node last-seen for SSE status
    _node_last_seen[node_id] = time.time()

    latest_gateway_meta[node_id] = {
        "msg_id": msg_id,
        "packet_seq": packet_seq,
        "retry_count": retry_count,
        "delivery_status": delivery_status,
        "gateway_rssi": gateway_rssi,
        "gateway_snr": gateway_snr,
        "gateway_distance_estimate_m": gateway_distance_estimate_m,
        "gateway_distance_exact_m": gateway_distance_exact_m,
        "gateway_distance_exact_valid": bool(gateway_distance_exact_valid),
        "distance_method": distance_method,
        "lars_score": lars_score,
        "acked": bool(acked),
        "message_duplicate": bool(message_duplicate),
        "gateway_ack_sent": bool(gateway_ack_sent),
        "acked_packets_total": acked_packets_total,
        "dropped_packets_total": dropped_packets_total,
        "ack_timeouts_total": ack_timeouts_total,
        "tx_attempts_total": tx_attempts_total,
    }

    cursor = mysql.connection.cursor()
    try:
        if msg_id:
            try:
                cursor.execute(
                    """
                    SELECT id FROM sensor_data
                    WHERE node_id=%s AND gateway_id=%s AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
                    ORDER BY id DESC
                    LIMIT 200
                    """,
                    (node_id, gateway_id),
                )
                recent_rows = cursor.fetchall()
                if recent_rows and message_duplicate:
                    return jsonify({"status": "duplicate_skipped", "msg_id": msg_id}), 200
            except Exception:
                pass

        # Optional extended columns (from migration)
        lat       = as_float(data.get("lat"), None)
        lon       = as_float(data.get("lon"), None)
        ax        = as_float(data.get("ax"), 0.0)
        ay        = as_float(data.get("ay"), 0.0)
        az        = as_float(data.get("az"), 0.0)
        comm_stat = "ACKED" if as_bool(data.get("gateway_ack_sent")) else "RECEIVED"
        gw_rssi   = gateway_rssi
        gw_snr    = gateway_snr
        pkt_seq   = packet_seq
        rc_col    = retry_count

        try:
            cursor.execute("""
                INSERT INTO sensor_data
                (gateway_id,node_id,vib,flame,smoke,gas,distance,anomaly,
                 packet_seq,lat,lon,ax,ay,az,comm_status,gateway_rssi,gateway_snr,retry_count_col)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                gateway_id, node_id, vib, flame, smoke, gas, distance, 1 if anomaly else 0,
                pkt_seq, lat, lon, ax, ay, az, comm_stat, gw_rssi, gw_snr, rc_col
            ))
        except Exception:
            # Fallback to original columns if migration not yet run
            cursor.execute("""
                INSERT INTO sensor_data
                (gateway_id,node_id,vib,flame,smoke,gas,distance,anomaly)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                gateway_id, node_id, vib, flame, smoke, gas, distance, 1 if anomaly else 0
            ))
        mysql.connection.commit()

        # ── ADAPTIVE SF RANKING (Real, based on live RSSI) ───────────────────────
        # Update this node's RSSI and recompute ranks for ALL nodes
        sf_info = _update_sf_for_node(node_id, float(gateway_rssi))

        # Broadcast to SSE clients immediately
        sse_payload = {
            "type":        "sensor_data",
            "gateway_id":  gateway_id,
            "node_id":     node_id,
            "seq":         packet_seq,
            "smoke":       int(smoke) if smoke else 0,
            "gas":         int(gas)   if gas   else 0,
            "flame":       int(flame),
            "distance":    float(distance) if distance else 0.0,
            "vib":         float(vib),
            "ax":          float(ax), "ay": float(ay), "az": float(az),
            "lat":         float(lat) if lat is not None else 0.0,
            "lon":         float(lon) if lon is not None else 0.0,
            "anomaly":     bool(anomaly),
            "gateway_rssi": float(gateway_rssi),
            "gateway_snr":  float(gateway_snr),
            "gateway_distance_estimate_m": float(gateway_distance_estimate_m),
            "lars_score":   int(lars_score),
            "retry_count":  int(retry_count),
            "delivery_status": str(delivery_status),
            "acked":        bool(acked),
            "created_at":   isoformat_server_datetime(datetime.datetime.now()),
            # ─ Real adaptive SF (from RSSI rank) ─
            "adaptive_sf":          sf_info.get("sf", 7),
            "distance_rank":        sf_info.get("rank", 0),
            "distance_rank_label":  sf_info.get("distance_rank_label", "Unknown"),
        }
        _sse_broadcast(sse_payload)

        # Broadcast full SF ranking for ALL nodes so every card updates at once
        with _sf_lock:
            full_sf_snapshot = dict(_node_sf_rank)
        _sse_broadcast({
            "type":    "sf_rank_update",
            "ranks":   full_sf_snapshot,
            "updated_at": isoformat_server_datetime(datetime.datetime.now()),
        })


        # ── ML ANOMALY SCORING (Isolation Forest) ──────────────────────
        ml_result = ml_model.score_packet(
            node_id=node_id,
            smoke=float(smoke or 0),
            gas=float(gas or 0),
            vib=float(vib or 0),
            distance=float(distance or 0),
            flame=float(flame or 0),
            rssi=float(gateway_rssi or 0),
            snr=float(gateway_snr or 0),
            timestamp=isoformat_server_datetime(datetime.datetime.now()),
        )
        # Broadcast ML result via SSE so dashboard updates instantly
        if ml_result.get("model_ready"):
            _sse_broadcast({
                "type":           "ml_score",
                "node_id":        node_id,
                "ml_anomaly":     ml_result["ml_anomaly"],
                "ml_label":       ml_result["ml_label"],
                "ml_confidence":  ml_result["ml_confidence"],
                "ml_reason":      ml_result["ml_reason"],
                "ml_score":       ml_result["ml_score"],
                "created_at":     isoformat_server_datetime(datetime.datetime.now()),
            })

        # ── PERSIST ML + SF + LATENCY INTO DB (last inserted row) ───────────────
        # Air-time per SF (100-byte packet, 125 kHz BW) + ~30ms processing overhead
        _SF_AIRTIME_MS_LOCAL = {5: 28, 6: 38, 7: 56, 8: 102, 9: 185, 10: 370, 11: 740, 12: 1480}
        computed_sf      = sf_info.get("sf", 7)
        computed_latency = _SF_AIRTIME_MS_LOCAL.get(computed_sf, 56) + 30   # air-time + MCU overhead
        computed_rank    = sf_info.get("rank", 0)

        try:
            with mysql.connection.cursor() as upd:
                upd.execute("""
                    UPDATE sensor_data
                    SET ml_label      = %s,
                        ml_confidence = %s,
                        ml_score      = %s,
                        ml_reason     = %s,
                        adaptive_sf   = %s,
                        distance_rank = %s,
                        latency_ms    = %s,
                        acked         = 1,
                        pdr_local     = 100.0
                    WHERE node_id = %s
                    ORDER BY id DESC LIMIT 1
                """, (
                    ml_result.get("ml_label", "MODEL_NOT_READY"),
                    float(ml_result.get("ml_confidence", 0)),
                    float(ml_result.get("ml_score", 0)),
                    ml_result.get("ml_reason", ""),
                    int(computed_sf),
                    int(computed_rank),
                    float(computed_latency),
                    node_id,
                ))
            mysql.connection.commit()
        except Exception as e:
            pass  # Non-critical — don't break packet ingestion if update fails

        # Trigger background retrain check
        ml_model.maybe_retrain(_fetch_training_rows)

        # ── AUTO-CALL CHECK: flame on ALL nodes simultaneously ──────────────────
        global _last_auto_call_time
        _flame_status[node_id] = {"on": bool(as_bool(flame)), "ts": time.time()}

        acs = _load_auto_call_settings()
        if acs.get("enabled"):
            now_t = time.time()
            cooldown = float(acs.get("cooldown_sec", 300))
            # ANY node reporting flame=True within last 90 seconds triggers call
            flame_nodes = [
                n for n in NODE_IDS
                if _flame_status.get(n, {}).get("on", False)
                and (now_t - _flame_status.get(n, {}).get("ts", 0)) < 90
            ]
            if flame_nodes and (now_t - _last_auto_call_time) > cooldown:
                _last_auto_call_time = now_t
                phones = acs.get("phones", [])
                node_list = ", ".join(flame_nodes)
                threading.Thread(
                    target=_auto_call_phones_bg,
                    args=(phones, "Smart Factory AI", f"Flame detected on {node_list}. Immediate attention required."),
                    daemon=True,
                ).start()
                # Also broadcast SSE alert
                _sse_broadcast({"type": "auto_call_triggered", "nodes": flame_nodes, "phones": phones})


        return jsonify({
            "status": "stored",
            "msg_id": msg_id,
            "packet_seq": packet_seq,
            "retry_count": retry_count,
            "ml_anomaly":    ml_result.get("ml_anomaly", False),
            "ml_label":      ml_result.get("ml_label", "MODEL_NOT_READY"),
            "ml_confidence": ml_result.get("ml_confidence", 0.0),
            "ml_reason":     ml_result.get("ml_reason", ""),
            "delivery_status": delivery_status,
            "gateway_rssi": gateway_rssi,
            "gateway_snr": gateway_snr,
            "gateway_distance_estimate_m": gateway_distance_estimate_m,
            "gateway_distance_exact_m": gateway_distance_exact_m,
            "gateway_distance_exact_valid": bool(gateway_distance_exact_valid),
            "distance_method": distance_method,
            "lars_score": lars_score,
            "acked": bool(acked),
            "message_duplicate": bool(message_duplicate),
            "gateway_ack_sent": bool(gateway_ack_sent),
            "acked_packets_total": acked_packets_total,
            "dropped_packets_total": dropped_packets_total,
            "ack_timeouts_total": ack_timeouts_total,
            "tx_attempts_total": tx_attempts_total,
        }), 201
    except Exception as exc:
        mysql.connection.rollback()
        return jsonify({"error": "db_insert_failed", "details": str(exc)}), 500
    finally:
        cursor.close()


@app.route("/api/factory-profile")
@jwt_required()
def factory_profile():
    return jsonify({
        "factory_name": "ApexChem Blending Works",
        "industry": "Small Chemical Blending Plant",
        "zones": [
            {"id": "ZONE_1", "name": "Solvent Mixing Bay"},
            {"id": "ZONE_2", "name": "Drum Filling Conveyor"},
            {"id": "ZONE_3", "name": "Storage & Dispatch"},
        ],
        "safety_focus": [
            "Flammable vapor build-up",
            "Localized open flame risks",
            "Proximity hazards around moving drums",
        ],
    })


# ───────────────── SENSOR DATA FETCH ─────────────────
@app.route("/api/sensor-data")
@jwt_required()
def sensor_data():
    """
    Historical sensor data for dashboards (manager & worker).
    Supports optional ?hours=1 or ?hours=24 for time-range filter.
    Returns ALL fields the HistoricalAnalysis frontend component needs.
    """
    identity = current_jwt_identity()
    role = identity.get("role")

    # Optional time-range filter from frontend (e.g. ?hours=1 or ?hours=24)
    try:
        hours = int(request.args.get("hours", 0))
    except (TypeError, ValueError):
        hours = 0

    # Larger limit for 24-hour view; manager sees full history
    if role == "manager":
        limit = 2000 if hours >= 24 else 500
    else:
        limit = 500 if hours >= 24 else 200

    cursor = mysql.connection.cursor()

    # Build the extended SELECT — use COALESCE for optional columns added by migration
    base_select = """
        SELECT
            gateway_id, node_id,
            vib       AS vib_magnitude,
            flame,
            smoke     AS smoke_raw,
            gas       AS gas_raw,
            distance,
            anomaly   AS anomaly_edge,
            COALESCE(gateway_rssi, 0)              AS gateway_rssi,
            COALESCE(gateway_snr,  0)              AS gateway_snr,
            COALESCE(packet_seq,   0)              AS packet_seq,
            COALESCE(retry_count_col, 0)           AS retry_count,
            COALESCE(comm_status, 'STORED')        AS delivery_status,
            COALESCE(ml_label, '')                 AS ml_label,
            COALESCE(ml_confidence, 0)             AS ml_confidence,
            COALESCE(ml_score, 0)                  AS lars_score,
            COALESCE(adaptive_sf, 7)               AS adaptive_sf,
            COALESCE(distance_rank, 0)             AS distance_rank,
            COALESCE(latency_ms, 0)                AS latency_ms,
            COALESCE(ax, 0) AS ax,
            COALESCE(ay, 0) AS ay,
            COALESCE(az, 0) AS az,
            COALESCE(lat, 0) AS lat,
            COALESCE(lon, 0) AS lon,
            created_at
        FROM sensor_data
    """

    where_clauses = []
    params = []

    # Server-side time filter
    if hours > 0:
        where_clauses.append("created_at >= DATE_SUB(NOW(), INTERVAL %s HOUR)")
        params.append(hours)

    # Worker sees only their assigned node
    assigned_node = identity.get("assigned_node") if role != "manager" else None
    if assigned_node:
        where_clauses.append("node_id = %s")
        params.append(assigned_node)

    sql = base_select
    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)
    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)

    try:
        cursor.execute(sql, params)
    except Exception:
        # Fallback: some extended columns may not exist yet (pre-migration DB)
        fallback_sql = """
            SELECT gateway_id, node_id,
                   vib AS vib_magnitude, flame,
                   smoke AS smoke_raw, gas AS gas_raw,
                   distance, anomaly AS anomaly_edge, created_at
            FROM sensor_data
        """
        fb_where = []
        fb_params = []
        if hours > 0:
            fb_where.append("created_at >= DATE_SUB(NOW(), INTERVAL %s HOUR)")
            fb_params.append(hours)
        if assigned_node:
            fb_where.append("node_id = %s")
            fb_params.append(assigned_node)
        if fb_where:
            fallback_sql += " WHERE " + " AND ".join(fb_where)
        fallback_sql += " ORDER BY created_at DESC LIMIT %s"
        fb_params.append(limit)
        cursor.execute(fallback_sql, fb_params)

    rows = cursor.fetchall()
    col_names = [desc[0] for desc in cursor.description]
    cursor.close()

    data = [dict(zip(col_names, row)) for row in rows]

    # Enrich with latest in-memory gateway metadata + fix datetime serialization
    for row in data:
        meta = latest_gateway_meta.get(row.get("node_id"), {})
        if row.get("created_at") is not None:
            row["created_at"] = isoformat_server_datetime(row["created_at"])

        # Merge meta fields (overrides zeros from DB for live nodes)
        row.setdefault("gateway_rssi", meta.get("gateway_rssi", 0))
        row.setdefault("gateway_snr",  meta.get("gateway_snr", 0))
        row.setdefault("packet_seq",   meta.get("packet_seq", 0))
        row.setdefault("retry_count",  meta.get("retry_count", 0))
        row.setdefault("delivery_status", meta.get("delivery_status") or "STORED")
        row.setdefault("lars_score",   meta.get("lars_score", 0))

        # Aliases expected by the frontend component
        row["vib"]           = row.get("vib_magnitude", 0)     # backward compat
        row["smoke"]         = row.get("smoke_raw", 0)         # backward compat
        row["gas"]           = row.get("gas_raw", 0)           # backward compat
        row["anomaly"]       = row.get("anomaly_edge", 0)      # backward compat
        row["gateway_distance_estimate_m"] = meta.get("gateway_distance_estimate_m", 0)
        row["gateway_distance_exact_m"]    = meta.get("gateway_distance_exact_m", -1)
        row["gateway_distance_exact_valid"]= bool(meta.get("gateway_distance_exact_valid", False))
        row["distance_method"] = meta.get("distance_method") or "radio_estimate_only"
        row["acked"]           = bool(meta.get("acked", True))
        row["message_duplicate"] = bool(meta.get("message_duplicate", False))

        # vib as float (DB may store as Decimal)
        try:
            row["vib_magnitude"] = float(row["vib_magnitude"])
            row["vib"]           = row["vib_magnitude"]
        except (TypeError, ValueError):
            pass

    resp = jsonify(data)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.route("/api/latest", methods=["GET"])
@jwt_required()
def get_latest():
    """
    Get the latest sensor record for each node.
    Returns: { "NODE_01": { ... }, "NODE_02": { ... }, ... }
    Used as a fallback polling mechanism when SSE is not available.
    """
    now = time.time()
    result = {}
    cursor = mysql.connection.cursor()
    
    for node_id in NODE_IDS:
        try:
            cursor.execute("""
                SELECT 
                    gateway_id, node_id,
                    vib       AS vib_magnitude,
                    flame,
                    smoke     AS smoke_raw,
                    gas       AS gas_raw,
                    distance,
                    anomaly   AS anomaly_edge,
                    COALESCE(gateway_rssi, 0)              AS gateway_rssi,
                    COALESCE(gateway_snr,  0)              AS gateway_snr,
                    COALESCE(packet_seq,   0)              AS packet_seq,
                    COALESCE(retry_count_col, 0)           AS retry_count,
                    COALESCE(comm_status, 'STORED')        AS delivery_status,
                    COALESCE(ml_label, '')                 AS ml_label,
                    COALESCE(ml_confidence, 0)             AS ml_confidence,
                    COALESCE(ml_score, 0)                  AS lars_score,
                    COALESCE(adaptive_sf, 7)               AS adaptive_sf,
                    COALESCE(distance_rank, 0)             AS distance_rank,
                    COALESCE(latency_ms, 0)                AS latency_ms,
                    COALESCE(ax, 0) AS ax,
                    COALESCE(ay, 0) AS ay,
                    COALESCE(az, 0) AS az,
                    COALESCE(lat, 0) AS lat,
                    COALESCE(lon, 0) AS lon,
                    created_at
                FROM sensor_data
                WHERE node_id = %s
                ORDER BY id DESC
                LIMIT 1
            """, (node_id,))
            row = cursor.fetchone()
            if row:
                col_names = [desc[0] for desc in cursor.description]
                d = dict(zip(col_names, row))
                if d.get("created_at") is not None:
                    d["created_at"] = isoformat_server_datetime(d["created_at"])
                
                meta = latest_gateway_meta.get(node_id, {})
                d.setdefault("gateway_rssi", meta.get("gateway_rssi", 0))
                d.setdefault("gateway_snr",  meta.get("gateway_snr", 0))
                d.setdefault("packet_seq",   meta.get("packet_seq", 0))
                d.setdefault("retry_count",  meta.get("retry_count", 0))
                d.setdefault("delivery_status", meta.get("delivery_status") or "STORED")
                d.setdefault("lars_score",   meta.get("lars_score", 0))
                
                d["vib"] = d.get("vib_magnitude", 0)
                d["smoke"] = d.get("smoke_raw", 0)
                d["gas"] = d.get("gas_raw", 0)
                d["anomaly"] = d.get("anomaly_edge", 0)
                d["gateway_distance_estimate_m"] = meta.get("gateway_distance_estimate_m", 0)
                d["gateway_distance_exact_m"]    = meta.get("gateway_distance_exact_m", -1)
                d["gateway_distance_exact_valid"]= bool(meta.get("gateway_distance_exact_valid", False))
                
                try:
                    d["vib_magnitude"] = float(d["vib_magnitude"])
                    d["vib"] = d["vib_magnitude"]
                except (TypeError, ValueError):
                    pass
                
                last_seen = _node_last_seen.get(node_id)
                d["_online"] = last_seen is not None and (now - last_seen) < NODE_OFFLINE_THRESHOLD_SEC
                
                result[node_id] = d
            else:
                result[node_id] = {"_online": False}
        except Exception:
            try:
                cursor.execute("""
                    SELECT gateway_id, node_id,
                           vib AS vib_magnitude, flame,
                           smoke AS smoke_raw, gas AS gas_raw,
                           distance, anomaly AS anomaly_edge, created_at
                    FROM sensor_data
                    WHERE node_id = %s
                    ORDER BY id DESC
                    LIMIT 1
                """, (node_id,))
                row = cursor.fetchone()
                if row:
                    col_names = [desc[0] for desc in cursor.description]
                    d = dict(zip(col_names, row))
                    if d.get("created_at") is not None:
                        d["created_at"] = isoformat_server_datetime(d["created_at"])
                    d["vib"] = d.get("vib_magnitude", 0)
                    d["smoke"] = d.get("smoke_raw", 0)
                    d["gas"] = d.get("gas_raw", 0)
                    d["anomaly"] = d.get("anomaly_edge", 0)
                    
                    try:
                        d["vib_magnitude"] = float(d["vib_magnitude"])
                        d["vib"] = d["vib_magnitude"]
                    except (TypeError, ValueError):
                        pass
                    
                    last_seen = _node_last_seen.get(node_id)
                    d["_online"] = last_seen is not None and (now - last_seen) < NODE_OFFLINE_THRESHOLD_SEC
                    result[node_id] = d
                else:
                    result[node_id] = {"_online": False}
            except Exception:
                result[node_id] = {"_online": False}
                
    cursor.close()
    return jsonify(result), 200


@app.route("/api/network-health")
@jwt_required()
def network_health():
    """
    Lightweight gateway-network health summary built from recent sensor_data cadence.
    """
    cursor = mysql.connection.cursor()
    cursor.execute(
        """
        SELECT node_id, COUNT(*) AS rows_count, MAX(created_at) AS last_seen,
               AVG(distance) AS avg_sensor_distance
        FROM sensor_data
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        GROUP BY node_id
        ORDER BY node_id
        """
    )
    rows = cursor.fetchall()
    cursor.close()

    health = []
    for node_id, rows_count, last_seen, avg_sensor_distance in rows:
        if rows_count >= 20:
            quality = "strong"
        elif rows_count >= 10:
            quality = "moderate"
        else:
            quality = "weak"

        # With current DB schema we cannot query ACK/retry history directly, so derive a conservative
        # health summary from recent cadence. Frontend can also refine this using /sensor-data latest row.
        packet_failure = "low"
        if rows_count < 6:
            packet_failure = "high"
        elif rows_count < 12:
            packet_failure = "medium"
        meta = latest_gateway_meta.get(node_id, {})
        health.append({
            "node_id": node_id,
            "rows_10m": int(rows_count or 0),
            "last_seen": isoformat_server_datetime(last_seen),
            "link_quality": quality,
            "gateway_distance_estimate_m": meta.get("gateway_distance_estimate_m", 0),
            "gateway_distance_exact_m": meta.get("gateway_distance_exact_m", -1),
            "gateway_distance_exact_valid": bool(meta.get("gateway_distance_exact_valid", False)),
            "distance_method": meta.get("distance_method") or "radio_estimate_only",
            "lars_score": meta.get("lars_score", 0),
            "retry_count": meta.get("retry_count", 0),
            "delivery_status": meta.get("delivery_status") or "UNKNOWN",
            "acked_packets_total": meta.get("acked_packets_total", 0),
            "dropped_packets_total": meta.get("dropped_packets_total", 0),
            "ack_timeouts_total": meta.get("ack_timeouts_total", 0),
            "packet_failure": packet_failure,
            "avg_sensor_distance": float(avg_sensor_distance or 0),
        })
    return jsonify(health)



# ───────────────── CAMERA IMAGE UPLOAD ─────────────────
@app.route("/api/camera/upload", methods=["POST"])
def camera_upload():
    img = request.data
    filename = f"{uuid.uuid4()}.jpg"
    path = os.path.join(UPLOAD_DIR, filename)

    with open(path, "wb") as f:
        f.write(img)

    cursor = mysql.connection.cursor()
    cursor.execute(
        "INSERT INTO camera_images (filename) VALUES (%s)",
        (filename,)
    )
    mysql.connection.commit()
    cursor.close()

    return jsonify({"saved": filename}), 201


# ───────────────── CAMERA LIST ─────────────────
@app.route("/api/camera/list")
@jwt_required()
def camera_list():
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, filename, created_at
        FROM camera_images
        ORDER BY created_at DESC LIMIT 20
    """)
    rows = cursor.fetchall()
    cursor.close()

    data = [
        {
            "id": r[0],
            "filename": r[1],
            "created_at": isoformat_server_datetime(r[2]),
        }
        for r in rows
    ]

    return jsonify(data)

@app.route("/api/nodes")
@jwt_required()
def get_nodes():
    identity = current_jwt_identity()
    user_id = identity.get("id")
    if user_id is None:
        return jsonify({"message": "Invalid token identity"}), 401

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT 
            id, name, x_position AS x, y_position AS y,
            status, zone, last_seen AS lastSeen,
            voltage, temperature, vibration
        FROM nodes
        ORDER BY name
    """)
    nodes = cursor.fetchall()
    col_names = [desc[0] for desc in cursor.description]
    cursor.close()
    
    import datetime as dt
    data = []
    for row in nodes:
        node_dict = dict(zip(col_names, row))
        # Ensure the 'id' returned is the name (e.g. "NODE_01"), so that the frontend's
        # selectedNode logic matches properly.
        node_dict["id"] = node_dict["name"]
        if isinstance(node_dict.get("lastSeen"), (dt.date, dt.datetime)):
            node_dict["lastSeen"] = node_dict["lastSeen"].isoformat()
        data.append(node_dict)
        
    return jsonify(data)


# ───────────────── IMAGE SERVE ─────────────────
@app.route("/uploads/<filename>")
def serve_image(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ───────────────── TEAM MEMBERS (Manager Only) ─────────────────
@app.route("/api/team-members")
@jwt_required()
def team_members():
    identity = current_jwt_identity()
    role = identity.get("role")
    
    if role != "manager":
        return jsonify({"message": "Unauthorized"}), 403
    
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, full_name, email, company_name, role, created_at
        FROM users
        ORDER BY created_at DESC
    """)
    rows = cursor.fetchall()
    col_names = [desc[0] for desc in cursor.description]
    cursor.close()
    
    data = [dict(zip(col_names, row)) for row in rows]
    for row in data:
        if row.get("created_at") is not None:
            row["created_at"] = isoformat_server_datetime(row["created_at"])
    return jsonify(data)


# ───────────────── REPORTS (Manager Only) ─────────────────
@app.route("/api/reports")
@jwt_required()
def reports():
    identity = current_jwt_identity()
    role = identity.get("role")
    
    if role != "manager":
        return jsonify({"message": "Unauthorized"}), 403
    
    cursor = mysql.connection.cursor()
    
    # Daily stats (updated thresholds: gas > 400, smoke > 1200)
    cursor.execute("""
        SELECT 
            COUNT(*) as total_alerts,
            SUM(CASE WHEN anomaly = 1 OR flame = 1 OR distance < 50 OR smoke > 1200 OR gas > 400 THEN 1 ELSE 0 END) as critical_events
        FROM sensor_data
        WHERE DATE(created_at) = CURDATE()
    """)
    daily_row = cursor.fetchone()
    
    # Weekly stats
    cursor.execute("""
        SELECT 
            COUNT(*) as total_alerts,
            SUM(CASE WHEN anomaly = 1 OR flame = 1 OR distance < 50 OR smoke > 1200 OR gas > 400 THEN 1 ELSE 0 END) as critical_events
        FROM sensor_data
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    """)
    weekly_row = cursor.fetchone()
    
    # Monthly stats
    cursor.execute("""
        SELECT 
            COUNT(*) as total_alerts,
            SUM(CASE WHEN anomaly = 1 OR flame = 1 OR distance < 50 OR smoke > 1200 OR gas > 400 THEN 1 ELSE 0 END) as critical_events
        FROM sensor_data
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)
    monthly_row = cursor.fetchone()
    
    cursor.close()
    
    return jsonify({
        "daily": {
            "total_alerts": daily_row[0] or 0,
            "critical_events": daily_row[1] or 0,
            "avg_uptime": "99.9"
        },
        "weekly": {
            "total_alerts": weekly_row[0] or 0,
            "critical_events": weekly_row[1] or 0,
            "avg_uptime": "99.8"
        },
        "monthly": {
            "total_alerts": monthly_row[0] or 0,
            "critical_events": monthly_row[1] or 0,
            "avg_uptime": "99.7"
        }
    })


# ───────────────── ALERTS (Manager Only) ─────────────────
@app.route("/api/alerts")
@jwt_required()
def alerts():
    identity = current_jwt_identity()
    role = identity.get("role")
    
    if role != "manager":
        return jsonify({"message": "Unauthorized"}), 403
    
    cursor = mysql.connection.cursor()
    
    # Get recent critical events from sensor_data
    # Updated thresholds: Gas > 400, Smoke > 1200
    cursor.execute("""
        SELECT 
            id, node_id, created_at, distance, flame, anomaly, smoke, gas,
            CASE 
                WHEN flame = 1 THEN 'flame'
                WHEN anomaly = 1 THEN 'anomaly'
                WHEN distance < 50 THEN 'proximity'
                WHEN smoke > 1200 THEN 'smoke'
                WHEN gas > 400 THEN 'gas'
                ELSE 'other'
            END as type,
            CASE 
                WHEN flame = 1 OR anomaly = 1 THEN 'critical'
                WHEN distance < 50 OR smoke > 1200 OR gas > 400 THEN 'warning'
                ELSE 'info'
            END as severity
        FROM sensor_data
        WHERE (flame = 1 OR anomaly = 1 OR distance < 50 OR smoke > 1200 OR gas > 400)
        ORDER BY created_at DESC
        LIMIT 50
    """)
    
    rows = cursor.fetchall()
    cursor.close()
    
    alerts_list = []
    for row in rows:
        alert_id, node_id, created_at, distance, flame, anomaly, smoke, gas, alert_type, severity = row
        
        # Build message based on alert type (updated thresholds)
        if flame == 1:
            message = "Fire detected!"
        elif anomaly == 1:
            message = "Anomaly detected"
        elif distance and distance < 50:
            message = f"Object too close: {distance}cm"
        elif smoke and smoke > 1200:
            message = f"High smoke level: {smoke}"
        elif gas and gas > 400:
            message = f"High gas level: {gas}"
        else:
            message = "Alert"
        
        alerts_list.append({
            "id": alert_id,
            "node_id": node_id,
            "created_at": isoformat_server_datetime(created_at),
            "type": alert_type,
            "severity": severity,
            "message": message,
            "resolved": False  # Can add resolved column later
        })
    
    return jsonify(alerts_list)


@app.route("/api/alerts/<int:alert_id>/resolve", methods=["POST"])
@jwt_required()
def resolve_alert(alert_id):
    identity = current_jwt_identity()
    role = identity.get("role")
    
    if role != "manager":
        return jsonify({"message": "Unauthorized"}), 403
    
    # For now, just return success (can add resolved tracking later)
    return jsonify({"message": "Alert resolved"}), 200



# ───────────────── CALL MANAGER (Twilio) ─────────────────
@app.route("/api/call-manager", methods=["POST"])
@jwt_required()
def call_manager():
    """
    Initiate an outbound Twilio call to the manager's verified phone number.
    Available to both manager and worker roles.
    """
    try:
        from twilio.rest import Client as TwilioClient
    except ImportError:
        return jsonify({"error": "twilio library not installed. Run: pip install twilio"}), 500

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_number = os.getenv("TWILIO_FROM_NUMBER", "")
    manager_phone = normalize_phone_number(os.getenv("MANAGER_PHONE", ""))

    if not all([account_sid, auth_token, from_number, manager_phone]):
        return jsonify({"error": "Twilio credentials not configured in backend .env"}), 500

    identity = current_jwt_identity()
    caller_name = request.json.get("caller_name", "A factory worker") if request.json else "A factory worker"
    message = request.json.get("message", "Factory alert — please respond.") if request.json else "Factory alert — please respond."

    # TwiML message spoken when manager picks up
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">
    Hello, this is an automated call from Smart Factory AI.
    {caller_name} is calling you. Message: {message}
    Please check your Smart Factory dashboard immediately.
  </Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">Goodbye.</Say>
</Response>"""

    try:
        client = TwilioClient(account_sid, auth_token)
        call = client.calls.create(
            to=manager_phone,
            from_=from_number,
            twiml=twiml,
        )
        return jsonify({
            "success": True,
            "call_sid": call.sid,
            "status": call.status,
            "to": manager_phone,
            "message": f"Call initiated to manager ({manager_phone})"
        }), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ───────────────── CALL STATUS (Twilio) ─────────────────
@app.route("/api/call-status/<call_sid>")
@jwt_required()
def call_status(call_sid):
    """Check status of a Twilio call by SID."""
    try:
        from twilio.rest import Client as TwilioClient
    except ImportError:
        return jsonify({"error": "twilio not installed"}), 500

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not account_sid or not auth_token:
        return jsonify({"error": "Twilio not configured"}), 500

    try:
        client = TwilioClient(account_sid, auth_token)
        call = client.calls(call_sid).fetch()
        return jsonify({"status": call.status, "duration": call.duration}), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500




# ───────────────── AUTO-CALL SETTINGS (GET / POST) ─────────────────
@app.route("/api/auto-call-settings", methods=["GET", "POST"])
@jwt_required()
def auto_call_settings_api():
    if request.method == "GET":
        return jsonify(_load_auto_call_settings()), 200

    body = request.json or {}
    current = _load_auto_call_settings()
    # Merge only recognized keys
    if "enabled" in body:
        current["enabled"] = bool(body["enabled"])
    if "phones" in body and isinstance(body["phones"], list):
        current["phones"] = [normalize_phone_number(p) for p in body["phones"] if str(p).strip()]
    if "cooldown_sec" in body:
        try:
            current["cooldown_sec"] = max(60, int(body["cooldown_sec"]))
        except Exception:
            pass
    _save_auto_call_settings(current)
    return jsonify({"saved": True, "settings": current}), 200


# ───────────────── ADD / REMOVE PHONE NUMBERS ─────────────────
@app.route("/api/auto-call-settings/add-phone", methods=["POST"])
@jwt_required()
def add_phone():
    phone = normalize_phone_number((request.json or {}).get("phone", ""))
    if not phone:
        return jsonify({"error": "phone required"}), 400
    current = _load_auto_call_settings()
    if phone not in current["phones"]:
        current["phones"].append(phone)
        _save_auto_call_settings(current)
    return jsonify({"phones": current["phones"]}), 200


@app.route("/api/auto-call-settings/remove-phone", methods=["POST"])
@jwt_required()
def remove_phone():
    phone = normalize_phone_number((request.json or {}).get("phone", ""))
    if not phone:
        return jsonify({"error": "phone required"}), 400
    current = _load_auto_call_settings()
    current["phones"] = [p for p in current["phones"] if p != phone]
    _save_auto_call_settings(current)
    return jsonify({"phones": current["phones"]}), 200


# ───────────────── VERIFY NUMBER (Twilio) ─────────────────
@app.route("/api/verify-number", methods=["POST"])
@jwt_required()
def verify_number():
    """
    Check if a phone number is in Twilio's Verified Caller IDs list.
    Trial accounts can only call verified numbers.
    """
    try:
        from twilio.rest import Client as TwilioClient
    except ImportError:
        return jsonify({"error": "twilio not installed"}), 500

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not account_sid or not auth_token:
        return jsonify({"error": "Twilio credentials not configured"}), 500

    phone = normalize_phone_number((request.json or {}).get("phone", ""))
    if not phone:
        return jsonify({"error": "phone required"}), 400

    try:
        client = TwilioClient(account_sid, auth_token)
        verified_ids = client.outgoing_caller_ids.list()
        verified_numbers = [v.phone_number for v in verified_ids]
        is_verified = phone in verified_numbers
        return jsonify({
            "phone": phone,
            "verified": is_verified,
            "verified_numbers": verified_numbers,
            "message": (
                "Number is verified — calls will work."
                if is_verified
                else f"Number {phone} is NOT verified in Twilio. Go to Twilio Console > Verified Caller IDs to verify it."
            )
        }), 200
    except Exception as exc:
        return jsonify({"error": str(exc), "verified": False}), 500


# ───────────────── FLAME STATUS (for UI) ─────────────────
@app.route("/api/flame-status")
@jwt_required()
def flame_status():
    """Return current flame tracking state and auto-call settings summary."""
    now_t = time.time()
    status = {}
    for node in NODE_IDS:
        fs = _flame_status.get(node, {})
        status[node] = {
            "flame_on": fs.get("on", False),
            "last_update_sec": round(now_t - fs.get("ts", now_t), 1) if "ts" in fs else None,
            "stale": (now_t - fs.get("ts", 0)) > 90 if "ts" in fs else True,
        }
    acs = _load_auto_call_settings()
    all_flame_active = all(
        status[n]["flame_on"] and not status[n]["stale"] for n in NODE_IDS
    )
    return jsonify({
        "nodes": status,
        "all_flame_active": all_flame_active,
        "auto_call_enabled": acs.get("enabled", False),
        "phones": acs.get("phones", []),
        "cooldown_sec": acs.get("cooldown_sec", 300),
        "last_auto_call_ago_sec": round(now_t - _last_auto_call_time, 0) if _last_auto_call_time > 0 else None,
    }), 200




# ─────────────── ML HELPER: fetch rows for training ────────────────────────────
def _fetch_training_rows() -> list:
    """Fetch last 2000 sensor rows from DB for ML training."""
    try:
        with app.app_context():
            cur = mysql.connection.cursor()
            cur.execute("""
                SELECT smoke, gas, vib, distance, flame,
                       gateway_rssi, gateway_snr
                FROM sensor_data
                ORDER BY id DESC
                LIMIT 2000
            """)
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
            cur.close()
            return rows
    except Exception as exc:
        print(f"[ML] DB fetch error: {exc}")
        return []


# ─────────────── ML API ENDPOINTS ───────────────────────────────────────────────
@app.route("/api/ml-status")
@jwt_required()
def ml_status():
    """Return current Isolation Forest model status."""
    return jsonify(ml_model.get_status()), 200


@app.route("/api/ml-anomalies")
@jwt_required()
def ml_anomalies():
    """Return last 20 ML-detected anomalies."""
    limit = min(int(request.args.get("limit", 20)), 50)
    return jsonify(ml_model.get_recent_anomalies(limit)), 200


@app.route("/api/ml-retrain", methods=["POST"])
@jwt_required()
def ml_retrain():
    """Manually trigger ML model retraining."""
    identity = current_jwt_identity()
    if identity.get("role") != "manager":
        return jsonify({"error": "Manager only"}), 403
    threading.Thread(target=lambda: ml_model.train_from_rows(_fetch_training_rows()), daemon=True).start()
    return jsonify({"message": "Retraining started in background"}), 200


# ─────────────── NODE SF STATUS — Real Adaptive SF Rankings ────────────────────
# Air-time lookup (approximate for 100-byte packet, 125 kHz BW)
_SF_AIRTIME_MS = {5: 28, 6: 38, 7: 56, 8: 102, 9: 185, 10: 370, 11: 740, 12: 1480}

@app.route("/api/node-sf-status")
@jwt_required()
def node_sf_status():
    """
    Returns real-time adaptive SF rankings for all online nodes.
    Rankings are based on live gateway_rssi — closest = SF5, farthest = SF12.
    Response includes sf, rank, distance_rank_label, rssi, air_time_ms for each node.
    """
    now = time.time()
    with _sf_lock:
        snapshot = dict(_node_sf_rank)
        rssi_snapshot = dict(_node_rssi)
        ts_snapshot   = dict(_node_rssi_ts)

    result = []
    for node_id in NODE_IDS:
        last_ts = ts_snapshot.get(node_id, 0)
        age_sec = round(now - last_ts, 1) if last_ts else None
        online  = age_sec is not None and age_sec < RSSI_STALE_SEC

        if node_id in snapshot:
            info = snapshot[node_id]
            sf = info.get("sf", 7)
            result.append({
                "node_id":              node_id,
                "online":               online,
                "rssi":                 info.get("rssi"),
                "adaptive_sf":          sf,
                "distance_rank":        info.get("rank"),
                "distance_rank_label":  info.get("distance_rank_label", "Unknown"),
                "air_time_ms":          _SF_AIRTIME_MS.get(sf, 56),
                "last_seen_sec_ago":    age_sec,
            })
        else:
            result.append({
                "node_id":              node_id,
                "online":               False,
                "rssi":                 None,
                "adaptive_sf":          None,
                "distance_rank":        None,
                "distance_rank_label":  "Offline",
                "air_time_ms":          None,
                "last_seen_sec_ago":    None,
            })

    return jsonify({
        "nodes":      result,
        "sf_by_rank": _SF_BY_RANK,
        "rank_labels": _RANK_LABELS,
        "updated_at": isoformat_server_datetime(datetime.datetime.now()),
    }), 200


# ─────────────── STARTUP: train ML on boot ─────────────────────────────────────
def _startup_ml_training():
    """Try to load persisted model first; if not found, train from DB."""
    import time as _t
    _t.sleep(3)   # give Flask/MySQL a moment to initialise
    if not ml_model.load_persisted():
        rows = _fetch_training_rows()
        if rows:
            ml_model.train_from_rows(rows)
            print(f"[ML] Trained on {len(rows)} rows from DB")
        else:
            print("[ML] No DB rows yet — model will train after first packets arrive")
    else:
        print("[ML] Loaded persisted model from disk")


threading.Thread(target=_startup_ml_training, daemon=True).start()


if __name__ == "__main__":
    # threaded=True is required for SSE — each client needs its own thread
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
