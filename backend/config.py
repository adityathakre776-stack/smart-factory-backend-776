import os
from pathlib import Path
from dotenv import load_dotenv

# Always load .env from this file's directory (backend/), not from process CWD.
# Must use __file__ (two underscores before and after "file") — not "file_".
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir / ".env")

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY")

    MYSQL_HOST = os.getenv("MYSQL_HOST")
    MYSQL_USER = os.getenv("MYSQL_USER")
    MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
    MYSQL_DB = os.getenv("MYSQL_DB")
    # Required for Flask-JWT-Extended; if .env was missing, login would still return a token signed with a fallback and verification would fail → 422 on every protected route.
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or "dev-jwt-secret-change-in-production"
    # Naive MySQL DATETIME values are interpreted as this zone when serializing to ISO JSON (e.g. Asia/Kolkata). Use UTC if your DB stores UTC.
    APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
