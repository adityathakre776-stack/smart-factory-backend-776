from flask import Flask
from flask_mysqldb import MySQL
from werkzeug.security import generate_password_hash

from config import Config

app = Flask(__name__)
app.config.from_object(Config)
mysql = MySQL(app)


WORKERS = [
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


def ensure_assigned_node_column(cursor):
    cursor.execute("SHOW COLUMNS FROM users LIKE 'assigned_node'")
    if cursor.fetchone():
        return

    cursor.execute(
        """
        ALTER TABLE users
        ADD COLUMN assigned_node VARCHAR(20) NULL
        AFTER role
        """
    )
    print("Added users.assigned_node column")


def upsert_worker(cursor, worker):
    cursor.execute("SELECT id FROM users WHERE email=%s", (worker["email"],))
    row = cursor.fetchone()

    if row:
        cursor.execute(
            """
            UPDATE users
            SET company_name=%s,
                full_name=%s,
                password_hash=%s,
                role='worker',
                assigned_node=%s
            WHERE email=%s
            """,
            (
                worker["company_name"],
                worker["full_name"],
                generate_password_hash(worker["password"]),
                worker["assigned_node"],
                worker["email"],
            ),
        )
        print(f"Updated {worker['email']} -> {worker['assigned_node']}")
    else:
        cursor.execute(
            """
            INSERT INTO users (company_name, full_name, email, password_hash, role, assigned_node)
            VALUES (%s, %s, %s, %s, 'worker', %s)
            """,
            (
                worker["company_name"],
                worker["full_name"],
                worker["email"],
                generate_password_hash(worker["password"]),
                worker["assigned_node"],
            ),
        )
        print(f"Created {worker['email']} -> {worker['assigned_node']}")


with app.app_context():
    cursor = mysql.connection.cursor()
    try:
        ensure_assigned_node_column(cursor)
        for worker in WORKERS:
            upsert_worker(cursor, worker)
        mysql.connection.commit()
        print("Worker seeding completed")
    except Exception as exc:
        mysql.connection.rollback()
        print(f"Worker seeding failed: {exc}")
        raise
    finally:
        cursor.close()
