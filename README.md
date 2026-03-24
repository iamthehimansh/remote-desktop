# PC Dashboard

A self-hosted remote PC management dashboard running on Windows 11, exposed securely to the internet via Cloudflare Tunnel at `pc.himansh.in`.

![Dashboard](https://img.shields.io/badge/Next.js-14-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-3.4-06b6d4)

## Features

### System Monitoring
- Real-time CPU, RAM, GPU (NVIDIA + iGPU), and disk usage
- Live charts (CPU, memory, network throughput) updating every 2 seconds
- Process table with sorting and search

### In-Browser Terminal
- Full terminal emulator via xterm.js + node-pty
- Multi-tab support with shell selection (PowerShell, CMD, WSL)
- Works locally and through Cloudflare Tunnel

### In-Browser Remote Desktop
- Apache Guacamole (Docker) for HTML5 RDP
- One-click start/stop from the dashboard
- Full Windows desktop in the browser

### File Manager
- Browse all drives (C:, H:, external USB)
- Upload, download, rename, delete files and folders
- Preview text files with inline editor
- Stream video/audio with seek controls
- PDF viewer, image preview (PNG, JPG, GIF, WebP, SVG)
- Drag-and-drop upload

### App Launcher
- Pre-configured apps: Jupyter Lab, VS Code Web, Open WebUI (Ollama)
- One-click launch with automatic DNS + Cloudflare Tunnel routing
- Auto-authentication pass-through (token in URL)
- Per-app credential management (username/password)
- Custom app support with configurable commands

### Port Forwarding
- Dynamically expose local ports as `*.himansh.in` subdomains
- Cloudflare API integration (no tunnel restart needed)
- Health check status indicators

### Authentication (Two-Layer)

**Layer 1 — Cloudflare Zero Trust**
- OTP email verification before reaching the dashboard
- 24-hour session duration

**Layer 2 — Dashboard Auth (three independent methods)**
- Password login
- Passkey (WebAuthn) — biometrics, security keys
- Google Authenticator (TOTP)
- Password change from Settings
- Passkey management (register, list, delete)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Runtime | Bun + Node.js |
| Styling | Tailwind CSS + shadcn/ui |
| Terminal | xterm.js + node-pty (WebSocket) |
| RDP | Apache Guacamole (Docker) |
| Monitoring | systeminformation |
| Auth | bcryptjs + JWT + WebAuthn + TOTP |
| Charts | Recharts |
| Tunnel | Cloudflare Tunnel (remote config) |

## Setup

### Prerequisites
- Windows 11 with Node.js, Bun, Docker Desktop
- Cloudflare account with a domain
- NVIDIA GPU (optional, for GPU monitoring)

### Install

```bash
git clone https://github.com/iamthehimansh/remote-desktop.git
cd remote-desktop
bun install
npm install node-pty
```

### Configure

```bash
# Set dashboard password
bun run set-password

# Edit .env.local with your Cloudflare credentials
# TUNNEL_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CLOUDFLARE_ACCOUNT_ID
```

### Run

```bash
# Terminal 1: Next.js dashboard (port 3005)
bun run dev

# Terminal 2: WebSocket terminal server (port 3006)
bun run server
```

### Production

```bash
bun run build
bun run start          # Dashboard on :3005
bun run server         # Terminal on :3006
```

The `scripts/start-dashboard.bat` auto-launches both on Windows login.

## Project Structure

```
src/
  app/
    api/           # API routes (auth, system, files, rdp, ports, apps)
    dashboard/     # Dashboard pages (overview, terminal, rdp, files, ports, apps, settings)
    login/         # Login page
  components/      # UI components (sidebar, header, charts, terminal, stat cards)
  hooks/           # Custom hooks (useSystemStats, useToast)
  lib/             # Utilities (auth, files, cloudflare, docker, system-info)
server/
  ws-server.ts     # Standalone WebSocket terminal server
scripts/
  set-password.ts  # CLI password setup
  start-dashboard.bat  # Windows auto-start script
  sync-tunnel-config.ps1  # Tunnel config sync
```

## Architecture

```
Browser → Cloudflare Edge → Cloudflare Tunnel → PC
                                                 ├─ :3005 Next.js Dashboard
                                                 ├─ :3006 WebSocket Terminal
                                                 ├─ :8080 Guacamole (RDP)
                                                 └─ :*    Dynamic port forwards
```

All traffic flows through Cloudflare Tunnel's outbound connection. No inbound firewall rules needed.

## License

Private project.
