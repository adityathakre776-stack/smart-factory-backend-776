import time
import random
import requests

API_URL = "http://172.20.10.2:5000/api/data"
NODE_IDS = ["NODE_01", "NODE_02", "NODE_03"]

print("=" * 60)
print("  Smart Factory Mock Data Simulator")
print(f"  Targeting Flask Server: {API_URL}")
print("  Pushes live sensor events every 2 seconds...")
print("  Press Ctrl+C to stop.")
print("=" * 60 + "\n")

seqs = {node: 1 for node in NODE_IDS}

try:
    while True:
        for node in NODE_IDS:
            # Staggered send (approx 667ms apart)
            time.sleep(0.667)
            
            # Generate random realistic sensor readings
            smoke = random.randint(150, 450)
            gas = random.randint(80, 250)
            flame = 1 if random.random() < 0.02 else 0
            distance = random.randint(5, 120)
            vib = round(random.uniform(0.05, 0.45), 2)
            
            # 2% chance of anomaly
            anomaly = False
            if flame == 1 or smoke > 400 or vib > 2.5:
                anomaly = True
            
            # Random anomaly spike
            if random.random() < 0.02:
                anomaly = True
                smoke = random.randint(1500, 4095)
                gas = random.randint(1000, 3500)
                vib = round(random.uniform(2.8, 4.8), 2)
                
            payload = {
                "gateway_id": "GATEWAY_01",
                "node_id": node,
                "packet_seq": seqs[node],
                "smoke": smoke,
                "gas": gas,
                "flame": flame,
                "distance": distance,
                "vib": vib,
                "ax": round(random.uniform(-1.0, 1.0), 2),
                "ay": round(random.uniform(-1.0, 1.0), 2),
                "az": round(random.uniform(9.0, 10.0), 2),
                "lat": 0.0,
                "lon": 0.0,
                "anomaly": anomaly,
                "gateway_rssi": random.randint(-75, -45),
                "gateway_snr": round(random.uniform(8.0, 12.0), 1),
                "gateway_distance_estimate_m": round(random.uniform(0.5, 3.5), 1),
                "node_gateway_distance_m": round(random.uniform(0.5, 3.5), 1),
                "delivery_status": "RECEIVED",
                "message_duplicate": False
            }
            
            try:
                resp = requests.post(API_URL, json=payload, timeout=2)
                if resp.status_code == 200:
                    print(f"[SIMULATOR] Sent data for {node} (seq={seqs[node]}, smoke={smoke}, gas={gas}, anomaly={anomaly})")
                    seqs[node] += 1
                else:
                    print(f"[SIMULATOR] Failed to send: HTTP {resp.status_code}")
            except Exception as e:
                print(f"[SIMULATOR] Connection error: {e}")
                
except KeyboardInterrupt:
    print("\nSimulator stopped.")
