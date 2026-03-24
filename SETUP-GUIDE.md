# PC Dashboard — Cloudflare & Windows Setup Guide

Complete step-by-step guide to configure Cloudflare and your Windows 11 PC for the dashboard project. Do these steps BEFORE running the dashboard app.

---

## Part 1: Cloudflare account & domain setup

### 1.1 — Add your domain to Cloudflare

Your domain `himansh.in` must be managed by Cloudflare (DNS at minimum).

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **"Add a Site"** → enter `himansh.in`
3. Select the **Free plan** (sufficient for everything we need)
4. Cloudflare will scan your existing DNS records — review and confirm
5. Cloudflare gives you two nameservers (e.g. `ada.ns.cloudflare.com`, `rick.ns.cloudflare.com`)
6. Go to your domain registrar (wherever you bought `himansh.in`) and **change the nameservers** to the ones Cloudflare gave you
7. Back in Cloudflare, click **"Done, check nameservers"**
8. Wait for the email confirmation (can take 5 minutes to 24 hours, usually under 1 hour)
9. Once active, you'll see `himansh.in` with status **"Active"** in your Cloudflare dashboard

> **If you already have `himansh.in` on Cloudflare**: Skip this step entirely. Just verify it shows "Active".

---

## Part 2: Create the Cloudflare Tunnel

### 2.1 — Install cloudflared on Windows

Open **PowerShell as Administrator** and run:

```powershell
# Option A: via winget (recommended)
winget install Cloudflare.cloudflared

# Option B: manual download
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
  -OutFile "C:\Windows\System32\cloudflared.exe"
```

Verify installation:

```powershell
cloudflared --version
# Should output something like: cloudflared version 2025.x.x
```

### 2.2 — Authenticate cloudflared with your Cloudflare account

```powershell
cloudflared tunnel login
```

This opens your browser → log in to Cloudflare → select `himansh.in` as the zone → authorize.

After authorization, a certificate file is saved at:
```
C:\Users\Himansh\.cloudflared\cert.pem
```

> **Save this file.** It's your authentication credential. Don't delete it.

### 2.3 — Create the tunnel

```powershell
cloudflared tunnel create pc-dashboard
```

Output will look like:

```
Tunnel credentials written to C:\Users\Himansh\.cloudflared\<TUNNEL-UUID>.json
Created tunnel pc-dashboard with id abcd1234-5678-90ef-ghij-klmnopqrstuv
```

**Write down the tunnel UUID** — you'll need it for the config file and DNS records. In this guide, I'll use `abcd1234-5678-90ef-ghij-klmnopqrstuv` as a placeholder — replace it with your actual UUID everywhere.

### 2.4 — Create DNS records pointing to the tunnel

```powershell
# Main dashboard domain
cloudflared tunnel route dns pc-dashboard pc.himansh.in
```

This creates a CNAME record: `pc.himansh.in` → `abcd1234-5678-90ef-ghij-klmnopqrstuv.cfargotunnel.com`

**For dynamic port forwarding (wildcard DNS):**

This one needs to be done manually in the Cloudflare dashboard because `cloudflared` CLI doesn't support wildcard DNS:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → select `himansh.in`
2. Go to **DNS** → **Records**
3. Click **"Add Record"**
4. Type: `CNAME`
5. Name: `*.pc` (this covers `anything.pc.himansh.in`)
6. Target: `abcd1234-5678-90ef-ghij-klmnopqrstuv.cfargotunnel.com` (your tunnel UUID)
7. Proxy status: **Proxied** (orange cloud ON)
8. Click **Save**

Now any subdomain like `jupyter.pc.himansh.in`, `ollama.pc.himansh.in`, etc. will route through the tunnel.

### 2.5 — Create the tunnel config file

Create the file at `C:\Users\Himansh\.cloudflared\config.yml`:

```yaml
tunnel: abcd1234-5678-90ef-ghij-klmnopqrstuv
credentials-file: C:\Users\Himansh\.cloudflared\abcd1234-5678-90ef-ghij-klmnopqrstuv.json

ingress:
  # Next.js Dashboard
  - hostname: pc.himansh.in
    service: http://localhost:3005
    originRequest:
      noTLSVerify: true

  # WebSocket terminal server
  - hostname: pc.himansh.in
    path: /ws/ssh
    service: ws://localhost:3006

  # Guacamole (RDP in browser) — container may not always be running
  - hostname: pc.himansh.in
    path: /guac/*
    service: http://localhost:8080

  # Catch-all (required)
  - service: http_status:404
```

