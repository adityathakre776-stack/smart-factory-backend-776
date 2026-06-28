# LoRa Multi-Node Real-Time Integration Guide
**Smart Factory — SX1278 + ESP32 → USB Serial → Flask → SSE → Dashboard**

---

## System Architecture

```
NODE_01 (ESP32 + SX1278)  ┐
NODE_02 (ESP32 + SX1278)  ├──(LoRa 433 MHz)──► Receiver ESP32
NODE_03 (ESP32 + SX1278)  ┘                        │
                                               USB Serial
                                                    │
                                          serial_bridge_ingest.py
                                                    │
                                    ┌───────────────┴────────────────┐
                                    │          Flask app.py          │
                                    │  POST /api/data → MySQL DB     │
                                    │  SSE  /api/stream → Dashboard  │
                                    └───────────────┬────────────────┘
                                                    │  EventSource
                                           React Dashboard (Vite)
                                     KPICards / LiveCharts / NetworkHealth
```

---

## Required Arduino Libraries

Install via Arduino Library Manager or `lib_deps` in PlatformIO:

| Library | Version | Purpose |
|---------|---------|---------|
| `RadioLib` | ≥ 6.x | SX1278 LoRa driver |
| `ArduinoJson` | ≥ 6.x | JSON serialization |
| `Adafruit MPU6050` | ≥ 2.x | IMU vibration |
| `Adafruit Unified Sensor` | ≥ 1.x | Sensor abstraction |
| `TinyGPSPlus` | ≥ 1.x | GPS parsing (optional) |
| `LiquidCrystal I2C` | ≥ 1.x | LCD display (gateway only) |

---

## ESP32 Pin Wiring

### Sender Nodes (NODE_01 / NODE_02 / NODE_03)

| Component | ESP32 GPIO |
|-----------|-----------|
| MQ2  AOUT (Smoke) | GPIO 32 |
| MQ135 AOUT (Gas) | GPIO 33 |
| Flame DO | GPIO 26 |
| HC-SR04 TRIG | GPIO 27 |
| HC-SR04 ECHO | GPIO 25 |
| MPU6050 SDA | GPIO 21 |
| MPU6050 SCL | GPIO 22 |
| SX1278 CS | GPIO 5 |
| SX1278 DIO0 | GPIO 2 |
| SX1278 RST | GPIO 4 |
| SX1278 SCK | GPIO 18 |
| SX1278 MISO | GPIO 19 |
| SX1278 MOSI | GPIO 23 |
| GPS RX (optional) | GPIO 16 |
| GPS TX (optional) | GPIO 17 |

### Receiver ESP32 (USB-Serial Gateway)

Same SX1278 pin mapping as senders. No sensors needed.

> **Note**: The existing `gateway.ino` (WiFi mode) also works. Use `receiver.ino` when WiFi is unavailable.

---

## LoRa Settings (All Nodes Must Match)

| Parameter | Value |
|-----------|-------|
| Frequency | 433.0 MHz |
| Bandwidth | 125 kHz |
| Spreading Factor | 11 |
| Coding Rate | 8 (4/8) |
| Sync Word | 0x12 |
| TX Power | 17 dBm |
| Preamble | 8 |

---

## JSON Packet Format

Senders transmit compact JSON every ~2 seconds:

```json
{
  "node_id":    "NODE_01",
  "gateway_id": "GATEWAY_01",
  "seq":        1234,
  "timestamp":  56789,
  "smoke":      120,
  "gas":        85,
  "flame":      0,
  "distance":   45,
  "vib":        9.81,
  "ax":         0.12,
  "ay":        -0.05,
  "az":         9.78,
  "lat":        0.0,
  "lon":        0.0,
  "anomaly":    0,
  "retransmit": false,
  "retry_of_seq": 0
}
```

Receiver enriches with gateway metadata before forwarding:
```
GW_JSON:{"node_id":"NODE_01","gateway_id":"GATEWAY_01","gateway_rssi":-68.5,"gateway_snr":7.2,...}
```

---

## Step-by-Step Setup

### Step 1: Flash Arduino Firmware

1. **Sender NODE_01** → Flash `arduino/sender1/sender1.ino`
2. **Sender NODE_02** → Flash `arduino/sender2.ino`
3. **Sender NODE_03** → Flash `arduino/sender3.ino`
4. **Receiver ESP32** → Flash `arduino/receiver/receiver.ino`

> If you have a GPS module, set `#define HAS_GPS 1` in the sender file.

Verify senders in Serial Monitor (115200 baud):
```
=== NODE_01 STARTING ===
MPU6050 OK
LoRa SX1278 OK @ 433 MHz
Calibrating MQ sensors...
[NODE_01] TX: {"node_id":"NODE_01","seq":1,...}
[NODE_01] ACK OK (attempt 1): ACK:NODE_01:1
```

Verify receiver in Serial Monitor:
```
=== SMART FACTORY RECEIVER STARTED ===
LoRa SX1278 @ 433 MHz — Ready
--- LoRa Packet Received ---
{"node_id":"NODE_01",...}
ACK NODE_01 seq=1: SENT
GW_JSON:{"node_id":"NODE_01","gateway_rssi":-65.0,...}
```

