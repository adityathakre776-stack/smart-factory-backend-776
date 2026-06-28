"""
ml_model.py  —  Isolation Forest Anomaly Detection Engine
Smart Factory LoRa IoT Project

Features used:  smoke, gas, vib, distance, flame, rssi, snr
Auto-trains on startup from DB historical data.
Re-trains every 200 new packets (rolling update).
Emits anomaly_score (-1=anomaly, 1=normal) + confidence % for every packet.
"""

import threading
import time
import os
import numpy as np

# ── Lazy imports (don't crash if sklearn missing) ─────────────────────────────
try:
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
    import joblib
    _SKLEARN_OK = True
except ImportError:
    _SKLEARN_OK = False

# ── Config ────────────────────────────────────────────────────────────────────

MODEL_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(MODEL_DIR, "ml_isolation_forest.joblib")
SCALER_PATH = os.path.join(MODEL_DIR, "ml_scaler.joblib")

FEATURE_NAMES = ["smoke", "gas", "vib", "distance", "flame", "rssi", "snr"]
MIN_SAMPLES_TO_TRAIN = 30     # need at least 30 rows to train
RETRAIN_EVERY_N      = 200    # retrain after N new live packets
CONTAMINATION        = 0.08   # expect ~8% anomalies in factory data

# ── State ─────────────────────────────────────────────────────────────────────

_model: "IsolationForest | None"   = None   # type: ignore[name-defined]
_scaler: "StandardScaler | None"   = None   # type: ignore[name-defined]
_model_lock = threading.Lock()
_new_pkt_count = 0           # packets since last retrain
_total_scored  = 0
_train_status  = "untrained" # "untrained" | "training" | "ready" | "error"
_train_rows    = 0           # number of rows used for last training
_recent_anomalies: list[dict] = []   # last 50 ML anomaly events


# ── Feature extraction ────────────────────────────────────────────────────────

def extract_features(
    smoke: float, gas: float, vib: float, distance: float,
    flame: float, rssi: float, snr: float,
) -> np.ndarray:
    """
    Build feature vector.  Distance=0 is treated as sensor error → replace with 999.
    """
    dist_clean = distance if distance > 0 else 999.0
    rssi_clean = rssi if rssi != 0 else -120.0   # 0 = no RSSI reading
    snr_clean  = snr  if snr  != 0 else -10.0
    return np.array([[smoke, gas, vib, dist_clean, flame, rssi_clean, snr_clean]],
                    dtype=np.float32)


# ── Train from DB rows ────────────────────────────────────────────────────────

def train_from_rows(rows: list[dict]) -> bool:
    """
    rows: list of dicts with keys smoke,gas,vib,distance,flame,gateway_rssi,gateway_snr
    Returns True on success.
    """
    global _model, _scaler, _train_status, _train_rows, _new_pkt_count

    if not _SKLEARN_OK:
        _train_status = "error"
        return False

    if len(rows) < MIN_SAMPLES_TO_TRAIN:
        _train_status = "untrained"
        return False

    try:
        _train_status = "training"
        X = np.array([
            [
                float(r.get("smoke", 0) or 0),
                float(r.get("gas",   0) or 0),
                float(r.get("vib",   0) or 0),
                float(r.get("distance", 999) or 999) if float(r.get("distance", 0) or 0) > 0 else 999.0,
                float(r.get("flame", 0) or 0),
                float(r.get("gateway_rssi", -120) or -120),
                float(r.get("gateway_snr",  -10)  or -10),
            ]
            for r in rows
        ], dtype=np.float32)

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        model = IsolationForest(
            n_estimators=150,
            contamination=CONTAMINATION,
            max_samples="auto",
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_scaled)

        with _model_lock:
            _model   = model
            _scaler  = scaler
            _train_rows    = len(rows)
            _new_pkt_count = 0
            _train_status  = "ready"

        # Persist to disk
        try:
            joblib.dump(model,  MODEL_PATH)
            joblib.dump(scaler, SCALER_PATH)
        except Exception:
            pass

        return True

    except Exception as exc:
        _train_status = "error"
        print(f"[ML] Training error: {exc}")
        return False


# ── Load persisted model ──────────────────────────────────────────────────────

def load_persisted() -> bool:
    global _model, _scaler, _train_status
    if not _SKLEARN_OK:
        return False
    try:
        if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
            with _model_lock:
                _model  = joblib.load(MODEL_PATH)
                _scaler = joblib.load(SCALER_PATH)
            _train_status = "ready"
            return True
    except Exception:
        pass
    return False


# ── Score a single packet ─────────────────────────────────────────────────────