### 2.6 — Test the tunnel manually

```powershell
cloudflared tunnel run pc-dashboard
```

You should see logs like:
```
INF Starting tunnel
INF Connection registered connIndex=0 ...
INF Connection registered connIndex=1 ...
```

If you have your Next.js app running on :3005, you can now visit `https://pc.himansh.in` and it should work. Press `Ctrl+C` to stop.

### 2.7 — Install cloudflared as a Windows service (auto-start on boot)

When running as a Windows service, cloudflared reads config from the SYSTEM profile, not your user profile. You need to copy the credentials:

```powershell
# Create the directory for the SYSTEM user
New-Item -ItemType Directory -Path "C:\Windows\System32\config\systemprofile\.cloudflared" -Force

# Copy credentials and config
Copy-Item "C:\Users\Himansh\.cloudflared\config.yml" `
  "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"

Copy-Item "C:\Users\Himansh\.cloudflared\abcd1234-5678-90ef-ghij-klmnopqrstuv.json" `
  "C:\Windows\System32\config\systemprofile\.cloudflared\abcd1234-5678-90ef-ghij-klmnopqrstuv.json"

Copy-Item "C:\Users\Himansh\.cloudflared\cert.pem" `
  "C:\Windows\System32\config\systemprofile\.cloudflared\cert.pem"
```

**IMPORTANT**: Update the `credentials-file` path in the SYSTEM profile's config.yml to use the SYSTEM path:

```powershell
# Edit the copied config to update the credentials path
(Get-Content "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml") `
  -replace 'C:\\Users\\Himansh', 'C:\Windows\System32\config\systemprofile' | `
  Set-Content "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
```

Now install and start the service:

```powershell
cloudflared service install
net start cloudflared

# Verify it's running
sc query cloudflared
# Look for: STATE: RUNNING
```

The tunnel now starts automatically every time Windows boots.

> **IMPORTANT — Config sync**: When the dashboard app modifies `config.yml` (for dynamic port forwarding), it must update BOTH copies:
> - `C:\Users\Himansh\.cloudflared\config.yml` (for manual runs)
> - `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` (for the service)
> Then restart the service: `net stop cloudflared && net start cloudflared`

---

## Part 3: Cloudflare Zero Trust Access (security gate)

This adds an authentication wall (OTP email verification) in front of your entire dashboard. Even before someone reaches your Next.js app, Cloudflare challenges them.

### 3.1 — Open the Zero Trust dashboard

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. If first time: you'll be asked to pick a team name (e.g., `himansh`) — this becomes your Zero Trust org URL: `himansh.cloudflareaccess.com`. Pick something short.
3. Select the **Free plan** (up to 50 users)

### 3.2 — Enable One-Time PIN (OTP) as a login method

1. In Zero Trust dashboard, go to **Settings** → **Authentication**
2. Under **Login methods**, check if **"One-time PIN"** is listed
3. If not, click **"Add new"** → select **"One-time PIN"** → **Save**

This tells Cloudflare to send a 6-digit code to the user's email when they try to access your app.

### 3.3 — Create an Access Application

1. Go to **Access** → **Applications**
2. Click **"Add an application"**
3. Select **"Self-hosted"**

Fill in the application settings:

| Field | Value |
|---|---|
| Application name | `PC Dashboard` |
| Session duration | `24 hours` (how long before re-auth is required) |

Under **Application domain**, add these entries (click "Add domain" for each):

| Domain | |
|---|---|
| `pc.himansh.in` | (main dashboard) |
| `*.pc.himansh.in` | (all subdomains — covers dynamic port forwards) |

Click **"Next"** to configure policies.

### 3.4 — Create an Access Policy

This defines WHO is allowed through:

| Field | Value |
|---|---|
| Policy name | `Allow Himansh` |
| Action | **Allow** |
| Session duration | Same as application (24h) |

Under **Configure rules** → **Include**:

| Selector | Value |
|---|---|
| Emails | `iamthehimanshraj@gmail.com` |

You can add more emails later if you want to give others access.

Click **"Next"** → review → **"Add application"**

### 3.5 — How the login flow works after setup

1. You (from any device, anywhere) open `https://pc.himansh.in` in your browser
2. Cloudflare intercepts the request and shows the **Zero Trust login page**
3. You enter `iamthehimanshraj@gmail.com`
4. Cloudflare sends a **6-digit OTP code** to that email
5. You enter the code
6. Cloudflare sets a `CF_Authorization` cookie (valid for 24 hours) and lets you through
7. Now you see your dashboard's own login page (Layer 2 — JWT auth)
8. Enter your dashboard password
9. You're in