### Step 2: Run Database Migration

In phpMyAdmin or MySQL CLI:
```bash
mysql -u root smartfactory < backend/migrate_lora_columns.sql
```

Or paste contents into phpMyAdmin SQL tab.

### Step 3: Start Flask Backend

```bash
cd backend
pip install flask flask-cors flask-mysqldb flask-jwt-extended python-dotenv pyserial requests
python app.py
```

Backend runs on `http://localhost:5000`.

### Step 4: Start Serial Bridge

Connect Receiver ESP32 via USB, find the COM port (Device Manager → Ports):

```bash
cd backend
python serial_bridge_ingest.py --port COM5 --baud 115200
```

Expected output:
```
[BRIDGE] Opening COM5 @ 115200 baud
[BRIDGE] API endpoint:       http://127.0.0.1:5000/api/data
[BRIDGE] SSE push endpoint:  http://127.0.0.1:5000/api/stream/push
[BRIDGE] Serial connected: COM5
[23:15:01] RX NODE_01 seq=5 smoke=120 gas=85 flame=0 vib=9.81
[POST OK 201] node=NODE_01 seq=5
```

### Step 5: Start Frontend

```bash
cd factory-pulse-ai-main
npm run dev
```

Open `http://localhost:8080` → Login → Dashboard.

You should see:
- **LIVE** badge (green, top-left of KPI cards)
- **NODE_01 / NODE_02 / NODE_03** cards with green pulsing dots
- Charts updating in real-time (<1 second after packet received)

---

## Alert Thresholds

| Alert | Condition | Action |
|-------|-----------|--------|
| 🔥 Fire | `flame == 1` | Toast + Speech + Beep |
| ⚠️ Gas Leak | `gas > 400` | Toast + Speech + Beep |
| 💨 Smoke | `smoke > 1200` | Toast + Speech + Beep |
| 📏 Too Close | `distance < 50 cm` | Toast + Speech + Beep |
| 📳 Vibration | `vib > 9.5 g` | Toast + Speech + Beep |
| 📡 Node Offline | No packet > 60s | Toast + Speech + Beep |

---

## Troubleshooting

### Serial Bridge: "Serial open error: could not open port COM5"
- Check Device Manager for correct COM port
- Ensure no other program (Arduino IDE Serial Monitor) is using the port
- Try `--port COM3` or `--port COM7`

### Gateway sends ACK_TX_FAIL
- Senders are not in receive mode when gateway transmits ACK
- Reduce distance between sender and receiver
- Verify SX1278 wiring (CS, RST, DIO0 pins)

### Dashboard shows POLLING (not LIVE)
- Flask must be running with `threaded=True` (already set)
- Check browser console for EventSource errors
- Verify CORS allows `http://localhost:8080`

### Nodes show OFFLINE
- Check that sender and receiver are powered
- Verify LoRa settings match exactly (SF, BW, CR, sync, freq)
- Serial bridge must be running

### MySQL migration fails with "column already exists"
- Safe — the `IF NOT EXISTS` clause prevents errors
- If using older MySQL (<8.0), run column-by-column:
  ```sql
  ALTER TABLE sensor_data ADD COLUMN packet_seq INT DEFAULT 0;
  ```

---

## File Structure (New/Modified Files)

```
smart-factory - Copy/
├── arduino/
│   ├── sender1/sender1.ino     ✏️ UPGRADED (NODE_01 + MPU6050 + HC-SR04 + GPS)
│   ├── sender2.ino             ✏️ UPGRADED (NODE_02 + all sensors)
│   ├── sender3.ino             ✏️ UPGRADED (NODE_03 + GPS + normalized JSON)
│   ├── receiver/
│   │   └── receiver.ino        🆕 NEW (USB-Serial receiver with ACK)
│   └── gateway.ino             ✅ UNCHANGED (WiFi mode still works)
├── backend/
│   ├── app.py                  ✏️ UPGRADED (+SSE /api/stream + /api/stream/push)
│   ├── serial_bridge_ingest.py ✏️ UPGRADED (+SSE push + validation + stats)
│   └── migrate_lora_columns.sql 🆕 NEW (DB migration for GPS/vib/RSSI columns)
└── factory-pulse-ai-main/src/
    ├── hooks/
    │   ├── useSensorSSE.ts     🆕 NEW (EventSource hook with node status)
    │   └── useAlarm.ts         ✏️ UPGRADED (+vibration + node offline alerts)
    └── components/dashboard/
        ├── KPICards.tsx        ✏️ UPGRADED (SSE + online/offline badge)
        ├── NetworkHealthPanel.tsx ✏️ UPGRADED (LIVE/POLLING + node dots)
        └── LiveCharts.tsx      ✏️ UPGRADED (SSE append + 10s fallback poll)
```

---

## Performance Notes

| Metric | Before | After |
|--------|--------|-------|
| Data latency | ~3-4 seconds (polling) | <1 second (SSE push) |
| Backend threads | 1 | threaded=True (auto) |
| Chart update | Full re-fetch every 4s | Append on event |
| REST polling | Every 3s (KPI) / 4s (charts) | Every 10s (fallback only) |
| Offline detection | Never | Within 5 seconds via SSE heartbeat |
