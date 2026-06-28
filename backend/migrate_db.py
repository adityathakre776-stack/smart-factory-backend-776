from flask import Flask
from flask_mysqldb import MySQL
from werkzeug.security import generate_password_hash
import datetime as dt
from config import Config

app = Flask(__name__)
app.config.from_object(Config)
mysql = MySQL(app)

def run_migrations():
    with app.app_context():
        cur = mysql.connection.cursor()
        
        # 1. Create tables if not exists
        print("Creating tables if they don't exist...")
        
        # Table: users
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                company_name  VARCHAR(120)  NOT NULL,
                full_name     VARCHAR(120)  NOT NULL,
                email         VARCHAR(120)  NOT NULL UNIQUE,
                password_hash VARCHAR(255)  NOT NULL,
                role          ENUM('manager','worker') NOT NULL DEFAULT 'worker',
                assigned_node VARCHAR(20)   DEFAULT NULL,
                created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Table: sensor_data
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sensor_data (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                gateway_id      VARCHAR(40)  NOT NULL DEFAULT 'GATEWAY_01',
                node_id         VARCHAR(40)  NOT NULL,
                vib             FLOAT        DEFAULT 0,
                flame           TINYINT(1)   DEFAULT 0,
                smoke           FLOAT        DEFAULT 0,
                gas             FLOAT        DEFAULT 0,
                distance        FLOAT        DEFAULT 0,
                anomaly         TINYINT(1)   DEFAULT 0,
                packet_seq      INT          DEFAULT 0,
                lat             FLOAT        DEFAULT NULL,
                lon             FLOAT        DEFAULT NULL,
                ax              FLOAT        DEFAULT 0,
                ay              FLOAT        DEFAULT 0,
                az              FLOAT        DEFAULT 0,
                comm_status     VARCHAR(20)  DEFAULT 'OK',
                gateway_rssi    FLOAT        DEFAULT 0,
                gateway_snr     FLOAT        DEFAULT 0,
                retry_count_col INT          DEFAULT 0,
                created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_sensor_node_time (node_id, created_at DESC)
            )
        """)
        
        # Table: camera_images
        cur.execute("""
            CREATE TABLE IF NOT EXISTS camera_images (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                filename   VARCHAR(255) NOT NULL,
                created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Table: alerts
        cur.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                node_id    VARCHAR(40)  NOT NULL,
                type       VARCHAR(60)  NOT NULL,
                severity   VARCHAR(20)  NOT NULL DEFAULT 'warning',
                message    TEXT,
                resolved   TINYINT(1)   DEFAULT 0,
                created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Table: nodes
        cur.execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                company_id  INT          DEFAULT 1,
                name        VARCHAR(40)  NOT NULL,
                x_position  FLOAT        DEFAULT 0,
                y_position  FLOAT        DEFAULT 0,
                status      VARCHAR(20)  DEFAULT 'online',
                zone        VARCHAR(60)  DEFAULT '',
                last_seen   DATETIME     DEFAULT CURRENT_TIMESTAMP,
                voltage     FLOAT        DEFAULT 0,
                temperature FLOAT        DEFAULT 0,
                vibration   FLOAT        DEFAULT 0
            )
        """)
        
        # 2. Add missing columns to sensor_data
        print("Checking for missing columns in sensor_data...")
        cur.execute("DESCRIBE sensor_data")
        existing_cols = [r[0] for r in cur.fetchall()]
        
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
        
        for col, sql in migrations:
            if col not in existing_cols:
                cur.execute(sql)
                print(f"  ✅ Added column: {col}")
        
        # 3. Seed Manager Account
        print("Seeding manager user...")
        email = "manager@smartfactory.ai"
        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            print("  Manager already exists")
        else:
            cur.execute(
                """
                INSERT INTO users (company_name, full_name, email, password_hash, role)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    "SmartFactory HQ",
                    "Factory Manager",
                    email,
                    generate_password_hash("Manager@123"),
                    "manager",
                ),
            )
            print("  ✅ Manager account created (manager@smartfactory.ai / Manager@123)")
            
        # 4. Seed Worker Accounts
        print("Seeding worker users...")
        workers = [
            {
                "company_name": "SmartFactory HQ",
                "full_name": "Worker 1",
                "email": "worker1@smartfactory.ai",
                "password": "Worker@123",
                "assigned_node": "NODE_01",
            },
            {
                "company_name": "SmartFactory HQ",
                "full_name": "Worker 2",
                "email": "worker2@smartfactory.ai",
                "password": "Worker@123",
                "assigned_node": "NODE_02",
            },
            {
                "company_name": "SmartFactory HQ",
                "full_name": "Worker 3",
                "email": "worker3@smartfactory.ai",
                "password": "Worker@123",
                "assigned_node": "NODE_03",
            },
        ]
        
        for w in workers:
            cur.execute("SELECT id FROM users WHERE email = %s", (w["email"],))
            if cur.fetchone():
                cur.execute(
                    """
                    UPDATE users
                    SET company_name=%s, full_name=%s, password_hash=%s, role='worker', assigned_node=%s
                    WHERE email=%s
                    """,
                    (w["company_name"], w["full_name"], generate_password_hash(w["password"]), w["assigned_node"], w["email"]),
                )
                print(f"  Worker updated: {w['email']}")
            else:
                cur.execute(
                    """
                    INSERT INTO users (company_name, full_name, email, password_hash, role, assigned_node)
                    VALUES (%s, %s, %s, %s, 'worker', %s)
                    """,
                    (w["company_name"], w["full_name"], w["email"], generate_password_hash(w["password"]), w["assigned_node"]),
                )
                print(f"  ✅ Worker created: {w['email']} (password: Worker@123)")
                
        # 5. Seed Nodes
        print("Seeding factory nodes for Digital Twin...")
        nodes_to_seed = [
            {
                "name": "NODE_01",
                "x_position": 25.0,
                "y_position": 22.0,
                "zone": "ZONE_1 (Solvent Mixing)",
                "status": "normal",
                "voltage": 3.3,
                "temperature": 24.5,
                "vibration": 0.05
            },
            {
                "name": "NODE_02",
                "x_position": 72.0,
                "y_position": 22.0,
                "zone": "ZONE_2 (Drum Filling)",
                "status": "normal",
                "voltage": 3.3,
                "temperature": 26.2,
                "vibration": 0.08
            },
            {
                "name": "NODE_03",
                "x_position": 50.0,
                "y_position": 55.0,
                "zone": "ZONE_3 (Storage & Dispatch)",
                "status": "normal",
                "voltage": 3.3,
                "temperature": 23.8,
                "vibration": 0.04
            }
        ]
        
        for n in nodes_to_seed:
            cur.execute("SELECT id FROM nodes WHERE name = %s", (n["name"],))
            if cur.fetchone():
                cur.execute(
                    """
                    UPDATE nodes
                    SET x_position=%s, y_position=%s, zone=%s, status=%s, voltage=%s, temperature=%s, vibration=%s
                    WHERE name=%s
                    """,
                    (n["x_position"], n["y_position"], n["zone"], n["status"], n["voltage"], n["temperature"], n["vibration"], n["name"]),
                )
                print(f"  Node updated: {n['name']}")
            else:
                cur.execute(
                    """
                    INSERT INTO nodes (company_id, name, x_position, y_position, status, zone, voltage, temperature, vibration)
                    VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (n["name"], n["x_position"], n["y_position"], n["status"], n["zone"], n["voltage"], n["temperature"], n["vibration"]),
                )
                print(f"  ✅ Node created: {n['name']}")
                
        mysql.connection.commit()
        cur.close()
        print("Database migrations and seeding completed successfully!")

if __name__ == "__main__":
    run_migrations()