def score_packet(
    node_id: str,
    smoke: float, gas: float, vib: float, distance: float,
    flame: float, rssi: float, snr: float,
    timestamp: str = "",
) -> dict:
    """
    Returns:
      {
        "ml_anomaly": bool,
        "ml_score": float,           # raw decision function (negative = more anomalous)
        "ml_confidence": float,      # 0-100 (how anomalous, 100=very anomalous)
        "ml_label": str,             # "NORMAL" | "WARNING" | "CRITICAL"
        "ml_reason": str,            # human-readable
        "model_ready": bool,
      }
    """
    global _total_scored, _new_pkt_count, _recent_anomalies

    if not _SKLEARN_OK or _model is None or _scaler is None:
        return {
            "ml_anomaly": False, "ml_score": 0.0, "ml_confidence": 0.0,
            "ml_label": "MODEL_NOT_READY", "ml_reason": _train_status,
            "model_ready": False,
        }

    X = extract_features(smoke, gas, vib, distance, flame, rssi, snr)

    with _model_lock:
        try:
            X_scaled = _scaler.transform(X)
            prediction  = _model.predict(X_scaled)[0]       # 1=normal, -1=anomaly
            score_raw   = _model.decision_function(X_scaled)[0]  # negative = anomalous
        except Exception:
            return {"ml_anomaly": False, "ml_score": 0.0, "ml_confidence": 0.0,
                    "ml_label": "ERROR", "ml_reason": "score_failed", "model_ready": True}

    _total_scored  += 1
    _new_pkt_count += 1

    # Normalise score to 0-100 confidence (more anomalous = higher %)
    # Typical range of decision_function: -0.5 (anomaly) to +0.5 (normal)
    conf = min(100.0, max(0.0, (-score_raw + 0.5) * 100.0))

    is_anomaly = (prediction == -1)

    # ── Rule-based overrides (always trigger regardless of model) ──────────
    # These cover clear physical events the model may not have seen yet.
    rule_critical = False
    reasons = []

    if flame:
        reasons.append("Flame detected")
        rule_critical = True
    if smoke > 3500:
        reasons.append(f"Smoke={smoke:.0f} (high)")
        rule_critical = True
    elif smoke > 2000:
        reasons.append(f"Smoke={smoke:.0f} (elevated)")
        is_anomaly = True
    if gas > 1800:
        reasons.append(f"Gas={gas:.0f} (high)")
        rule_critical = True
    elif gas > 1200:
        reasons.append(f"Gas={gas:.0f} (elevated)")
        is_anomaly = True
    # Vibration: >2.5 m/s² = WARNING, >8.0 m/s² = CRITICAL
    if vib > 8.0:
        reasons.append(f"Vib={vib:.2f} m/s2 (CRITICAL)")
        rule_critical = True
    elif vib > 2.5:
        reasons.append(f"Vib={vib:.2f} m/s2 (high)")
        is_anomaly = True
    # Distance: object closer than 50 cm = proximity alert
    if 0 < distance < 50:
        reasons.append(f"Proximity={distance:.0f}cm (<50cm alert)")
        is_anomaly = True
    if rssi < -90:
        reasons.append(f"RSSI={rssi:.0f}dBm (weak link)")

    if rule_critical:
        is_anomaly = True

    reason = ", ".join(reasons) if reasons else ("Multi-sensor pattern anomaly" if is_anomaly else "Normal")

    if rule_critical or (is_anomaly and conf >= 70):
        label = "CRITICAL"
    elif is_anomaly:
        label = "WARNING"
    else:
        label = "NORMAL"

    result = {
        "ml_anomaly":    is_anomaly,
        "ml_score":      round(float(score_raw), 4),
        "ml_confidence": round(conf, 1),
        "ml_label":      label,
        "ml_reason":     reason,
        "model_ready":   True,
    }

    # Store recent anomalies (max 50)
    if is_anomaly:
        entry = {
            "node_id":   node_id,
            "timestamp": timestamp or time.strftime("%Y-%m-%dT%H:%M:%S"),
            "label":     label,
            "confidence": round(conf, 1),
            "reason":    reason,
            "smoke": smoke, "gas": gas, "vib": vib,
            "distance": distance, "flame": int(flame),
            "rssi": rssi, "snr": snr,
        }
        _recent_anomalies.append(entry)
        if len(_recent_anomalies) > 50:
            _recent_anomalies.pop(0)

    return result


# ── Background auto-retrain ───────────────────────────────────────────────────

def maybe_retrain(get_db_rows_fn) -> None:
    """
    Call this after each packet. If _new_pkt_count >= RETRAIN_EVERY_N,
    triggers a background retrain using get_db_rows_fn() to fetch fresh data.
    get_db_rows_fn: callable() → list[dict]
    """
    if _new_pkt_count >= RETRAIN_EVERY_N:
        threading.Thread(
            target=_bg_retrain, args=(get_db_rows_fn,), daemon=True
        ).start()


def _bg_retrain(get_db_rows_fn) -> None:
    try:
        rows = get_db_rows_fn()
        if rows:
            train_from_rows(rows)
    except Exception as exc:
        print(f"[ML] Background retrain error: {exc}")


# ── Status summary ────────────────────────────────────────────────────────────

def get_status() -> dict:
    return {
        "sklearn_available": _SKLEARN_OK,
        "model_status":      _train_status,
        "train_rows":        _train_rows,
        "total_scored":      _total_scored,
        "new_since_retrain": _new_pkt_count,
        "retrain_every":     RETRAIN_EVERY_N,
        "contamination":     CONTAMINATION,
        "features":          FEATURE_NAMES,
        "recent_anomaly_count": len(_recent_anomalies),
    }


def get_recent_anomalies(limit: int = 20) -> list:
    return list(reversed(_recent_anomalies))[:limit]
