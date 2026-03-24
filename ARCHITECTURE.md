# PC Dashboard — Complete Architecture & Implementation Guide

## Project overview

A self-hosted personal dashboard running on Windows 11 (RTX 5060 Ti machine), exposed securely to the internet via Cloudflare Tunnel at `pc.himansh.in`. The dashboard provides authenticated remote access to the PC including an in-browser SSH terminal, in-browser RDP (via Apache Guacamole), real-time system monitoring, a file manager, and dynamic port forwarding — all behind two layers of authentication.

**Owner**: Himansh (iamthehimanshraj@gmail.com)
**Domain**: `pc.himansh.in` (DNS managed via Cloudflare)
**Host OS**: Windows 11 with RTX 5060 Ti
**Package managers**: Bun (JS), uv (Python)
**Primary port**: 3005 (Next.js dashboard)

---

## Security architecture (two-layer auth)

### Layer 1 — Cloudflare Zero Trust Access

Every request to `*.pc.himansh.in` must pass through a Cloudflare Access policy before it even reaches the PC. This is the outermost gate.

**Configuration**:
- Create a Cloudflare Access Application in the Zero Trust dashboard
- Application domain: `*.pc.himansh.in` (wildcard covers all subdomains and the root)
- Policy type: "Allow"
- Authentication method: One-time PIN sent to `iamthehimanshraj@gmail.com` (or optionally GitHub/Google OAuth)
- Session duration: 24 hours (configurable)
- The Cloudflare Access JWT is set as a cookie (`CF_Authorization`) on every request that passes the gate

**What this gives us**: Even if someone discovers the tunnel URL, they cannot reach the dashboard without passing the Cloudflare OTP/SSO challenge. This protects every service behind the tunnel — dashboard, SSH WebSocket, Guacamole, and any dynamically forwarded ports.

### Layer 2 — Application-level JWT auth

The Next.js dashboard itself has its own login system. Even if Cloudflare Access is somehow bypassed (e.g., someone accesses localhost directly on the PC), they still need to authenticate.

**Implementation details**:

```
Auth flow:
  1. User hits pc.himansh.in → Cloudflare Access challenges them (OTP/SSO)
  2. User passes → reaches Next.js app at /login
  3. User enters dashboard password → POST /api/auth/login
  4. Server verifies password against bcrypt hash stored in .env
  5. Server issues HTTP-only, Secure, SameSite=Strict JWT cookie (name: "session")
  6. JWT payload: { sub: "admin", iat, exp } — expires in 7 days
  7. Every protected API route and page checks this JWT via middleware
  8. WebSocket upgrade requests also validate JWT from cookie before accepting
```

**Environment variables** (stored in `.env.local`, never committed):

```env
# Dashboard auth
DASHBOARD_PASSWORD_HASH=<bcrypt hash of chosen password>
JWT_SECRET=<random 64-char hex string>

# SSH config (for node-pty)
SSH_DEFAULT_SHELL=powershell.exe

# Guacamole
GUAC_HOST=localhost
GUAC_PORT=8080
RDP_PORT=3389

# File manager
FILE_MANAGER_ROOT=C:\Users\Himansh

# Cloudflare Tunnel
TUNNEL_ID=<from cloudflared tunnel create>
CLOUDFLARE_API_TOKEN=<API token with Zone:DNS:Edit and Account:Cloudflare Tunnel:Edit>
CLOUDFLARE_ACCOUNT_ID=<account ID>
CLOUDFLARE_ZONE_ID=<zone ID for himansh.in>
```

**Password setup utility**: Create a CLI script (`scripts/set-password.ts`) that:
1. Prompts for a password
2. Generates bcrypt hash (cost factor 12)
3. Generates a random JWT_SECRET
4. Writes both to `.env.local`
5. Prints confirmation

---

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 14 (App Router) | Dashboard frontend + API routes |
| Runtime | Bun | Package management, running Next.js |
| Styling | Tailwind CSS + shadcn/ui components | UI |
| Terminal (frontend) | @xterm/xterm + @xterm/addon-fit + @xterm/addon-web-links | In-browser terminal emulator |
| Terminal (backend) | node-pty + ws (WebSocket library) | PTY spawning + WebSocket transport |
| RDP in browser | Apache Guacamole (Docker) | HTML5 RDP gateway |
| System monitoring | systeminformation (npm) | CPU, RAM, disk, GPU, network stats |
| Auth | bcryptjs + jsonwebtoken + cookies | Password hashing + JWT sessions |
| File operations | Node.js fs/path APIs + formidable (upload parsing) | File manager backend |
| Tunnel | cloudflared (Windows service) | Secure tunnel to Cloudflare edge |
| Port forwarding | Cloudflare API (REST) + cloudflared tunnel config | Dynamic route management |
| Process control | node:child_process | Starting/stopping Guacamole, managing services |

---

## Directory structure

