# Hardware Components and Why They Are Used

## Sender Node (x3)
- **ESP32 + SX1278 LoRa**: low-power edge compute + long-range RF telemetry.
- **MPU6050**: vibration trend for motor imbalance and bearing wear.
- **Flame sensor**: immediate local optical flame trigger.
- **MQ smoke/gas sensors**: concentration trend that catches vapor build-up.
- **HC-SR04**: short-range obstacle/proximity around moving drums/conveyors.

## Gateway Node (x1)
- **ESP32 + SX1276 LoRa RX**: receives packets from all 3 senders.
- **WiFi + HTTP client**: forwards payloads to backend only.
- **Queue (store-and-forward)**: avoids packet loss when backend/network is transiently down.
- **LCD + serial summary**: local visibility during deployment.

## Camera Node
- **ESP32-CAM (AI-Thinker)**: live visual verification + periodic snapshots.
- Camera helps operators validate whether alerts are real incidents (fire/smoke/leak handling).

## Improved Flame Detection Logic
Single flame sensor is near-field and can miss distant or partially occluded fire.

Revamp uses a **fused strategy**:
- short persistence window for flame digital triggers
- cross-check with smoke and gas moving averages
- fire risk flag raised when either:
  - flame persists for multiple cycles, or
  - smoke + gas rise together above calibrated thresholds

This reduces both false negatives and noisy one-shot triggers.
