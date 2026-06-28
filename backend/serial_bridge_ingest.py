"""
Smart Factory — Serial Bridge Ingest (Upgraded)
================================================
Reads GW_JSON: lines from LoRa Receiver ESP32 via USB Serial,
POSTs to Flask /api/data, AND pushes to Flask SSE queue at /api/stream.

Usage:
    python serial_bridge_ingest.py --port COM5 --baud 115200

Optional args:
    --api      Flask API base URL    (default: http://172.20.10.2:5000/api/data)
    --sse-url  Flask SSE push URL    (default: http://172.20.10.2:5000/api/stream/push)
    --verbose  Print every packet JSON to console

Requirements:
    pip install pyserial requests
"""

import argparse
import json
import time
import sys
import threading
from datetime import datetime

import requests
import serial


# ─────────────────────────── CONFIG ────────────────────────────
OFFLINE_THRESHOLD_SEC = 60          # seconds without a packet = node OFFLINE
RECONNECT_DELAY_SEC   = 3           # serial reconnect wait
POST_TIMEOUT_SEC      = 5           # HTTP timeout
SSE_TIMEOUT_SEC       = 2           # SSE push timeout (non-blocking)

# ─────────────────────────── STATS ─────────────────────────────
class Stats:
    def __init__(self):
        self.lock         = threading.Lock()
        self.packets_rx   = 0
        self.post_ok      = 0
        self.post_fail    = 0
        self.sse_push_ok  = 0
        self.sse_push_fail= 0
        self.malformed    = 0
        self.node_last    : dict[str, float] = {}

    def record_rx(self, node_id: str):
        with self.lock:
            self.packets_rx += 1
            self.node_last[node_id] = time.time()

    def get_node_status(self, node_id: str) -> str:
        last = self.node_last.get(node_id)
        if last is None:
            return "NEVER_SEEN"
        elapsed = time.time() - last
        return "ONLINE" if elapsed < OFFLINE_THRESHOLD_SEC else f"OFFLINE({int(elapsed)}s)"

    def print_stats(self):
        with self.lock:
            print(f"\n[STATS] RX={self.packets_rx} POST_OK={self.post_ok} "
                  f"POST_FAIL={self.post_fail} SSE_OK={self.sse_push_ok} "
                  f"SSE_FAIL={self.sse_push_fail} MALFORMED={self.malformed}")
            for node, ts in sorted(self.node_last.items()):
                elapsed = time.time() - ts
                status = "ONLINE" if elapsed < OFFLINE_THRESHOLD_SEC else "OFFLINE"
                print(f"         {node}: {status} (last={int(elapsed)}s ago)")


stats = Stats()


# ─────────────────────────── HTTP HELPERS ──────────────────────
def post_to_backend(api_url: str, payload: dict, verbose: bool) -> bool:
    """POST sensor data to Flask /api/data"""
    try:
        resp = requests.post(api_url, json=payload, timeout=POST_TIMEOUT_SEC)
        ok = resp.status_code in (200, 201)
        if ok:
            stats.post_ok += 1
            if verbose:
                print(f"[POST OK {resp.status_code}] node={payload.get('node_id')} seq={payload.get('seq')}")
        else:
            stats.post_fail += 1
            print(f"[POST FAIL {resp.status_code}] {resp.text[:120]}")
        return ok
    except requests.RequestException as exc:
        stats.post_fail += 1
        print(f"[POST ERR] {exc}")
        return False


def push_sse_event(sse_push_url: str, payload: dict, verbose: bool) -> bool:
    """Push event to Flask SSE internal queue endpoint"""
    try:
        resp = requests.post(sse_push_url, json=payload, timeout=SSE_TIMEOUT_SEC)
        ok = resp.status_code in (200, 204)
        if ok:
            stats.sse_push_ok += 1
        else:
            stats.sse_push_fail += 1
        return ok
    except requests.RequestException:
        stats.sse_push_fail += 1
        return False


# ─────────────────────────── VALIDATION ────────────────────────
REQUIRED_FIELDS = {"node_id"}