```
pc-dashboard/
├── .env.local                      # Secrets (never commit)
├── .gitignore
├── bun.lockb
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── components.json                 # shadcn/ui config
│
├── scripts/
│   ├── set-password.ts             # Password setup utility
│   ├── setup-tunnel.ps1            # Cloudflare Tunnel setup script
│   └── install-services.ps1        # Windows service installation (OpenSSH, cloudflared)
│
├── cloudflared/
│   └── config.yml                  # Tunnel configuration (generated/managed by app)
│
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with auth provider
│   │   ├── page.tsx                # Redirect to /dashboard or /login
│   │   │
│   │   ├── login/
│   │   │   └── page.tsx            # Login page
│   │   │
│   │   ├── dashboard/
│   │   │   ├── layout.tsx          # Dashboard shell (sidebar + header)
│   │   │   ├── page.tsx            # Overview / system monitor (default view)
│   │   │   ├── terminal/
│   │   │   │   └── page.tsx        # In-browser SSH terminal
│   │   │   ├── rdp/
│   │   │   │   └── page.tsx        # RDP viewer (Guacamole iframe + controls)
│   │   │   ├── files/
│   │   │   │   └── page.tsx        # File manager
│   │   │   └── ports/
│   │   │       └── page.tsx        # Port forwarding manager
│   │   │
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts      # POST: verify password, issue JWT
│   │       │   ├── logout/route.ts     # POST: clear JWT cookie
│   │       │   └── me/route.ts         # GET: check auth status
│   │       │
│   │       ├── system/
│   │       │   ├── stats/route.ts      # GET: CPU, RAM, disk, network, GPU
│   │       │   ├── processes/route.ts  # GET: running processes list
│   │       │   └── stream/route.ts     # GET: SSE endpoint for real-time stats
│   │       │
│   │       ├── files/
│   │       │   ├── list/route.ts       # GET: directory listing
│   │       │   ├── read/route.ts       # GET: file content / download
│   │       │   ├── write/route.ts      # POST: create/update file
│   │       │   ├── upload/route.ts     # POST: multipart file upload
│   │       │   ├── delete/route.ts     # DELETE: remove file/folder
│   │       │   ├── rename/route.ts     # PATCH: rename/move file
│   │       │   └── mkdir/route.ts      # POST: create directory
│   │       │
│   │       ├── rdp/
│   │       │   ├── start/route.ts      # POST: start Guacamole container
│   │       │   ├── stop/route.ts       # POST: stop Guacamole container
│   │       │   └── status/route.ts     # GET: Guacamole running status
│   │       │
│   │       └── ports/
│   │           ├── list/route.ts       # GET: currently forwarded ports
│   │           ├── forward/route.ts    # POST: add new port forward
│   │           └── remove/route.ts     # DELETE: remove port forward
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives (button, card, input, etc.)
│   │   ├── sidebar.tsx             # Dashboard sidebar navigation
│   │   ├── header.tsx              # Top bar with user info + logout
│   │   ├── system-monitor.tsx      # Real-time stats cards + charts
│   │   ├── terminal-view.tsx       # xterm.js wrapper component
│   │   ├── rdp-viewer.tsx          # Guacamole iframe + start/stop controls
│   │   ├── file-browser.tsx        # File manager with tree + grid views
│   │   ├── port-manager.tsx        # Port forwarding UI
│   │   └── login-form.tsx          # Login form component
│   │
│   ├── lib/
│   │   ├── auth.ts                 # JWT sign/verify, middleware helper
│   │   ├── cloudflare.ts           # Cloudflare API client (DNS + Tunnel routes)
│   │   ├── tunnel-config.ts        # Read/write cloudflared config.yml
│   │   ├── docker.ts               # Docker commands for Guacamole lifecycle
│   │   ├── system-info.ts          # systeminformation wrapper with caching
│   │   └── utils.ts                # Shared utilities
│   │
│   ├── hooks/
│   │   ├── use-auth.ts             # Auth context hook
│   │   ├── use-system-stats.ts     # SSE hook for real-time stats
│   │   └── use-websocket.ts        # WebSocket hook for terminal
│   │
│   └── middleware.ts               # Next.js middleware: JWT check on /dashboard/*, /api/*
│
└── server/
    └── ws-server.ts                # Standalone WebSocket server for terminal (node-pty)
                                    # Runs alongside Next.js on port 3006
```

---

## Feature specifications

### 1. Login page (`/login`)

**UI**: Full-screen centered card with:
- App title/logo ("PC Dashboard" or custom branding)
- Single password field (no username — single-user system)
- "Sign in" button
- Error shake animation on wrong password
- After successful login, redirect to `/dashboard`

**Design**: Dark, minimal, terminal-inspired aesthetic. Monospace font for the password field. Subtle grid background pattern. The login page should feel like you're accessing a secure system.

**API — POST /api/auth/login**:
```typescript
// Request body
{ password: string }

// Success response (200)
// Sets HTTP-only cookie "session" with JWT
{ success: true }

// Failure response (401)
{ error: "Invalid password" }
```

**Implementation**:
1. Receive password from request body
2. Compare with `DASHBOARD_PASSWORD_HASH` using `bcryptjs.compare()`
3. If match: sign JWT with `JWT_SECRET`, set as HTTP-only cookie with `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age=604800` (7 days)
4. If no match: return 401 with generic error (never reveal if password is close)

### 2. Dashboard layout (`/dashboard/layout.tsx`)

**Structure**: Collapsible sidebar (left) + header (top) + main content area.

**Sidebar items** (icons + labels):
- Overview (home icon) — `/dashboard`
- Terminal (terminal icon) — `/dashboard/terminal`
- Remote Desktop (monitor icon) — `/dashboard/rdp`
- Files (folder icon) — `/dashboard/files`
- Port Forwarding (network icon) — `/dashboard/ports`

**Header**: Shows "pc.himansh.in" branding, current system uptime, and a logout button.

**Design direction**: Dark theme by default. Use a deep charcoal/near-black base (`#0a0a0f` or similar) with subtle blue accent (`#3b82f6`). Glass morphism on sidebar and cards. Monospace font (JetBrains Mono or Fira Code from Google Fonts) for data and stats. Sans-serif (Geist or similar) for UI labels. The overall vibe should be "command center" — professional, information-dense, not playful.

### 3. System monitor (`/dashboard` — default view)

