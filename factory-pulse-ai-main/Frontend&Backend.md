---

# Run Guide (Frontend + Backend)

Yeh guide batata hai ki is project ka frontend (Vite + React) aur backend (Flask) local machine par kaise run karein.

## Project Structure
- **Frontend**: `factory-pulse-ai-main/`
- **Backend**: `backend/`

## Prerequisites
- **Node.js** (v18+ recommended) aur npm
- **Python 3.10+**
- **MySQL Server** installed and running
- Windows users: MySQL client build tools (for `mysqlclient`) ki zarurat ho sakti hai

---

## Backend (Flask) Setup
Directory: `backend/`

### 1) Python Virtual Env (recommended)
```bash
# PowerShell / CMD
cd backend
python -m venv .venv
.venv\Scripts\activate
```

### 2) Dependencies install karein
Is backend me yeh packages use ho rahe hain (imports se):
- Flask
- Flask-Cors
- Flask-MySQLdb (requires mysqlclient)
- Flask-JWT-Extended
- python-dotenv

Install:
```bash
pip install Flask Flask-Cors Flask-MySQLdb Flask-JWT-Extended python-dotenv
```

Agar `Flask-MySQLdb` install me issue aaye to ensure karein ki:
- MySQL installed ho
- Visual C++ Build Tools installed ho (Windows ke liye)
- Alternatively: agar aap `mysqlclient` build nahi kar paa rahe, to aapko environment setup karna hoga. (Project current code `flask_mysqldb` expect karta hai.)

### 3) .env file banayein
`backend/` me `.env` create karke yeh values set karein (see `backend/config.py`):
```env
SECRET_KEY=your_flask_secret
JWT_SECRET_KEY=your_jwt_secret

MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DB=your_database_name
```
Ensure karein ki MySQL me `your_database_name` exist karta ho aur required tables present ho (`users`, `sensor_data`, `camera_images`, `nodes`).

### 4) Backend run karein
```bash
cd backend
python app.py
```
- Server default: `http://localhost:5000`
- CORS enabled hai (`CORS(app)`), to frontend se calls allow hongi.

---

## Frontend (Vite + React) Setup
Directory: `factory-pulse-ai-main/`

### 1) Dependencies install
```bash
cd factory-pulse-ai-main
npm i
```

### 2) Dev server run karein
```bash
npm run dev
```
Default Vite dev server `http://localhost:5173` pe chalega.

---

## API Base URL configure karein
Frontend backend ko call karta hai do jagah par:

- `src/api/api.ts` me Axios base URL set hai:
  - File: `factory-pulse-ai-main/src/api/api.ts`
  - Current:
    ```ts
    baseURL: "http://10.244.34.24:5000/api"
    ```
  - Local development ke liye ise update karein:
    ```ts
    baseURL: "http://localhost:5000/api"
    ```

- `src/pages/SignUp.tsx` me direct fetch use ho raha hai:
  - File: `factory-pulse-ai-main/src/pages/SignUp.tsx`
  - Current:
    ```ts
    fetch("http://localhost:5000/api/signup", { ... })
    ```
  - Isse aap ke backend host/port ke hisaab se update rakhein. Recommended: is call ko bhi Axios helper (`API`) use karke centralize kar dein future me.

Ensure karein ki dono places same backend URL point karein. Agar backend kisi aur host/IP par chal raha ho to us IP/port use karein.

---

## Common Ports
- Backend (Flask): `5000`
- Frontend (Vite): `5173`

---

## Quick Start (Summary)
1) Backend:
   - `cd backend`
   - `.env` create karein (MySQL creds & secrets)
   - `pip install Flask Flask-Cors Flask-MySQLdb Flask-JWT-Extended python-dotenv`
   - `python app.py` (http://localhost:5000)
2) Frontend:
   - `cd factory-pulse-ai-main`
   - `npm i`
   - `src/api/api.ts` baseURL ko `http://localhost:5000/api` kar dein
   - (Optional) `SignUp.tsx` ke fetch URL ko bhi same host/port par set rakhein
   - `npm run dev` (http://localhost:5173)

---

## Troubleshooting
- **MySQL client build error on Windows (mysqlclient / Flask-MySQLdb):**
  - Ensure MySQL installed and on PATH
  - Install Visual C++ Build Tools
  - Re-run `pip install Flask-MySQLdb`
- **CORS error:** Backend already uses `CORS(app)`. Verify correct `baseURL` and that backend is reachable.
- **Auth failures:** Make sure `.env` me `JWT_SECRET_KEY` set ho and frontend token storage/headers (`Authorization: Bearer <token>`) working (see `src/api/api.ts`).
