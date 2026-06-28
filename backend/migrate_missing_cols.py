import pymysql, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = pymysql.connect(host='localhost', user='root', password='', database='smartfactory_new', charset='utf8mb4')
cur = conn.cursor()

# Get existing columns
cur.execute('DESCRIBE sensor_data')
existing = [r[0] for r in cur.fetchall()]
print(f"Existing columns ({len(existing)}): {existing}")

# Missing columns to add
migrations = [
    ("ml_label",      "ALTER TABLE sensor_data ADD COLUMN ml_label VARCHAR(20) DEFAULT NULL AFTER anomaly"),
    ("ml_confidence", "ALTER TABLE sensor_data ADD COLUMN ml_confidence FLOAT DEFAULT NULL AFTER ml_label"),
    ("ml_score",      "ALTER TABLE sensor_data ADD COLUMN ml_score FLOAT DEFAULT NULL AFTER ml_confidence"),
    ("ml_reason",     "ALTER TABLE sensor_data ADD COLUMN ml_reason VARCHAR(255) DEFAULT NULL AFTER ml_score"),
    ("latency_ms",    "ALTER TABLE sensor_data ADD COLUMN latency_ms FLOAT DEFAULT NULL AFTER ml_reason"),
    ("adaptive_sf",   "ALTER TABLE sensor_data ADD COLUMN adaptive_sf INT DEFAULT NULL AFTER latency_ms"),
    ("distance_rank", "ALTER TABLE sensor_data ADD COLUMN distance_rank INT DEFAULT NULL AFTER adaptive_sf"),
    ("pdr_local",     "ALTER TABLE sensor_data ADD COLUMN pdr_local FLOAT DEFAULT 100.0 AFTER distance_rank"),
    ("acked",         "ALTER TABLE sensor_data ADD COLUMN acked TINYINT(1) DEFAULT 1 AFTER pdr_local"),
]

added = []
skipped = []
for col, sql in migrations:
    if col not in existing:
        cur.execute(sql)
        added.append(col)
        print(f"  ✅ Added: {col}")
    else:
        skipped.append(col)
        print(f"  ⏭  Skipped (exists): {col}")

conn.commit()
print(f"\nDone. Added {len(added)} columns, skipped {len(skipped)}.")
print(f"Added: {added}")
conn.close()