**Overview cards** (top row, 4 cards):
- CPU: current usage %, model name, cores/threads, frequency
- RAM: used/total GB, usage %
- GPU: usage %, temp, VRAM used/total (important — RTX 5060 Ti)
- Disk: used/total per drive, read/write speed

**Charts** (below cards):
- CPU usage over time (last 60 seconds, line chart, updates every 2s)
- RAM usage over time (same)
- Network throughput (upload/download speed, dual line chart)

**Process list** (bottom section):
- Table with columns: PID, Name, CPU%, Memory, Status
- Sortable by any column
- Search/filter bar
- Top 50 processes by CPU or memory usage

**Real-time updates via SSE**:
- API route `/api/system/stream` opens a Server-Sent Events connection
- Server pushes stats JSON every 2 seconds
- Frontend `use-system-stats.ts` hook consumes the SSE stream and updates state
- On disconnect, auto-reconnect after 3 seconds

**API — GET /api/system/stats** (one-shot, for initial load):
```typescript
// Response
{
  cpu: {
    model: string,
    cores: number,
    threads: number,
    speed: number,          // GHz
    usage: number,          // percentage
    temperature: number     // Celsius
  },
  memory: {
    total: number,          // bytes
    used: number,
    free: number,
    usage: number           // percentage
  },
  gpu: {
    model: string,
    usage: number,          // percentage
    temperature: number,
    vramTotal: number,      // bytes
    vramUsed: number
  },
  disk: Array<{
    name: string,           // "C:", "D:", etc.
    type: string,           // "NVMe SSD", etc.
    total: number,
    used: number,
    usage: number
  }>,
  network: {
    upload: number,         // bytes/sec
    download: number,
    interfaces: Array<{ name: string, ip: string, speed: number }>
  },
  os: {
    hostname: string,
    platform: string,
    uptime: number          // seconds
  }
}
```

**Implementation** (`src/lib/system-info.ts`):
```typescript
import si from 'systeminformation';

// Cache results for 1 second to avoid hammering the OS
let cache: { data: any; timestamp: number } | null = null;

export async function getSystemStats() {
  if (cache && Date.now() - cache.timestamp < 1000) return cache.data;

  const [cpu, cpuLoad, mem, gpu, disks, network, osInfo, temp] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.mem(),
    si.graphics(),
    si.fsSize(),
    si.networkStats(),
    si.osInfo(),
    si.cpuTemperature()
  ]);

  const data = {
    cpu: {
      model: cpu.manufacturer + ' ' + cpu.brand,
      cores: cpu.physicalCores,
      threads: cpu.cores,
      speed: cpu.speed,
      usage: cpuLoad.currentLoad,
      temperature: temp.main
    },
    memory: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      usage: (mem.used / mem.total) * 100
    },
    gpu: gpu.controllers[0] ? {
      model: gpu.controllers[0].model,
      usage: gpu.controllers[0].utilizationGpu,
      temperature: gpu.controllers[0].temperatureGpu,
      vramTotal: gpu.controllers[0].vram * 1024 * 1024,
      vramUsed: gpu.controllers[0].memoryUsed * 1024 * 1024
    } : null,
    disk: disks.map(d => ({
      name: d.mount,
      type: d.type,
      total: d.size,
      used: d.used,
      usage: d.use
    })),
    network: {
      upload: network.reduce((sum, n) => sum + n.tx_sec, 0),
      download: network.reduce((sum, n) => sum + n.rx_sec, 0),
      interfaces: network.map(n => ({ name: n.iface, ip: '', speed: n.operstate }))
    },
    os: {
      hostname: osInfo.hostname,
      platform: osInfo.platform + ' ' + osInfo.release,
      uptime: si.time().uptime
    }
  };

  cache = { data, timestamp: Date.now() };
  return data;
}
```

### 4. In-browser SSH terminal (`/dashboard/terminal`)

This is a full terminal emulator in the browser connected to the Windows PC's shell via WebSocket.

**Architecture**:
```
Browser (xterm.js) ←→ WebSocket (:3006) ←→ node-pty ←→ PowerShell/CMD/WSL
```

**Frontend component** (`terminal-view.tsx`):
- Initialize xterm.js Terminal instance with fit addon
- Connect to `wss://pc.himansh.in/ws/ssh` (or `ws://localhost:3006` in dev)
- On WebSocket open: send initial resize event with terminal dimensions
- On data from xterm (user keystrokes): send to WebSocket
- On data from WebSocket (shell output): write to xterm
- Handle resize: fit addon recalculates, sends new cols/rows to WebSocket
- UI: Full-height terminal that fills the content area, with a toolbar above showing:
  - Shell selector dropdown (PowerShell, CMD, WSL if available)
  - "New tab" button (support multiple terminal tabs — each is a separate WebSocket + PTY)
  - Font size controls