def validate_payload(payload: dict) -> tuple[bool, str]:
    """Returns (is_valid, error_message)"""
    for field in REQUIRED_FIELDS:
        if field not in payload:
            return False, f"Missing required field: {field}"
    node_id = str(payload.get("node_id", ""))
    if not node_id or node_id == "UNKNOWN":
        return False, "node_id is UNKNOWN or empty"
    return True, ""


# ─────────────────────────── PERIODIC STATS THREAD ─────────────
def stats_printer():
    while True:
        time.sleep(30)
        stats.print_stats()


# ─────────────────────────── MAIN LOOP ─────────────────────────
def run_bridge(port: str, baud: int, api_url: str, sse_push_url: str, verbose: bool):
    print(f"[BRIDGE] Opening {port} @ {baud} baud")
    print(f"[BRIDGE] API endpoint:       {api_url}")
    print(f"[BRIDGE] SSE push endpoint:  {sse_push_url}")
    print("[BRIDGE] Waiting for GW_JSON: lines...\n")

    while True:
        ser = None
        try:
            ser = serial.Serial(port, baud, timeout=1)
            print(f"[BRIDGE] Serial connected: {port}")

            while True:
                try:
                    raw = ser.readline()
                except serial.SerialException as e:
                    print(f"[BRIDGE] Serial read error: {e}")
                    break

                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                # Print non-JSON debug lines
                if not line.startswith("GW_JSON:"):
                    if verbose or any(kw in line for kw in ["ERROR", "FAIL", "WARN", "STATUS"]):
                        print(f"[ESP32] {line}")
                    continue

                # Parse JSON
                json_text = line[len("GW_JSON:"):].strip()
                try:
                    payload = json.loads(json_text)
                except json.JSONDecodeError as e:
                    stats.malformed += 1
                    print(f"[SKIP] Bad JSON ({e}): {json_text[:80]}")
                    continue

                # Validate
                valid, err_msg = validate_payload(payload)
                if not valid:
                    stats.malformed += 1
                    print(f"[SKIP] Invalid payload: {err_msg}")
                    continue

                node_id = str(payload["node_id"])
                stats.record_rx(node_id)

                ts = datetime.now().strftime("%H:%M:%S")
                print(f"[{ts}] RX {node_id} seq={payload.get('seq','-')} "
                      f"smoke={payload.get('smoke',0)} gas={payload.get('gas',0)} "
                      f"flame={payload.get('flame',0)} vib={payload.get('vib',0):.2f}")

                # POST to Flask (stores in DB)
                post_to_backend(api_url, payload, verbose)

                # Push to SSE stream (non-blocking, best-effort)
                threading.Thread(
                    target=push_sse_event,
                    args=(sse_push_url, payload, verbose),
                    daemon=True
                ).start()

        except serial.SerialException as e:
            print(f"[BRIDGE] Serial open error: {e}")
        except KeyboardInterrupt:
            print("\n[BRIDGE] Stopped by user")
            stats.print_stats()
            sys.exit(0)
        finally:
            if ser and ser.is_open:
                ser.close()

        print(f"[BRIDGE] Reconnecting in {RECONNECT_DELAY_SEC}s...")
        time.sleep(RECONNECT_DELAY_SEC)


# ─────────────────────────── ENTRY POINT ───────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="LoRa Serial Bridge: reads GW_JSON lines, posts to Flask + SSE"
    )
    parser.add_argument("--port",     required=True,  help="Serial COM port, e.g. COM5 or /dev/ttyUSB0")
    parser.add_argument("--baud",     type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--api",      default="http://172.20.10.2:5000/api/data",
                        help="Flask ingest endpoint")
    parser.add_argument("--sse-url",  default="http://172.20.10.2:5000/api/stream/push",
                        help="Flask SSE internal push endpoint")
    parser.add_argument("--verbose",  action="store_true", help="Print all packet details")
    args = parser.parse_args()

    # Start stats printer thread
    t = threading.Thread(target=stats_printer, daemon=True)
    t.start()

    run_bridge(args.port, args.baud, args.api, args.sse_url, args.verbose)


if __name__ == "__main__":
    main()
