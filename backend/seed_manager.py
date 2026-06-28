from flask import Flask
from flask_mysqldb import MySQL
from werkzeug.security import generate_password_hash
from config import Config

app = Flask(__name__)
app.config.from_object(Config)
mysql = MySQL(app)

with app.app_context():
    cursor = mysql.connection.cursor()

    email = "manager@smartfactory.ai"

    cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
    if cursor.fetchone():
        print("Manager already exists")
    else:
        cursor.execute(
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
        mysql.connection.commit()
        print("Manager account created")

    cursor.close()