**Backend** (`server/ws-server.ts`) — runs as a separate process on port 3006:
```typescript
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { verify } from 'jsonwebtoken';
import { parse } from 'cookie';

const wss = new WebSocketServer({ port: 3006 });

wss.on('connection', (ws, req) => {
  // === AUTH CHECK ===
  // Extract JWT from cookie header
  const cookies = parse(req.headers.cookie || '');
  const token = cookies.session;
  try {
    verify(token, process.env.JWT_SECRET!);
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // === SHELL SELECTION ===
  // Parse query param: ?shell=powershell|cmd|wsl
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const shellParam = url.searchParams.get('shell') || 'powershell';
  const shellMap: Record<string, string> = {
    powershell: 'powershell.exe',
    cmd: 'cmd.exe',
    wsl: 'wsl.exe'
  };
  const shell = shellMap[shellParam] || 'powershell.exe';

  // === SPAWN PTY ===
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || 'C:\\Users\\Himansh',
    env: process.env as Record<string, string>
  });

  // PTY output → WebSocket
  ptyProcess.onData((data: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    ws.close();
  });

  // WebSocket input → PTY
  ws.on('message', (msg: Buffer) => {
    try {
      const parsed = JSON.parse(msg.toString());
      switch (parsed.type) {
        case 'input':
          ptyProcess.write(parsed.data);
          break;
        case 'resize':
          ptyProcess.resize(parsed.cols, parsed.rows);
          break;
      }
    } catch {
      // If not JSON, treat as raw input
      ptyProcess.write(msg.toString());
    }
  });

  ws.on('close', () => {
    ptyProcess.kill();
  });
});

console.log('WebSocket terminal server running on :3006');
```

**WebSocket message protocol**:
```typescript
// Client → Server
{ type: 'input', data: string }    // keystrokes
{ type: 'resize', cols: number, rows: number }

// Server → Client
{ type: 'output', data: string }   // shell output
{ type: 'exit', code: number }     // shell exited
```

**Multiple tabs**: Each tab opens a new WebSocket connection, which spawns a new PTY process. Tab state is managed entirely in the frontend React component — array of `{ id, ws, terminal }` objects.

**Windows OpenSSH prerequisite**: Enable OpenSSH Server via Windows Settings → Apps → Optional Features → Add "OpenSSH Server". Then in services.msc, set "OpenSSH SSH Server" to Automatic start. However, note that for the in-browser terminal we are NOT using SSH protocol — we spawn shells directly via `node-pty`. The OpenSSH server is an optional fallback for external SSH clients.

### 5. In-browser RDP via Guacamole (`/dashboard/rdp`)

**Why Guacamole**: It's the standard open-source solution for browser-based remote desktop. It translates RDP protocol into HTML5 Canvas rendering. The user sees their full Windows desktop in the browser — mouse, keyboard, clipboard, all working.

**Architecture**:
```
Browser (Guacamole.js client)
  ↕ HTTP/WebSocket
Guacamole web app (guacamole-client, :8080)
  ↕ Guacamole protocol
guacd daemon (guacamole-server)
  ↕ RDP protocol
Windows RDP service (localhost:3389)
```

**Docker setup** (the simplest way to run Guacamole on Windows with Docker Desktop):

Use the `guacamole/guacd` and `guacamole/guacamole` Docker images. Create a `docker-compose.guacamole.yml`:

```yaml
version: "3.8"

services:
  guacd:
    image: guacamole/guacd
    container_name: pc-dash-guacd
    restart: "no"                    # We control start/stop from dashboard
    networks:
      - guac-net

  guacamole:
    image: guacamole/guacamole
    container_name: pc-dash-guacamole
    restart: "no"
    ports:
      - "8080:8080"
    environment:
      GUACD_HOSTNAME: guacd
      GUACD_PORT: 4822
      # Use environment-based auth (simplest, single-connection setup)
      # This avoids needing MySQL/PostgreSQL for Guacamole's auth
      GUACAMOLE_HOME: /etc/guacamole
    volumes:
      - ./guacamole-config:/etc/guacamole
    depends_on:
      - guacd
    networks:
      - guac-net

networks:
  guac-net:
    driver: bridge
```

**Guacamole connection config** (`guacamole-config/guacamole.properties`):
```properties
guacd-hostname: guacd
guacd-port: 4822
auth-provider: net.sourceforge.guacamole.net.basic.BasicFileAuthenticationProvider
basic-user-mapping: /etc/guacamole/user-mapping.xml
```

**User mapping** (`guacamole-config/user-mapping.xml`):
```xml
<user-mapping>
  <authorize username="admin" password="CHANGE_THIS_PASSWORD" encoding="plain">
    <connection name="Windows Desktop">
      <protocol>rdp</protocol>
      <param name="hostname">host.docker.internal</param>
      <param name="port">3389</param>
      <param name="username">Himansh</param>
      <param name="password">WINDOWS_PASSWORD_HERE</param>
      <param name="security">nla</param>
      <param name="ignore-cert">true</param>
      <param name="resize-method">display-update</param>
      <param name="enable-wallpaper">true</param>
      <param name="enable-font-smoothing">true</param>
      <param name="enable-desktop-composition">true</param>
      <param name="color-depth">32</param>
    </connection>
  </authorize>
</user-mapping>
```

**IMPORTANT**: `host.docker.internal` is how Docker containers on Windows reach the host's `localhost`. This lets Guacamole's guacd connect to Windows RDP at `localhost:3389` from inside the container.

**On-demand start/stop from dashboard**:

The RDP service (Guacamole Docker stack) is NOT always running. The dashboard controls its lifecycle:

