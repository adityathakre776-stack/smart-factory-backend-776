# Smart Factory Revamp (Chemical Blending Plant)

## Target Factory
This solution targets a **small chemical blending plant** where flammable solvents are mixed, filled into drums, and moved through short conveyor lines.

## Core Architecture
- 3 sender nodes (`NODE_01`, `NODE_02`, `NODE_03`)
- 1 LoRa gateway (`GATEWAY_01`)
- Flask backend + MySQL
- React frontend dashboard
- ESP32-CAM stream + periodic image upload

## Why this architecture
- LoRa keeps telemetry active even where WiFi coverage is weak inside metal-heavy production areas.
- Gateway isolates internet/network dependency from sensor nodes.
- Backend network is used only for data ingest, storage, and dashboard API.

## Zones
- `ZONE_1`: Solvent mixing bay
- `ZONE_2`: Drum filling conveyor
- `ZONE_3`: Storage and dispatch

## Safety Objectives
- Detect fire risk faster than single flame digital trigger
- Detect smoke/gas accumulation trends
- Monitor machine vibration and close-proximity hazards
- Keep telemetry reliable with queue + retry logic
