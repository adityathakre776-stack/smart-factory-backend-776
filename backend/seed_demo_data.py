from flask import Flask
from flask_mysqldb import MySQL
from datetime import datetime, timedelta
from config import Config

app = Flask(__name__)
app.config.from_object(Config)
mysql = MySQL(app)


DEMO_ROWS = [
    ("GATEWAY_01", "NODE_01", 1.9, 0, 910, 350, 62.0, 0),
    ("GATEWAY_01", "NODE_02", 2.1, 0, 980, 420, 58.0, 1),
    ("GATEWAY_01", "NODE_03", 2.4, 0, 1220, 510, 55.0, 1),
    ("GATEWAY_01", "NODE_02", 2.2, 1, 1380, 650, 49.0, 1),
    ("GATEWAY_01", "NODE_01", 2.8, 0, 1060, 390, 23.0, 1),
]


with app.app_context():
    cur = mysql.connection.cursor()
    now = datetime.now()
    for i, row in enumerate(DEMO_ROWS):
        ts = now - timedelta(minutes=(len(DEMO_ROWS) - i) * 2)
        cur.execute(
            """
            INSERT INTO sensor_data
            (gateway_id,node_id,vib,flame,smoke,gas,distance,anomaly,created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (*row, ts),
        )
    mysql.connection.commit()
    cur.close()
    print("Demo rows inserted:", len(DEMO_ROWS))