**API — POST /api/rdp/start**:
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export async function POST() {
  // Verify JWT middleware...

  try {
    // Start the Guacamole Docker stack
    await execAsync(
      'docker compose -f docker-compose.guacamole.yml up -d',
      { cwd: process.env.GUAC_COMPOSE_DIR || 'C:\\pc-dashboard\\cloudflared' }
    );

    // Wait for Guacamole to be healthy (poll /guacamole/ endpoint)
    let ready = false;
    for (let i = 0; i < 30; i++) { // 30 second timeout
      try {
        const res = await fetch('http://localhost:8080/guacamole/');
        if (res.ok) { ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!ready) throw new Error('Guacamole failed to start within 30s');

    return Response.json({ status: 'running' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

**API — POST /api/rdp/stop**:
```typescript
export async function POST() {
  await execAsync(
    'docker compose -f docker-compose.guacamole.yml down',
    { cwd: process.env.GUAC_COMPOSE_DIR }
  );
  return Response.json({ status: 'stopped' });
}
```

**API — GET /api/rdp/status**:
```typescript
export async function GET() {
  try {
    const { stdout } = await execAsync('docker ps --filter name=pc-dash-guacamole --format "{{.Status}}"');
    const running = stdout.trim().startsWith('Up');
    return Response.json({ running });
  } catch {
    return Response.json({ running: false });
  }
}
```

**Frontend component** (`rdp-viewer.tsx`):
- Show a large "Start Remote Desktop" button when Guacamole is stopped
- When clicked: call POST `/api/rdp/start`, show loading spinner
- Once running: render an `<iframe>` pointing to `http://localhost:8080/guacamole/#/` (or through tunnel if remote)
- The iframe URL should auto-login to Guacamole using the configured credentials (or the user logs into Guacamole's UI)
- Show "Stop Remote Desktop" button in a toolbar above the iframe
- Show connection quality indicator (latency)
- Full-screen toggle button for the iframe
- Important: The iframe src through the tunnel should be `https://pc.himansh.in/guac/` — cloudflared routes this to `localhost:8080`

**Alternative to iframe — Guacamole.js client**: For tighter integration, use the `guacamole-common-js` npm package directly. This gives:
- No Guacamole login page (authenticate programmatically using the Guacamole REST API from the server side)
- Direct canvas rendering in the React component
- Better resize handling
- Clipboard integration

This is the preferred approach if time permits. The flow would be:
1. Server-side: POST to Guacamole API to get an auth token
2. Pass token to frontend
3. Frontend creates `Guacamole.Client` connected to the WebSocket tunnel
4. Canvas renders directly in the component

### 6. File manager (`/dashboard/files`)

**Frontend UI**:
- Split view: folder tree (left panel, collapsible) + file grid/list (right panel)
- Breadcrumb navigation at the top
- Toggle between grid view (thumbnails for images, icons for others) and list view (table with name, size, modified date)
- Toolbar: Upload button, New Folder button, view toggle, search/filter
- Context menu on right-click: Open, Download, Rename, Delete, Copy Path
- Drag-and-drop upload (drop zone overlay)
- File preview modal: text files show content, images show preview, others show metadata
- Multi-select with checkboxes for bulk operations (delete, download as ZIP)

**API endpoints**:

**GET /api/files/list?path=C:\Users\Himansh\Documents**:
```typescript
// Response
{
  path: "C:\\Users\\Himansh\\Documents",
  parent: "C:\\Users\\Himansh",
  items: [
    {
      name: "project-notes.md",
      type: "file",
      size: 2048,                  // bytes
      modified: "2025-01-15T10:30:00Z",
      extension: ".md",
      permissions: "rw"
    },
    {
      name: "screenshots",
      type: "directory",
      size: 0,
      modified: "2025-01-14T08:00:00Z",
      children: 12                 // count of items inside
    }
  ]
}
```

**GET /api/files/read?path=C:\Users\Himansh\file.txt**:
- For text files (< 5MB): return `{ content: string, encoding: "utf-8" }`
- For binary files or download: return file stream with `Content-Disposition: attachment`
- Query param `?download=true` forces download for any file type

**POST /api/files/upload**:
- Multipart form data
- Fields: `path` (target directory), `files` (one or more files)
- Use `formidable` to parse multipart data
- Save files to the specified path
- Return list of saved file paths

**POST /api/files/write**:
```typescript
// Request body
{ path: string, content: string }
// Creates or overwrites a text file
```

**DELETE /api/files/delete**:
```typescript
// Request body
{ paths: string[] }
// Supports deleting multiple files/folders at once
// Directories are deleted recursively (with confirmation on frontend)
```

**PATCH /api/files/rename**:
```typescript
// Request body
{ oldPath: string, newPath: string }
```

**POST /api/files/mkdir**:
```typescript
// Request body
{ path: string }
// Creates directory (and parents if needed, like mkdir -p)
```

**Security**: All file operations must:
1. Validate that the resolved path is within the `FILE_MANAGER_ROOT` directory (prevent directory traversal attacks)
2. Use `path.resolve()` and check `resolvedPath.startsWith(FILE_MANAGER_ROOT)`
3. Reject paths containing `..` after resolution that escape the root
4. The root directory is configurable via env var, default `C:\Users\Himansh`

### 7. Dynamic port forwarding (`/dashboard/ports`)

This is the most powerful feature — it lets you expose any local service to the internet on demand through the Cloudflare Tunnel.

**How it works**:

Cloudflare Tunnels support dynamic ingress rules. The `cloudflared` config file (`config.yml`) defines which hostnames route to which local ports. Our dashboard can modify this config and reload the tunnel.

**Two approaches** (implement both, prefer approach A):

**Approach A — Cloudflare API (preferred)**:
1. User enters: local port `8888`, desired hostname `jupyter`
2. Dashboard API creates a DNS CNAME record: `jupyter.pc.himansh.in` → `<tunnel-id>.cfargotunnel.com` via Cloudflare API
3. Dashboard API updates the `cloudflared` config.yml to add the ingress rule
4. Dashboard API sends SIGHUP to cloudflared (or restarts the service) to reload config
5. The service is now live at `https://jupyter.pc.himansh.in`

**Approach B — cloudflared config only (fallback)**:
- If DNS wildcard is already set up (`*.pc.himansh.in` CNAME to tunnel), we only need to update the ingress rules in config.yml
- This is simpler but requires the wildcard DNS record to exist

**Cloudflared config.yml structure**:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\Himansh\.cloudflared\<TUNNEL_ID>.json

ingress:
  # Dashboard (always present)
  - hostname: pc.himansh.in
    service: http://localhost:3005

  # WebSocket terminal
  - hostname: pc.himansh.in
    path: /ws/ssh
    service: ws://localhost:3006

  # Guacamole (always present in config, but container may not be running)
  - hostname: pc.himansh.in
    path: /guac/*
    service: http://localhost:8080

  # === Dynamic port forwards (managed by dashboard) ===
  # - hostname: jupyter.pc.himansh.in
  #   service: http://localhost:8888
  # - hostname: ollama.pc.himansh.in
  #   service: http://localhost:11434
  # === End dynamic forwards ===

  # Catch-all (required by cloudflared)
  - service: http_status:404
```

**Frontend UI** (`port-manager.tsx`):
- Table showing currently forwarded ports:
  | Local Port | Public URL | Status | Actions |
  |---|---|---|---|
  | 8888 | jupyter.pc.himansh.in | Active | Stop |
  | 11434 | ollama.pc.himansh.in | Active | Stop |
- "Add Forward" form:
  - Local port input (number, 1-65535)
  - Subdomain input (text, alphanumeric + hyphens, auto-appends `.pc.himansh.in`)
  - Protocol selector (HTTP/HTTPS/TCP)
  - "Forward" button
- Each row has a "Stop" button that removes the forward
- Status indicator: green dot = reachable, red = unreachable (health check ping to local port)

**API — GET /api/ports/list**:
```typescript
// Response
{
  forwards: [
    {
      id: "fwd_abc123",
      localPort: 8888,
      hostname: "jupyter.pc.himansh.in",
      protocol: "http",
      status: "active",          // or "unreachable" if local port isn't open
      createdAt: "2025-01-15T10:00:00Z"
    }
  ]
}
```

**API — POST /api/ports/forward**:
```typescript
// Request body
{
  localPort: 8888,
  subdomain: "jupyter",         // becomes jupyter.pc.himansh.in
  protocol: "http"              // http | https | tcp
}

// Implementation steps:
// 1. Validate subdomain (alphanumeric + hyphens, no reserved names like "www", "api")
// 2. Check if local port is actually listening (net.connect test)
// 3. Create DNS CNAME via Cloudflare API: jupyter.pc.himansh.in → <tunnel>.cfargotunnel.com
// 4. Add ingress rule to config.yml (insert before catch-all)
// 5. Reload cloudflared service: exec('cloudflared service restart') or write config + SIGHUP
// 6. Store the forward in a local JSON file for persistence across dashboard restarts
// 7. Return the created forward object
```

**API — DELETE /api/ports/remove**:
```typescript
// Request body
{ id: string }
// or
{ hostname: string }

// Implementation:
// 1. Remove DNS record via Cloudflare API
// 2. Remove ingress rule from config.yml
// 3. Reload cloudflared
// 4. Remove from local JSON store
```

**Cloudflare API client** (`src/lib/cloudflare.ts`):
```typescript
const CF_API = 'https://api.cloudflare.com/client/v4';

export async function createDNSRecord(subdomain: string, tunnelId: string) {
  const res = await fetch(`${CF_API}/zones/${ZONE_ID}/dns_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'CNAME',
      name: `${subdomain}.pc.himansh.in`,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true
    })
  });
  return res.json();
}

export async function deleteDNSRecord(recordId: string) {
  await fetch(`${CF_API}/zones/${ZONE_ID}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${API_TOKEN}` }
  });
}
```

**Tunnel config manager** (`src/lib/tunnel-config.ts`):
```typescript
import { readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';  // use 'yaml' npm package
import { exec } from 'child_process';

const CONFIG_PATH = 'C:\\Users\\Himansh\\.cloudflared\\config.yml';

export function addIngressRule(hostname: string, localPort: number, protocol: string) {
  const config = parse(readFileSync(CONFIG_PATH, 'utf-8'));
  const serviceUrl = protocol === 'tcp'
    ? `tcp://localhost:${localPort}`
    : `http://localhost:${localPort}`;

  // Insert before the catch-all (last entry)
  const catchAll = config.ingress.pop();
  config.ingress.push({ hostname, service: serviceUrl });
  config.ingress.push(catchAll);

  writeFileSync(CONFIG_PATH, stringify(config));
  reloadTunnel();
}

export function removeIngressRule(hostname: string) {
  const config = parse(readFileSync(CONFIG_PATH, 'utf-8'));
  config.ingress = config.ingress.filter(
    (rule: any) => rule.hostname !== hostname
  );
  writeFileSync(CONFIG_PATH, stringify(config));
  reloadTunnel();
}

function reloadTunnel() {
  // On Windows, restart the cloudflared service
  exec('net stop cloudflared && net start cloudflared', (err) => {
    if (err) console.error('Failed to restart cloudflared:', err);
  });
}
```

**Persistence**: Store active forwards in a JSON file (`data/port-forwards.json`) so that on dashboard restart, it knows which forwards are active and can display them correctly. This file also stores the Cloudflare DNS record IDs so they can be cleaned up on removal.

```json
{
  "forwards": [
    {
      "id": "fwd_abc123",
      "localPort": 8888,
      "subdomain": "jupyter",
      "hostname": "jupyter.pc.himansh.in",
      "protocol": "http",
      "dnsRecordId": "cf_rec_xyz789",
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

## Cloudflare Tunnel setup (one-time)

**PowerShell setup script** (`scripts/setup-tunnel.ps1`):

```powershell
# Step 1: Install cloudflared
winget install Cloudflare.cloudflared

# Step 2: Authenticate (opens browser)
cloudflared tunnel login

# Step 3: Create tunnel
cloudflared tunnel create pc-dashboard
# Note the tunnel ID printed — save it

# Step 4: Create DNS records
cloudflared tunnel route dns pc-dashboard pc.himansh.in
# For wildcard (needed for dynamic port forwarding):
# Go to Cloudflare dashboard → DNS → Add CNAME: *.pc.himansh.in → <tunnel-id>.cfargotunnel.com (proxied)

# Step 5: Create config file
# (The dashboard app will manage this, but initial version):
@"
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\Himansh\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: pc.himansh.in
    service: http://localhost:3005
  - hostname: pc.himansh.in
    path: /ws/ssh
    service: ws://localhost:3006
  - hostname: pc.himansh.in
    path: /guac/*
    service: http://localhost:8080
  - service: http_status:404
"@ | Out-File -FilePath "$env:USERPROFILE\.cloudflared\config.yml" -Encoding utf8

# Step 6: Install as Windows service (starts on boot)
cloudflared service install

# Step 7: Start the service
net start cloudflared
```

**Cloudflare Zero Trust Access setup** (manual, in Cloudflare dashboard):
1. Go to Cloudflare Zero Trust → Access → Applications
2. Create new application:
   - Name: "PC Dashboard"
   - Application domain: `pc.himansh.in` and `*.pc.himansh.in`
   - Session duration: 24h
3. Add policy:
   - Name: "Allow Himansh"
   - Action: Allow
   - Include: Emails — `iamthehimanshraj@gmail.com`
   - Authentication: One-time PIN (or add GitHub/Google identity provider)

---

## Windows services setup (one-time)

**PowerShell script** (`scripts/install-services.ps1`):

```powershell
# Enable OpenSSH Server (optional, for external SSH access)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# Enable Remote Desktop
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
  -Name "fDenyTSConnections" -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
# Note: RDP firewall rule only needs to allow localhost since Guacamole connects locally

# Install Docker Desktop (for Guacamole)
# Download from https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe
# or: winget install Docker.DockerDesktop

# Pull Guacamole images
docker pull guacamole/guacd
docker pull guacamole/guacamole
```

---

## Running the project

### Development mode

```powershell
# Terminal 1: Next.js dev server
cd pc-dashboard
bun dev
# Runs on http://localhost:3005

# Terminal 2: WebSocket terminal server
cd pc-dashboard
bun run server/ws-server.ts
# Runs on ws://localhost:3006

# Terminal 3: Cloudflare Tunnel (if not running as service)
cloudflared tunnel run pc-dashboard
```

### Production mode

```powershell
# Build Next.js
cd pc-dashboard
bun run build

# Start Next.js
bun run start
# Runs on http://localhost:3005

# WebSocket server (run as background process or Windows service)
bun run server/ws-server.ts

# cloudflared runs as Windows service (installed in setup)
```

**Consider using PM2 or a Windows Task Scheduler** to keep the Next.js app and WebSocket server running persistently and auto-restart on crash. Alternatively, create Windows services using `node-windows` or `nssm`.

**Recommended: use nssm (Non-Sucking Service Manager)** to register both as Windows services:
```powershell
# Install nssm
winget install nssm

# Register Next.js dashboard as service
nssm install PCDashboard "C:\Users\Himansh\.bun\bin\bun.exe" "run start"
nssm set PCDashboard AppDirectory "C:\pc-dashboard"
nssm set PCDashboard Start SERVICE_AUTO_START

# Register WebSocket server as service
nssm install PCDashTerminal "C:\Users\Himansh\.bun\bin\bun.exe" "run server/ws-server.ts"
nssm set PCDashTerminal AppDirectory "C:\pc-dashboard"
nssm set PCDashTerminal Start SERVICE_AUTO_START

# Start both
nssm start PCDashboard
nssm start PCDashTerminal
```

---

## Networking summary

| Service | Local Port | Public URL | Protocol | Always On? |
|---|---|---|---|---|
| Next.js Dashboard | 3005 | `https://pc.himansh.in` | HTTPS (via CF) | Yes |
| WebSocket Terminal | 3006 | `wss://pc.himansh.in/ws/ssh` | WSS (via CF) | Yes |
| Guacamole (RDP) | 8080 | `https://pc.himansh.in/guac/` | HTTPS (via CF) | No — on-demand |
| Windows RDP | 3389 | Never exposed directly | RDP (local only) | Yes (local) |
| Dynamic forwards | Varies | `https://<name>.pc.himansh.in` | HTTPS (via CF) | On-demand |

**No inbound ports are opened on the router.** All traffic flows through Cloudflare Tunnel's outbound connection. The PC initiates the tunnel to Cloudflare's edge, and Cloudflare routes incoming requests back through the tunnel.

---

## Security checklist

- [ ] Cloudflare Zero Trust Access policy on `*.pc.himansh.in` with email OTP
- [ ] `DASHBOARD_PASSWORD_HASH` set via bcrypt (cost 12+)
- [ ] `JWT_SECRET` is cryptographically random (64 hex chars)
- [ ] JWT cookie: `HttpOnly`, `Secure`, `SameSite=Strict`
- [ ] All API routes validate JWT before processing
- [ ] WebSocket upgrade validates JWT from cookie
- [ ] File manager validates all paths stay within `FILE_MANAGER_ROOT` (no directory traversal)
- [ ] Guacamole Docker stack only starts when user triggers it from dashboard
- [ ] `cloudflared` runs as a Windows service with least-privilege user (SYSTEM is fine)
- [ ] `.env.local` and `data/port-forwards.json` are in `.gitignore`
- [ ] Windows Firewall: RDP (3389) only allows localhost connections
- [ ] Windows Firewall: no inbound rules for 3005, 3006, 8080 (not needed — cloudflared is outbound)
- [ ] Rate limiting on `/api/auth/login` (max 5 attempts per minute, lockout for 15 min)
- [ ] Guacamole NLA (Network Level Authentication) enabled for RDP connection
- [ ] Dynamic port forwards: validate subdomain against reserved names, validate port range
- [ ] Cloudflare API token scoped to minimum permissions: Zone DNS Edit + Account Tunnel Edit

---

## UI/UX design guidelines

**Theme**: Dark, command-center aesthetic. Think "mission control" not "consumer app".

**Color palette**:
- Background: `#09090b` (near-black)
- Surface: `#18181b` (cards, sidebar)
- Elevated surface: `#27272a` (hover states, active items)
- Border: `#3f3f46` (subtle borders)
- Primary accent: `#3b82f6` (blue — active states, links, CTAs)
- Success: `#22c55e` (running services, healthy stats)
- Warning: `#eab308` (high CPU/RAM usage)
- Danger: `#ef4444` (errors, critical alerts, stop buttons)
- Text primary: `#fafafa`
- Text secondary: `#a1a1aa`

**Typography**:
- Headings: Geist Sans (or Inter as fallback)
- Body: Same
- Data/code/terminal: JetBrains Mono (from Google Fonts)
- System stats numbers: JetBrains Mono, tabular-nums

**Components (use shadcn/ui)**:
- Card: rounded-lg, border, bg-surface
- Button: rounded-md, blue primary, ghost for secondary
- Input: rounded-md, bg-surface, border
- Badge: for status indicators (Online, Offline, Running, Stopped)
- Dialog: for confirmations (delete files, stop RDP)
- Dropdown: for shell selection, context menus
- Table: for processes, files, port forwards
- Tabs: for terminal sessions

**Animations**: Framer Motion for page transitions, card hover effects, and stat counter animations. Keep it subtle — fade-in, slide-up, scale. No bouncy or playful effects.

**Responsive**: The dashboard is primarily for desktop/tablet use, but the login page and system overview should work on mobile. Terminal and RDP pages can require minimum 768px width.

---

## Implementation order

Build in this sequence — each step is functional and testable independently:

1. **Project scaffold**: Next.js 14 + Tailwind + shadcn/ui + TypeScript config
2. **Auth system**: Login page + JWT + middleware + set-password script
3. **Dashboard layout**: Sidebar + header + routing between pages
4. **System monitor**: Stats API + SSE stream + real-time charts
5. **File manager**: API routes + tree view + upload/download + context menu
6. **SSH terminal**: WebSocket server + xterm.js component + multi-tab
7. **RDP viewer**: Guacamole Docker config + start/stop API + iframe/client integration
8. **Port forwarding**: Cloudflare API client + tunnel config manager + UI
9. **Cloudflare Tunnel setup**: Config generation + service installation scripts
10. **Polish**: Error handling, loading states, toast notifications, keyboard shortcuts

---

## Dependencies (package.json)

```json
{
  "name": "pc-dashboard",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3005",
    "build": "next build",
    "start": "next start -p 3005",
    "server": "bun run server/ws-server.ts",
    "set-password": "bun run scripts/set-password.ts"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",

    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",

    "node-pty": "^1.0.0",
    "ws": "^8.16.0",

    "systeminformation": "^5.22.0",

    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.0",
    "cookie": "^0.6.0",

    "formidable": "^3.5.0",
    "yaml": "^2.4.0",

    "framer-motion": "^11.0.0",
    "recharts": "^2.12.0",
    "lucide-react": "^0.383.0",

    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie": "^0.6.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/ws": "^8.5.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

---

## Notes for Claude Code

- This is a Windows 11 machine. Use PowerShell syntax for any shell commands (backtick `` ` `` for line continuation, not `\`).
- Use `bun` instead of `npm` or `yarn` for all package operations.
- `node-pty` requires native compilation. On Windows, this needs the "Desktop development with C++" workload in Visual Studio Build Tools. If bun has issues with node-pty, fall back to `npm install node-pty` or use `node-pty-prebuilt-multiarch`.
- For the WebSocket server (`server/ws-server.ts`), this runs as a separate Bun process, NOT inside Next.js. Next.js API routes cannot maintain persistent WebSocket connections.
- Guacamole Docker compose uses `host.docker.internal` to reach Windows RDP — this works on Docker Desktop for Windows.
- The `cloudflared` config path on Windows is typically `C:\Users\<username>\.cloudflared\config.yml`.
- All file paths in the file manager must use Windows-style paths (`C:\Users\...`) internally but can display with forward slashes in the UI.
- The `systeminformation` package works on Windows but some GPU metrics (especially NVIDIA) may need the `nvidia-smi` CLI available in PATH.
- For the SSE endpoint (`/api/system/stream`), use Next.js route handlers with `ReadableStream` — do NOT use the older Pages Router API format.
- shadcn/ui components should be installed via `bunx shadcn-ui@latest init` and then individual components via `bunx shadcn-ui@latest add button card input ...`.
- Environment variable `GUAC_COMPOSE_DIR` should point to wherever `docker-compose.guacamole.yml` lives.
- The wildcard DNS record `*.pc.himansh.in` must be a CNAME to `<tunnel-id>.cfargotunnel.com` and must be proxied (orange cloud) in Cloudflare DNS settings. This is a manual one-time setup.
