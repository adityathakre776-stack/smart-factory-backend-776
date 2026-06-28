# Network, LoRa Range, and Power-bank Operation

## Can sender ESP32 run from a power bank after upload?
Yes. After firmware upload, sender nodes can run from a stable 5V USB power bank.

### Practical notes
- Use a quality cable (data-quality cable generally has lower loss too).
- Recommended power bank output: **5V / 2A**.
- Poor power causes RF brownouts and transmission timeouts.

## LoRa practical distance
Distance depends strongly on antenna quality, placement, and obstacles.

### Typical ranges (433 MHz, SX1278/SX1276, small antennas)
- **Dense indoor factory**: 80m to 300m
- **Semi-open industrial campus**: 300m to 1.5km
- **Open line-of-sight**: 2km to 5km (sometimes more with better antennas and height)

### For stable production telemetry
- Plan for the conservative indoor range.
- Keep gateway elevated and away from large motors/EMI sources.
- Use proper quarter-wave antennas and matching connectors.

## Network policy in this revamp
- Sender <-> gateway: LoRa only
- Gateway <-> backend: WiFi/HTTP only
- Frontend talks to backend API only

## Reliability controls
- Sender packet sequence numbers
- Slot spacing for 3 senders (collision reduction)
- Gateway queue + retry/backoff for backend posting
- Network health API (`/api/network-health`) for monitoring packet cadence
