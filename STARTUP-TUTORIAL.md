# HIUSA Startup Tutorial

This guide explains how to run the complete HIUSA development stack on one Windows computer and make the application available to phones and computers on the same trusted local network.

For dependency installation, database creation, demo accounts, and the complete development setup, see [README.md](README.md). For production or internet-facing deployment, use [EC2-DEPLOYMENT.md](EC2-DEPLOYMENT.md) instead.

## Services used by HIUSA

The host computer runs these processes:

| Process | Port | LAN access | Purpose |
|---|---:|---|---|
| React and Vite | `5173` | Yes | Browser interface |
| Laravel API | `8000` | Yes | Authentication, data, uploads, and business workflows |
| FastAPI AI service | `8001` | No | Private decision-support calculations called by Laravel |
| SourceAFIS matcher | `9100` | No | Private fingerprint matching called by Laravel |

Only ports `5173` and `8000` should be opened to the local network. Do not expose the AI service, fingerprint matcher, database, or development server to the internet.

Local jobs use `QUEUE_CONNECTION=sync`, so Laravel handles them immediately without a separate queue worker. The scheduler is intentionally not part of this local startup; scheduled publishing and reminder commands run only when someone deliberately starts a scheduler in another environment.

## Before starting

Make sure:

- The host computer and client devices are connected to the same non-guest Wi-Fi or Ethernet network.
- PHP, Composer, Node.js, npm, Python 3.11+, and the .NET 9 SDK are installed.
- MySQL is running if the Laravel environment uses MySQL. SQLite does not require a separate database process.
- The initial installation steps in [README.md](README.md) have been completed.
- The host computer will remain powered on and awake while HIUSA is in use.

## Step 1: Find the host computer's IPv4 address

Open PowerShell on the computer that will run HIUSA:

```powershell
ipconfig
```

Find the active Wi-Fi or Ethernet adapter and note its `IPv4 Address`. It will normally look like `192.168.1.102` or `10.0.0.25`.

The examples below use `192.168.1.102`. Replace it with the actual address of the host computer.

Do not use these addresses:

- `127.0.0.1`, because it is the local loopback address.
- `169.254.x.x`, because it usually indicates a network configuration problem.
- An address belonging to a virtual, Bluetooth, VPN, or disconnected adapter.

## Step 2: Configure HIUSA for the LAN address

From the repository root, let the setup script detect the active Wi-Fi or Ethernet IPv4 address:

```powershell
Set-Location "C:\Users\YourName\Documents\Hiusa-FULL"
.\scripts\setup-env.ps1 -HostAddress auto
```

The script prints the detected address. Confirm it matches the active adapter shown by `ipconfig`. You may pass an address explicitly, but the script rejects an IPv4 address that is not assigned to this computer. Do not copy the example `192.168.1.102` unless it is actually your address.

The setup script:

- configures Laravel's application and frontend URLs;
- adds the LAN frontend addresses to the CORS allowlist;
- configures the React API URL to follow the hostname used to open Vite, preventing a later DHCP address change from leaving requests pointed at the old host;
- synchronizes the Laravel/FastAPI service key;
- synchronizes the Laravel/fingerprint-matcher service key;
- selects the synchronous local queue driver so no worker terminal is needed; and
- preserves existing environment files and database settings unless `-Force` is explicitly supplied.

Do not use `-Force` on an existing installation unless replacing its local environment files is intentional.

If PHP dependencies were installed after running the setup script, also run:

```powershell
Set-Location server
php artisan key:generate
php artisan config:clear
```

## Step 3: Configure Windows Firewall

First, confirm that the current network is trusted. Do not change a school, cafe, hotel, or other untrusted public network to Private.

Open PowerShell **as Administrator** and run. Being in `C:\Windows\System32` does not prove the shell is elevated. From a normal PowerShell window, this command opens an elevated one after a UAC prompt:

```powershell
Start-Process powershell -Verb RunAs
```

Then run:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

If the active connection is Ethernet, replace `Wi-Fi` with its interface name. You can see the names with:

```powershell
Get-NetConnectionProfile
```

Create firewall rules restricted to the Private profile and local subnet. Run each command as one line to avoid PowerShell line-continuation problems:

```powershell
New-NetFirewallRule -DisplayName "HIUSA Frontend 5173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName "HIUSA Laravel API 8000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private -RemoteAddress LocalSubnet
```

If rules with these names already exist, inspect them instead of creating duplicates:

```powershell
Get-NetFirewallRule -DisplayName "HIUSA*"
```

Never create router port-forwarding rules for this local development setup.

## Step 4: Start the complete stack

Open four PowerShell terminals. Run each command from the repository root unless the command changes directory.

### Terminal 1: FastAPI AI service

```powershell
Set-Location ai-service
$env:HIUSA_AI_HOST = "127.0.0.1"
.\.venv\Scripts\python.exe run.py
```

The temporary environment override keeps port `8001` private to the host computer. Laravel reaches it through `http://127.0.0.1:8001`.

### Terminal 2: SourceAFIS fingerprint matcher

```powershell
Set-Location fingerprint-matcher
.\start.ps1
```

The matcher listens privately at `http://127.0.0.1:9100`.

### Terminal 3: Laravel API

```powershell
Set-Location server
php artisan config:clear
php artisan serve --host=0.0.0.0 --port=8000
```

The `--host=0.0.0.0` option is required so other devices can reach Laravel.

### Terminal 4: React frontend