For the next 24 hours, Cloudflare remembers you and won't ask for OTP again. Your dashboard's JWT cookie lasts 7 days (but Cloudflare's 24h gate will re-challenge you daily — this is good security).

### 3.6 — Optional: Add GitHub/Google as login method

If you prefer signing in with GitHub or Google instead of email OTP:

1. Go to **Settings** → **Authentication** → **Login methods**
2. Click **"Add new"**
3. Select **GitHub** (or Google)
4. For GitHub: Create an OAuth App in [GitHub Developer Settings](https://github.com/settings/developers)
   - Homepage URL: `https://himansh.cloudflareaccess.com`
   - Callback URL: `https://himansh.cloudflareaccess.com/cdn-cgi/access/callback`
   - Copy the Client ID and Client Secret into Cloudflare
5. Save

Now users get a choice: OTP or GitHub login.

---

## Part 4: Windows 11 PC configuration

### 4.1 — Enable OpenSSH Server

The in-browser terminal in the dashboard uses `node-pty` to spawn shells directly (not SSH protocol), but having OpenSSH Server enabled is useful as a fallback for direct SSH access.

**Via Settings UI:**
1. Open **Settings** → **System** → **Optional features**
2. Click **"View features"** (or "Add a feature")
3. Search for **"OpenSSH Server"**
4. Select it → click **"Install"**
5. Wait for installation to complete

**Via PowerShell (faster):**

```powershell
# Install OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start the service
Start-Service sshd

# Set it to start automatically on boot
Set-Service -Name sshd -StartupType Automatic

# Verify it's running
Get-Service sshd
# Status should show "Running"

# Enable the firewall rule (allows connections on port 22)
# Note: Only needed for direct SSH access from LAN
# The dashboard's in-browser terminal doesn't need this since it uses node-pty locally
Get-NetFirewallRule -Name *ssh* | Enable-NetFirewallRule
```

**Configure SSH for PowerShell as default shell** (instead of CMD):

```powershell
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" `
  -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -PropertyType String -Force
```

**Set up SSH key authentication** (more secure than password):

```powershell
# Generate a key pair (if you don't have one)
ssh-keygen -t ed25519 -C "himansh@pc-dashboard"

# The public key needs to go in the authorized_keys file
# For admin users on Windows, the file is:
# C:\ProgramData\ssh\administrators_authorized_keys

# Copy your public key content into this file:
notepad C:\ProgramData\ssh\administrators_authorized_keys
# Paste the content of your ~/.ssh/id_ed25519.pub

# Fix the file permissions (CRITICAL on Windows):
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /grant "SYSTEM:(F)"
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /grant "BUILTIN\Administrators:(F)"
```

**Test SSH locally:**

```powershell
ssh Himansh@localhost
# Should connect without issues
```

### 4.2 — Enable Remote Desktop (RDP)

RDP is needed because Apache Guacamole connects to it locally to provide browser-based remote desktop.

**Via Settings UI:**
1. Open **Settings** → **System** → **Remote Desktop**
2. Toggle **"Remote Desktop"** to **ON**
3. Confirm when prompted
4. Note your PC name shown on this page

**Via PowerShell:**

```powershell
# Enable RDP
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
  -Name "fDenyTSConnections" -Value 0

# Enable the firewall rules for RDP
Enable-NetFirewallRule -DisplayGroup "Remote Desktop"

# Verify RDP is enabled
Get-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
  -Name "fDenyTSConnections"
# fDenyTSConnections should be 0

# Verify the RDP service is running
Get-Service TermService
# Status should show "Running"
```

**Enable Network Level Authentication (NLA)** — more secure:

```powershell
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' `
  -Name "UserAuthentication" -Value 1
```

**IMPORTANT — RDP security note**: RDP listens on port 3389 locally. We are NOT exposing port 3389 to the internet. Apache Guacamole (running in Docker) connects to `localhost:3389` (via `host.docker.internal:3389` from inside the container). The only way to reach RDP from the internet is through the dashboard → Guacamole → localhost RDP chain, which is protected by Cloudflare Access + JWT auth.

**Verify RDP works locally:**

1. Open another PC on your local network (or use `mstsc.exe` locally as a test)
2. Connect to `your-pc-ip:3389`
3. Enter your Windows username and password
4. You should see your desktop

Your Windows username and password for RDP are the same as your Windows login credentials. If you use a Microsoft account, the username is your email (e.g., `iamthehimanshraj@gmail.com`) and the password is your Microsoft account password. If you use a local account, it's whatever username/password you set up.

### 4.3 — Install Docker Desktop (for Guacamole)

Apache Guacamole runs in Docker containers. Docker Desktop is the easiest way to run Docker on Windows 11.

1. Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
   - Or: `winget install Docker.DockerDesktop`
2. Run the installer — keep all defaults
3. Restart your PC when prompted
4. Open Docker Desktop → complete the setup
5. Make sure Docker is running (whale icon in system tray)

**Pull the Guacamole images** (do this ahead of time so startup is fast):

```powershell
docker pull guacamole/guacd
docker pull guacamole/guacamole
```

**Verify Docker works:**

```powershell
docker run hello-world
# Should print "Hello from Docker!"
```

### 4.4 — Install Node.js build tools (for node-pty)

`node-pty` is a native Node.js module that needs compilation. On Windows, this requires C++ build tools:

```powershell
# Install Visual Studio Build Tools with C++ workload
winget install Microsoft.VisualStudio.2022.BuildTools

# After installation, open "Visual Studio Installer" and ensure
# "Desktop development with C++" workload is checked
```

Alternatively, the simpler approach:

```powershell
# This installs the minimal build tools needed for native modules
npm install -g windows-build-tools
```

> **Note**: If `node-pty` gives you trouble with Bun, try installing it separately with npm: `npm install node-pty` in your project directory, then use Bun for everything else.

### 4.5 — Install Bun (if not already installed)

```powershell
irm bun.sh/install.ps1 | iex
# Or
npm install -g bun
```

Verify:

```powershell
bun --version
```

### 4.6 — NVIDIA drivers & nvidia-smi (for GPU monitoring)

The dashboard's system monitor reads GPU stats. On Windows with an NVIDIA GPU, the `systeminformation` npm package uses `nvidia-smi` under the hood.

Verify `nvidia-smi` is accessible:

```powershell
nvidia-smi
# Should show your GPU info (RTX 5060 Ti, driver version, CUDA version, etc.)
```

If this command works, GPU monitoring will work in the dashboard. If not, update your NVIDIA drivers from [nvidia.com/drivers](https://www.nvidia.com/Download/index.aspx).

`nvidia-smi` is typically located at: `C:\Windows\System32\nvidia-smi.exe` (installed automatically with the NVIDIA driver).

### 4.7 — Windows Firewall configuration

**What needs to be open (local only):**

| Port | Service | Needs Firewall Rule? |
|---|---|---|
| 3005 | Next.js Dashboard | No — cloudflared connects locally |
| 3006 | WebSocket Terminal | No — cloudflared connects locally |
| 8080 | Guacamole | No — cloudflared connects locally |
| 3389 | RDP | Yes — but only for localhost/Docker |
| 22 | SSH | Optional — only if you want direct SSH |

The key insight: **cloudflared creates outbound connections to Cloudflare's edge.** It then receives incoming traffic over those outbound connections and forwards them to localhost. This means **no inbound firewall rules are needed** for ports 3005, 3006, or 8080.

**Lock down RDP to localhost/Docker only** (extra security):

```powershell
# Remove the default RDP firewall rule that allows from anywhere
Disable-NetFirewallRule -DisplayGroup "Remote Desktop"

# Create a new rule that only allows RDP from localhost and Docker
New-NetFirewallRule -DisplayName "RDP - Local Only" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3389 `
  -RemoteAddress 127.0.0.1,172.16.0.0/12,192.168.0.0/16,10.0.0.0/8 `
  -Action Allow
```

The `172.16.0.0/12`, `192.168.0.0/16`, and `10.0.0.0/8` ranges cover Docker's internal networks, which is how `guacd` inside the container reaches your RDP service via `host.docker.internal`.

---

## Part 5: Create a Cloudflare API token (for dynamic port forwarding)

The dashboard needs a Cloudflare API token to create/delete DNS records and manage tunnel routes dynamically.

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → click your profile icon (top right) → **"My Profile"**
2. Go to **"API Tokens"** tab
3. Click **"Create Token"**
4. Click **"Create Custom Token"** (at the bottom, not the templates)

Configure the token:

| Setting | Value |
|---|---|
| Token name | `PC Dashboard - DNS & Tunnel` |
| Permissions | Zone → DNS → **Edit** |
| | Account → Cloudflare Tunnel → **Edit** |
| Zone Resources | Include → Specific zone → `himansh.in` |
| Account Resources | Include → Your account |
| Client IP Filtering | Optional — can restrict to your IP for extra security |
| TTL | Optional — set an expiry if you want |

5. Click **"Continue to summary"** → **"Create Token"**
6. **Copy the token immediately** — it's only shown once

Also note down these IDs (you'll need them for `.env.local`):

**Zone ID**: Go to Cloudflare Dashboard → `himansh.in` → scroll down on the Overview page → right sidebar shows **"Zone ID"**

**Account ID**: Same page, right sidebar → **"Account ID"**

**Tunnel ID**: You got this from step 2.3. Or run:
```powershell
cloudflared tunnel list
# Shows all tunnels with their IDs
```

---

## Part 6: Summary — all the values you need

After completing all the steps above, you should have these values ready for the dashboard's `.env.local`:

```env
# From Part 2 (Cloudflare Tunnel)
TUNNEL_ID=abcd1234-5678-90ef-ghij-klmnopqrstuv

# From Part 5 (API Token)
CLOUDFLARE_API_TOKEN=your-api-token-here
CLOUDFLARE_ZONE_ID=your-zone-id-here
CLOUDFLARE_ACCOUNT_ID=your-account-id-here

# Your Windows login credentials (for Guacamole RDP connection)
WINDOWS_USERNAME=Himansh
WINDOWS_PASSWORD=your-windows-password

# Dashboard password (generate hash using the set-password script)
DASHBOARD_PASSWORD_HASH=<generated by scripts/set-password.ts>
JWT_SECRET=<generated by scripts/set-password.ts>

# Paths
CLOUDFLARED_CONFIG_PATH=C:\Users\Himansh\.cloudflared\config.yml
CLOUDFLARED_SERVICE_CONFIG_PATH=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
FILE_MANAGER_ROOT=C:\Users\Himansh
GUAC_COMPOSE_DIR=C:\pc-dashboard
```

---

## Part 7: Verification checklist

Run through this list to confirm everything is working before starting the dashboard:

```powershell
# 1. Cloudflared is installed and running as service
sc query cloudflared
# Expected: STATE = RUNNING

# 2. Tunnel is healthy
cloudflared tunnel info pc-dashboard
# Expected: Shows tunnel details with connections

# 3. DNS resolves correctly
nslookup pc.himansh.in
# Expected: Returns Cloudflare IP addresses (104.x.x.x or similar)

# 4. OpenSSH is running
Get-Service sshd
# Expected: Status = Running

# 5. RDP is enabled
Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections
# Expected: fDenyTSConnections = 0

# 6. Docker is running
docker info
# Expected: Shows Docker engine info

# 7. Guacamole images are pulled
docker images | findstr guacamole
# Expected: guacamole/guacd and guacamole/guacamole listed

# 8. nvidia-smi works
nvidia-smi --query-gpu=name --format=csv,noheader
# Expected: NVIDIA GeForce RTX 5060 Ti

# 9. Bun is installed
bun --version
# Expected: version number

# 10. Node.js build tools are available (for node-pty)
npm config get msvs_version
# Expected: 2022 (or whatever version you installed)
```

---

## Part 8: How to connect to your PC

Once everything is set up and the dashboard is running, here are all the ways to access your PC remotely:

### Via the dashboard (primary method)

1. Open `https://pc.himansh.in` in any browser
2. Cloudflare challenges you with OTP → enter email → enter code
3. Dashboard login page → enter your dashboard password
4. You're on the dashboard with full access to:
   - System monitor (real-time stats)
   - In-browser terminal (SSH via xterm.js)
   - In-browser RDP (toggle on Guacamole → full desktop in browser)
   - File manager
   - Port forwarding manager

### Via SSH directly (backup method)

If the dashboard is down but the tunnel is still running, you can use Cloudflare's `cloudflared access` to SSH through the tunnel:

**On the client machine** (the one you're connecting FROM):

```bash
# Install cloudflared on the client too
# Then configure SSH to use cloudflared as a proxy

# Add to ~/.ssh/config:
Host pc.himansh.in
  ProxyCommand cloudflared access ssh --hostname %h
  User Himansh
```

Then:
```bash
ssh pc.himansh.in
```

Cloudflare Access will open a browser for OTP auth, then the SSH connection goes through the tunnel.

> **Note**: This method requires cloudflared installed on the client machine. For browser-only access without any client software, use the dashboard.

### Via RDP directly (backup method)

Similarly, if you need raw RDP without the dashboard:

You can add a separate tunnel route for RDP in the config:

```yaml
# Add this to config.yml:
- hostname: rdp.pc.himansh.in
  service: rdp://localhost:3389
```

Then on the client:
```bash
cloudflared access rdp --hostname rdp.pc.himansh.in --url localhost:3388
```

This creates a local listener on port 3388 that tunnels to your PC's RDP. Then connect your RDP client to `localhost:3388`.

### Via local network (when you're home)

If you're on the same network as the PC:
- SSH: `ssh Himansh@192.168.x.x` (your PC's local IP)
- RDP: Open Remote Desktop Connection → connect to `192.168.x.x`
- Dashboard: `http://localhost:3005` (no Cloudflare auth needed)

---

## Part 9: Troubleshooting

### Tunnel shows "inactive" or "degraded"

```powershell
# Check service logs
Get-WinEvent -LogName Application -Source cloudflared -MaxEvents 20

# Or check the service status
sc query cloudflared

# Restart the service
net stop cloudflared
net start cloudflared
```

### Can't receive OTP emails from Cloudflare

- Check spam/junk folder
- Ensure the email in the Access policy matches exactly what you type on the login screen
- Try a different email provider (Gmail usually works well)
- In Zero Trust → Settings → Authentication → verify OTP is listed as a login method

### RDP connection fails from Guacamole

```powershell
# Verify RDP is listening
netstat -an | findstr 3389
# Should show 0.0.0.0:3389 LISTENING

# Test from Docker's perspective
docker run --rm -it alpine ping host.docker.internal
# Should resolve to your host IP

# Check Guacamole logs
docker logs pc-dash-guacamole
docker logs pc-dash-guacd
```

### node-pty installation fails

```powershell
# Make sure build tools are installed
npm install -g windows-build-tools

# Or try the prebuilt version
npm install node-pty-prebuilt-multiarch

# If using Bun and it fails, install node-pty with npm in the project:
cd pc-dashboard
npm install node-pty
# Then use bun for everything else
```

### Port forwarding doesn't work for a new subdomain

```powershell
# Verify DNS record exists
nslookup your-subdomain.pc.himansh.in
# Should return Cloudflare IPs

# Verify config.yml has the ingress rule
type C:\Users\Himansh\.cloudflared\config.yml

# Restart the tunnel after config changes
net stop cloudflared
net start cloudflared

# Verify the local service is actually listening on that port
netstat -an | findstr YOUR_PORT
```

### Dashboard not accessible after PC restart

Make sure all services start automatically:

```powershell
# Check all services
Get-Service cloudflared, sshd | Format-Table Name, Status, StartType

# If dashboard (Next.js) isn't starting, check nssm:
nssm status PCDashboard
nssm status PCDashTerminal

# Restart them
nssm restart PCDashboard
nssm restart PCDashTerminal
```
