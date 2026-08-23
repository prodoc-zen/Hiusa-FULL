# HIUSA AI Service

This standalone FastAPI service contains HIUSA's deterministic AI/decision-support features:

- OLS financial forecasting from monthly income and expense history
- rule-based budget availability, safe-spending, overspending, and deficit advice
- weighted task delegation for active SBO Officers

It is deliberately separate from `client/` and `server/`, so it can be deployed as an independent Python API.

## Run locally (PowerShell)

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Open .env and make HIUSA_AI_SERVICE_KEY match server/.env.
python run.py
```

Open `http://127.0.0.1:8001/docs` for interactive API documentation. The health check is `GET /health`. Protected requests must include `X-AI-Service-Key` when `HIUSA_AI_SERVICE_KEY` is configured.

In `/docs`, click **Authorize** and enter the same key before trying protected endpoints. A missing or different key correctly returns `401 Unauthorized`.

Configure the same key and URL in `server/.env`:

```env
HIUSA_AI_SERVICE_ENABLED=true
HIUSA_AI_SERVICE_URL=http://127.0.0.1:8001
HIUSA_AI_SERVICE_KEY=the-same-long-random-key-used-by-python
HIUSA_AI_SERVICE_TIMEOUT=10
```

Laravel uses this service when it is reachable and safely falls back to the existing deterministic calculations if it is unavailable.

## Test

```powershell
cd ai-service
python -m pip install -r requirements-dev.txt
python -m pytest
```

## Endpoints

- `POST /api/v1/financial-forecast`
- `POST /api/v1/budget-advice`
- `POST /api/v1/task-delegation`
- `GET /health`

## Manual UI click-through

1. Keep the Python API, Laravel API, and Vite frontend running in three terminals.
2. Open `http://localhost:5173` and sign in as an Admin.
3. Make sure the ledger contains income/expense records in at least two different months.
4. Open **Financial Management > Financial Insights** and click **Generate Forecast**. Confirm the new row shows predicted income, expense, balance, safe spend, and risk.
5. Open **Financial Management > Budget Allocation** and click **AI Advice** on a budget. Confirm the risk label and advisory note appear on that same budget.
6. Open **Task Management > Create Task**, enter a title and deadline, leave the officer blank, and submit. The highest-scoring eligible officer should be assigned automatically.
7. Open **Task Management > AI Delegation**. Confirm the assigned officer, final fit, component scores, and recommendation explanation are visible.

## Allow other computers on the same home network

Local IP addresses can change after reconnecting or restarting the router, so confirm the host PC's address with:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' }
```

Start the three services so they listen on the network, not only on localhost:

```powershell
# Terminal 1: Python
cd "C:\path\to\Hiusa-FULL\ai-service"
.\.venv\Scripts\Activate.ps1
python run.py

# Terminal 2: Laravel
cd "C:\path\to\Hiusa-FULL\server"
php artisan config:clear
php artisan serve --host=0.0.0.0 --port=8000

# Terminal 3: React/Vite
cd "C:\path\to\Hiusa-FULL\client"
npm run dev
```

Run this once in an **Administrator PowerShell** to allow those ports through Windows Firewall on private networks:

```powershell
New-NetFirewallRule -DisplayName "HIUSA Home Network" -Direction Inbound -Protocol TCP -LocalPort 5173,8000,8001 -Action Allow -Profile Private
```

From another computer connected to the same router, use:

- Frontend: `http://YOUR_HOST_IP:5173`
- Laravel API: `http://YOUR_HOST_IP:8000/api`
- Python documentation: `http://YOUR_HOST_IP:8001/docs`

On a new PC, run `.\scripts\setup-env.ps1 -HostAddress YOUR_HOST_IP -PromptForGroqKey` from the project root. Laravel should continue using `HIUSA_AI_SERVICE_URL=http://127.0.0.1:8001` while Python and Laravel run on the same computer. Do not configure router port forwarding; these development servers are intended only for the trusted home network.
