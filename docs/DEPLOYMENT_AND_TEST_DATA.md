# Deployment Steps and Chemical Plant Test Data

## Deployment Order
1. Flash sender firmware:
   - `arduino/sender_node1.ino`
   - `arduino/sender_node2.ino`
   - `arduino/sender_node3.ino`
2. Flash gateway firmware:
   - `arduino/gateway.ino`
3. Flash camera firmware:
   - `arduino/camera.ino`
4. Start backend:
   - `python app.py` in `backend/`
5. Start frontend:
   - `npm run dev` in `factory-pulse-ai-main/`
6. Login and open dashboard.

## Suggested test dataset (ApexChem scenario)
Use this CSV-like sample for quick dashboard validation:

| ts | node_id | vib | flame | smoke | gas | distance | anomaly | scenario |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 2026-03-22T09:00:00+05:30 | NODE_01 | 1.9 | 0 | 910 | 350 | 62 | 0 | Normal mixing |
| 2026-03-22T09:02:00+05:30 | NODE_02 | 2.1 | 0 | 980 | 420 | 58 | 1 | Gas rise near filling |
| 2026-03-22T09:04:00+05:30 | NODE_03 | 2.4 | 0 | 1220 | 510 | 55 | 1 | Smoke + gas warning |
| 2026-03-22T09:06:00+05:30 | NODE_02 | 2.2 | 1 | 1380 | 650 | 49 | 1 | Localized flame event |
| 2026-03-22T09:08:00+05:30 | NODE_01 | 2.8 | 0 | 1060 | 390 | 23 | 1 | Proximity hazard |

## Camera use in this project
- Confirms incident context (is there actual flame/smoke?).
- Supports post-incident review and training.
- Reduces false dispatch by correlating sensor alert + image evidence.

## Frontend checks
- Live charts update every few seconds.
- Historical chart timestamps display local-browser time correctly.
- Network panel shows link quality per node from recent packet cadence.
