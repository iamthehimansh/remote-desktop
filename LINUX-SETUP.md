# Running the PC Dashboard on Ubuntu (dual-boot)

This repo lives on the shared NTFS partition (`/mnt/winnvme/remote-desktop`), so
the **same code** runs on both Windows and Ubuntu. The Windows setup is untouched
— all Linux behaviour is gated behind `process.platform` checks and a Linux-only
env overlay. Because the machine is dual-boot, only one OS runs at a time, so both
can safely use the **same Cloudflare tunnel** (`pc.himansh.in`).

```
Browser → Cloudflare edge → cloudflared (whichever OS is booted) → localhost
                                                                   ├─ :3005 dashboard
                                                                   ├─ :3006 terminal (node-pty)
                                                                   ├─ :6080 noVNC  → :5901 TigerVNC virtual desktop   (desk.himansh.in)
                                                                   └─ :6081 noVNC  → :5900 x11vnc screen mirror        (screen.himansh.in)
```

No Docker on Linux. Remote desktop = **TigerVNC + noVNC** (websockify).

## What's different from Windows

| Concern              | Windows                              | Linux                                              |
|----------------------|--------------------------------------|----------------------------------------------------|
| Dashboard / terminal | `bun run start` + Scheduled Task     | `node --import tsx …` as **systemd user services** |
| Terminal shells      | PowerShell / CMD / WSL               | bash / sh / zsh (auto-detected in the UI)          |
| Remote desktop       | Guacamole in Docker → Windows RDP    | TigerVNC virtual desktop **and** x11vnc mirror → noVNC |
| Tunnel               | `cloudflared` Windows service        | `cloudflared` systemd service (same tunnel token)  |
| Paths / shell        | `.env.local`                         | `.env.linux` overlay wins on Linux                 |
| node-pty binary      | `prebuilds/win32-x64`                | `prebuilds/linux-x64` (built by the installer)     |

## One-time install

From the repo root, as your **normal user** (it `sudo`s where needed):

```bash
bash scripts/setup-linux.sh
```

It will:
1. `apt install` node, build tools, tigervnc, novnc, websockify, x11vnc, jq, cloudflared
2. Build the **node-pty** native addon into `prebuilds/linux-x64/` (Windows prebuild left intact)
3. `next build` (output is platform-independent JS, shared safely with Windows)
4. Prompt for a **VNC password** and write an XFCE `~/.vnc/xstartup`
5. Install + enable the systemd **user** services and `loginctl enable-linger` (so they start at boot, before login)
6. Install `cloudflared` as a system service using the tunnel **token** (fetched from the CF API using the creds already in `.env.local`)
7. Create `desk.himansh.in` / `screen.himansh.in` DNS + tunnel ingress rules

After it finishes (and on every subsequent boot, automatically):

- **Dashboard:** https://pc.himansh.in
- **Remote desktop (virtual):** https://desk.himansh.in/vnc.html  ← always on, headless
- **Remote desktop (mirror):** https://screen.himansh.in/vnc.html  ← see *Mirroring* below

## The two remote-desktop modes

You asked for both — pick per session:

- **Virtual desktop (`desk.himansh.in`)** — TigerVNC runs its own XFCE desktop on
  display `:1`, independent of who's logged in. Reliable on Wayland, available at
  boot without anyone logging in. This is enabled by default.

- **Physical-screen mirror (`screen.himansh.in`)** — `x11vnc` mirrors the actual
  monitor you're sitting at. **This needs an Xorg session** (Wayland can't be
  mirrored this way). At the GDM login screen, click the gear ⚙ and choose
  **“Ubuntu on Xorg”**, log in, then enable the mirror services once:

  ```bash
  systemctl --user enable --now pcdash-vnc-mirror pcdash-novnc-mirror
  ```

## Managing the services

```bash
# user services (dashboard, terminal, VNC, noVNC)
systemctl --user status  pcdash-dashboard pcdash-terminal pcdash-vnc pcdash-novnc
systemctl --user restart pcdash-dashboard
journalctl --user -u pcdash-dashboard -f

# the tunnel (system service)
systemctl status cloudflared
journalctl -u cloudflared -f
```

## Notes & gotchas

- **Same tunnel, both OSes:** verified safe — Cloudflare designs one tunnel
  identity to back multiple connectors; one-OS-at-a-time is a strict subset. The
  ingress config is cloud-managed, so `pc.himansh.in` routes to whichever OS is
  booted automatically. On Windows, `desk/screen.himansh.in` are simply unused
  (502) — harmless.
- **node-pty / NTFS sharing:** node-pty loads `build/Release` first, then
  `prebuilds/<platform>-<arch>`. The installer builds `prebuilds/linux-x64` and
  clears `build/Release`, so Windows keeps using `prebuilds/win32-x64`. Never
  commit a linux `.node` into `build/Release`.
- **`.next` build:** platform-independent JS; rebuilding on Linux is fine for
  Windows too (same Next version). If you ever see a hydration/build mismatch,
  just `next build` again on whichever OS you're on.
- **App launcher:** `data/apps.json` still holds the Windows app commands
  (`jupyter-lab.exe`, etc.). Edit those to Linux equivalents in the dashboard's
  Apps tab if you want them to launch on Ubuntu.
- **GPU/temps:** `systeminformation` reads NVIDIA stats via `nvidia-smi` (present)
  and CPU temps via sysfs hwmon; some fields may differ from Windows depending on
  the driver.