```powershell
Set-Location client
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

Using `--strictPort` prevents Vite from silently moving to another port that is missing from the CORS and firewall configuration.

Keep all four terminals open. Press `Ctrl+C` in a terminal to stop its process cleanly.

## Step 5: Verify the services on the host

Run these checks in another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
Invoke-RestMethod http://127.0.0.1:9100/health
Test-NetConnection 127.0.0.1 -Port 8000
Test-NetConnection 127.0.0.1 -Port 5173
```

The health requests should return an `ok` status, and both connection tests should report:

```text
TcpTestSucceeded : True
```

You can also check all listening ports:

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object LocalPort -in 5173,8000,8001,9100 |
  Sort-Object LocalPort |
  Format-Table LocalAddress,LocalPort,OwningProcess
```

Expected bindings:

- `5173` and `8000`: `0.0.0.0` or the host's LAN address.
- `8001` and `9100`: `127.0.0.1`.

## Step 6: Connect from another device

On a phone or computer connected to the same network, open:

```text
http://192.168.1.102:5173
```

Replace the example address with the host computer's actual IPv4 address.

Do not enter `localhost` on another device. On that device, `localhost` refers to the device itself, not the HIUSA host computer.

From another Windows computer, test both exposed ports with:

```powershell
Test-NetConnection 192.168.1.102 -Port 5173
Test-NetConnection 192.168.1.102 -Port 8000
```

Both tests should report `TcpTestSucceeded : True`.

## Daily startup checklist

After the one-time LAN and firewall setup:

1. Confirm the host computer still has the configured IPv4 address.
2. Start MySQL when the application uses MySQL.
3. Start the AI service.
4. Start the fingerprint matcher.
5. Start Laravel with `--host=0.0.0.0 --port=8000`.
6. Start Vite with `--host=0.0.0.0 --port=5173 --strictPort`.
7. Open `http://HOST_IP:5173` from each client device.

## Fingerprint reader requirements

The browser workstation using the fingerprint reader must have:

- a supported DigitalPersona reader;
- the DigitalPersona device driver; and
- HID Authentication Device Client.

Install these components on the computer where the reader is physically connected and where the browser is running. The private SourceAFIS matcher still runs on the main HIUSA host computer.

Enrollment uses four captures of one finger. Attendance identification uses one scan.

## Email behavior

The default local configuration uses:

```dotenv
MAIL_MAILER=log
```

Laravel processes local email jobs synchronously, but messages are written to `server/storage/logs/laravel.log` instead of being delivered. Configure a real mail provider in `server/.env` if actual delivery is needed.

Do not commit mail credentials or any other `.env` secrets.

## Troubleshooting

### The frontend opens on the host but not on another device

- Confirm both devices are connected to the same non-guest network.
- Confirm the URL uses the host IPv4 address, not `localhost`.
- Confirm Vite reports port `5173`.
- Confirm the network profile is Private and the firewall rule is enabled.
- Check whether the router has wireless isolation, AP isolation, or client isolation enabled.
- Some school and public networks intentionally prevent devices from reaching each other.

### The page opens but login or API requests fail

- In browser developer tools, confirm requests target `http://CURRENT_HOST_IP:8000/api`, not a previous LAN address.
- Confirm Laravel was started with `--host=0.0.0.0 --port=8000`.
- Run `Test-NetConnection HOST_IP -Port 8000` from the client computer.
- Rerun `setup-env.ps1 -HostAddress auto`.
- Run `php artisan config:clear` and restart Laravel.
- Restart Vite after changing `client/.env`.

### A CORS error appears

Verify that `server/.env` contains the client address in `FRONTEND_URL` or `FRONTEND_URLS`, for example:

```dotenv
FRONTEND_URL=http://192.168.1.102:5173
```

The recommended fix is to rerun:

```powershell
.\scripts\setup-env.ps1 -HostAddress auto
```

Then clear Laravel's configuration cache and restart it:

```powershell
Set-Location server
php artisan config:clear
```

### AI-backed features use fallback calculations

- Confirm the AI service terminal is still running.
- Open `http://127.0.0.1:8001/health` on the host.
- Confirm `HIUSA_AI_SERVICE_ENABLED=true` in `server/.env`.
- Confirm `HIUSA_AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env`.
- Rerun `setup-env.ps1` if the Laravel and Python service keys do not match.

### Fingerprint matching is unavailable

- Confirm the matcher terminal is running.
- Open `http://127.0.0.1:9100/health` on the host.
- Confirm the DigitalPersona driver and HID Authentication Device Client are installed on the scanner workstation.
- Rerun `setup-env.ps1` if the Laravel and matcher keys do not match.

### New notifications are not visible yet

- Refresh the browser to retrieve the latest notifications.
- Confirm `QUEUE_CONNECTION=sync` in `server/.env`, then run `php artisan config:clear` and restart Laravel.
- Remember that `MAIL_MAILER=log` does not send real email.
- Scheduled announcements and reminders do not run automatically in this four-service local setup.

### The host IPv4 address changed

Home routers can assign a different address after reconnecting or restarting. Find the new address with `ipconfig`, rerun `setup-env.ps1`, and restart Laravel and Vite.

For a stable demonstration setup, reserve the host computer's address in the router's DHCP settings.

## Security limitations

This tutorial starts development servers and is intended only for a trusted local network.

- Do not use this setup as a public deployment.
- Do not enable router port forwarding.
- Do not expose ports `8001`, `9100`, `3306`, or other database ports.
- Do not use seeded demo passwords for real users or real data.
- Do not run the application on an untrusted Public network.
- Use the documented EC2/Docker deployment path for internet-facing use.




.\scripts\setup-env.ps1 -HostAddress auto

# Laravel
php artisan serve --host=0.0.0.0 --port=8000

# React/Vite
npm run dev -- --host 0.0.0.0 --port=5173 --strictPort

