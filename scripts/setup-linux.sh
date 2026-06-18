#!/usr/bin/env bash
# =============================================================================
# PC Dashboard — Linux (Ubuntu) setup for a dual-boot machine.
#
# Brings the SAME dashboard up on Ubuntu, in the background at boot, through the
# SAME Cloudflare tunnel — without touching the Windows install. No Docker:
# remote desktop uses TigerVNC + noVNC instead of Guacamole.
#
# Run as your normal user (NOT root). It will sudo for the bits that need it:
#     bash scripts/setup-linux.sh
# Idempotent — safe to re-run.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(id -un)"
USER_HOME="$HOME"
DOMAIN_DEFAULT="himansh.in"

if [ "$(id -u)" = "0" ]; then
  echo "ERROR: run as your normal user, not root/sudo (it sudos when needed)." >&2
  exit 1
fi

echo "============================================================"
echo " PC Dashboard — Linux setup"
echo " repo:  $REPO"
echo " user:  $USER_NAME   home: $USER_HOME"
echo "============================================================"

# --- helper: read a KEY from .env.local (handles \-escaped values) -----------
read_env() {
  local key="$1"
  grep -E "^${key}=" "$REPO/.env.local" | head -n1 | cut -d= -f2- | sed 's/\\\(.\)/\1/g'
}

# ----------------------------------------------------------------------------
# 0. Persist the NTFS mounts (the repo lives on /mnt/winnvme) so services have
#    their disks at boot. Adds UUID-based fstab entries with `nofail`.
# ----------------------------------------------------------------------------
echo; echo "==> [0/9] Ensuring NTFS partitions auto-mount at boot..."
ensure_ntfs_mount() {
  local dev="$1" mnt="$2"
  sudo mkdir -p "$mnt"
  local uuid spec
  uuid="$(sudo blkid -s UUID -o value "$dev" 2>/dev/null || true)"
  if [ -n "$uuid" ]; then spec="UUID=$uuid"; else spec="$dev"; fi
  if grep -qE "[[:space:]]$mnt[[:space:]]" /etc/fstab; then
    echo "  fstab already has $mnt — leaving it"
  else
    echo "$spec  $mnt  ntfs-3g  defaults,nofail,uid=$(id -u),gid=$(id -g),umask=022  0  0" \
      | sudo tee -a /etc/fstab >/dev/null
    echo "  added: $spec -> $mnt"
  fi
  mountpoint -q "$mnt" || sudo mount "$mnt" || echo "  (will mount on next boot)"
}
ensure_ntfs_mount /dev/nvme0n1p2 /mnt/winnvme
ensure_ntfs_mount /dev/sda3       /mnt/winsata
sudo systemctl daemon-reload   # re-read fstab into systemd mount units

# ----------------------------------------------------------------------------
# 1. System packages
# ----------------------------------------------------------------------------
echo; echo "==> [1/9] Installing apt packages..."
# Remove any previously-added (and possibly broken) cloudflared apt source so
# `apt-get update` doesn't fail on re-runs. We install cloudflared from its .deb.
sudo rm -f /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update -y
sudo apt-get install -y \
  nodejs npm node-gyp build-essential python3 python-is-python3 jq curl \
  tigervnc-standalone-server tigervnc-common \
  novnc websockify \
  xfce4 xfce4-goodies dbus-x11 x11vnc

# ----------------------------------------------------------------------------
# 2. cloudflared (Cloudflare apt repo)
# ----------------------------------------------------------------------------
echo; echo "==> [2/9] Installing cloudflared..."
if ! command -v cloudflared >/dev/null 2>&1; then
  # Install from the official .deb release. The apt repo doesn't publish for every
  # Ubuntu codename (e.g. 26.04 'resolute'), so the direct .deb is the safe path.
  ARCH_DEB="$(dpkg --print-architecture)"   # amd64 / arm64
  TMP_DEB="$(mktemp --suffix=.deb)"
  curl -fsSL -o "$TMP_DEB" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_DEB}.deb"
  sudo dpkg -i "$TMP_DEB" || sudo apt-get install -f -y
  rm -f "$TMP_DEB"
  echo "cloudflared installed: $(cloudflared --version 2>/dev/null)"
else
  echo "cloudflared already installed: $(cloudflared --version)"
fi

# ----------------------------------------------------------------------------
# 3. Node dependencies + node-pty Linux native build
# ----------------------------------------------------------------------------
echo; echo "==> [3/9] Native modules for Linux (node-pty, SWC, esbuild)..."
cd "$REPO"
if [ ! -d node_modules ]; then
  echo "node_modules missing — running 'npm install'..."
  npm install
fi
# Add the Linux native binaries (and keep the Windows ones) WITHOUT a full
# npm/bun install — those prune the other platform's optional deps.
bash scripts/linux/ensure-native.sh
bash scripts/linux/build-node-pty.sh

# ----------------------------------------------------------------------------
# 4. Next.js production build (output is platform-independent JS)
# ----------------------------------------------------------------------------
echo; echo "==> [4/9] Dashboard build (.next)..."
# The .next build is platform-independent JS — reuse the existing one (e.g. built
# on Windows) to avoid thousands of writes to the flaky NTFS volume. Only build if
# it's missing. Call the local binary directly (no npx cache).
if [ -f "$REPO/.next/BUILD_ID" ]; then
  echo "  reusing existing .next build ($(cat "$REPO/.next/BUILD_ID"))"
else
  "$REPO/node_modules/.bin/next" build
fi

# ----------------------------------------------------------------------------
# 5. TigerVNC password + xfce xstartup (the virtual desktop)
# ----------------------------------------------------------------------------
echo; echo "==> [5/9] Configuring TigerVNC virtual desktop..."
mkdir -p "$USER_HOME/.vnc"
if [ ! -f "$USER_HOME/.vnc/passwd" ]; then
  echo "Set a VNC password (used to open the Linux remote desktop in the browser):"
  vncpasswd "$USER_HOME/.vnc/passwd"
fi
chmod 600 "$USER_HOME/.vnc/passwd"
write_xstartup() {
  cat > "$1" <<'EOF'
#!/bin/sh
# Keep this desktop INSIDE the VNC display — never touch the real Wayland session.
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
unset WAYLAND_DISPLAY
unset XDG_SESSION_TYPE
export GDK_BACKEND=x11
export QT_QPA_PLATFORM=xcb
export XKL_XMODMAP_DISABLE=1
exec dbus-launch --exit-with-session startxfce4
EOF
  chmod +x "$1"
}
write_xstartup "$USER_HOME/.vnc/xstartup"
# TigerVNC 1.13+ uses ~/.config/tigervnc/xstartup
mkdir -p "$USER_HOME/.config/tigervnc"
[ -e "$USER_HOME/.config/tigervnc/xstartup" ] || write_xstartup "$USER_HOME/.config/tigervnc/xstartup"

# Disable session apps that crash / are pointless inside a headless VNC desktop
# (light-locker SIGABRTs and Ubuntu's apport pops the crash dialog onto the real screen).
mkdir -p "$USER_HOME/.config/autostart"
for app in light-locker xfce4-screensaver xscreensaver xiccd; do
  cat > "$USER_HOME/.config/autostart/${app}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${app} (disabled in VNC)
Exec=/bin/true
Hidden=true
X-GNOME-Autostart-enabled=false
NoDisplay=true
EOF
done

# ----------------------------------------------------------------------------
# 6. systemd USER services (start at boot via linger, before login)
# ----------------------------------------------------------------------------
echo; echo "==> [6/9] Installing systemd user services..."
NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
UNIT_DIR="$USER_HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
for f in "$REPO"/scripts/linux/systemd/*.service; do
  sed -e "s|__REPO__|$REPO|g" \
      -e "s|__HOME__|$USER_HOME|g" \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__NODEBIN__|$NODE_DIR|g" \
      "$f" > "$UNIT_DIR/$(basename "$f")"
done
systemctl --user daemon-reload
# Enable the core services + the always-on virtual desktop. Mirror services are
# installed but left disabled (enable them from an Xorg session — see LINUX-SETUP.md).
systemctl --user enable --now \
  pcdash-terminal.service \
  pcdash-dashboard.service \
  pcdash-tunnel.service \
  pcdash-vnc.service \
  pcdash-novnc.service

# ----------------------------------------------------------------------------
# 7. Linger — let user services run at boot without an interactive login
# ----------------------------------------------------------------------------
echo; echo "==> [7/9] Enabling lingering for $USER_NAME..."
sudo loginctl enable-linger "$USER_NAME"

# ----------------------------------------------------------------------------
# 8. cloudflared system service via the tunnel token (shared with Windows)
# ----------------------------------------------------------------------------
echo; echo "==> [8/9] Installing cloudflared tunnel service..."
CF_API_TOKEN="$(read_env CLOUDFLARE_API_TOKEN)"
CF_ACCOUNT="$(read_env CLOUDFLARE_ACCOUNT_ID)"
CF_ZONE="$(read_env CLOUDFLARE_ZONE_ID)"
TUNNEL_ID="$(read_env TUNNEL_ID)"
API="https://api.cloudflare.com/client/v4"

TUNNEL_TOKEN="$(curl -fsSL -H "Authorization: Bearer $CF_API_TOKEN" \
  "$API/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_ID/token" | jq -r '.result')"

if [ -z "$TUNNEL_TOKEN" ] || [ "$TUNNEL_TOKEN" = "null" ]; then
  echo "ERROR: could not fetch tunnel token from Cloudflare API." >&2
  exit 1
fi

# Re-install cleanly (idempotent).
sudo cloudflared service uninstall >/dev/null 2>&1 || true
sudo cloudflared service install "$TUNNEL_TOKEN"
sudo systemctl enable --now cloudflared

# ----------------------------------------------------------------------------
# 9. Cloudflare DNS + ingress for the Linux remote-desktop subdomains
# ----------------------------------------------------------------------------
echo; echo "==> [9/9] Wiring desk/screen subdomains into the tunnel..."
ZONE_NAME="$(curl -fsSL -H "Authorization: Bearer $CF_API_TOKEN" "$API/zones/$CF_ZONE" | jq -r '.result.name')"
if [ -z "$ZONE_NAME" ] || [ "$ZONE_NAME" = "null" ]; then ZONE_NAME="$DOMAIN_DEFAULT"; fi
DESK_HOST="desk.$ZONE_NAME"      # always-on virtual desktop  -> noVNC :6080
SCREEN_HOST="screen.$ZONE_NAME"  # physical-screen mirror      -> noVNC :6081

create_dns() {
  local sub="$1"
  curl -fsSL -X POST -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    "$API/zones/$CF_ZONE/dns_records" \
    --data "$(jq -cn --arg n "$sub" --arg c "$TUNNEL_ID.cfargotunnel.com" \
      '{type:"CNAME",name:$n,content:$c,proxied:true,comment:"PC Dashboard (Linux)"}')" \
    | jq -r 'if .success then "  DNS ok: \(.result.name)" else "  DNS skip: \(.errors[0].message)" end'
}
create_dns desk
create_dns screen

# Merge desk/screen ingress rules into the remote-managed tunnel config.
CUR="$(curl -fsSL -H "Authorization: Bearer $CF_API_TOKEN" \
  "$API/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations")"
NEW_INGRESS="$(echo "$CUR" | jq -c \
  --arg d "$DESK_HOST" --arg s "$SCREEN_HOST" '
  (.result.config.ingress // [{service:"http_status:404"}])
  | map(select(.hostname != $d and .hostname != $s))
  | (length - 1) as $last
  | .[0:$last]
    + [ {hostname:$d, service:"http://localhost:6080"},
        {hostname:$s, service:"http://localhost:6081"} ]
    + .[$last:]')"

curl -fsSL -X PUT -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  "$API/accounts/$CF_ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" \
  --data "$(jq -cn --argjson ing "$NEW_INGRESS" '{config:{ingress:$ing}}')" \
  | jq -r 'if .success then "  ingress updated" else "  ingress error: \(.errors[0].message)" end'

# Protect desk/screen behind the pcdash-gate Worker (same OIDC login as the Apps section).
echo "  protecting $DESK_HOST and $SCREEN_HOST with login..."
node --import tsx scripts/linux/protect-subdomains.ts "$DESK_HOST,$SCREEN_HOST" \
  || echo "  (subdomain auth protection skipped — run scripts/linux/protect-subdomains.ts manually)"

echo
echo "============================================================"
echo " DONE."
echo "   Dashboard:        https://pc.$ZONE_NAME        (port 3005)"
echo "   Remote desktop:   https://$DESK_HOST/vnc.html  (TigerVNC, always on)"
echo "   Screen mirror:    https://$SCREEN_HOST/vnc.html (enable Xorg services first)"
echo
echo " Service status:"
echo "   systemctl --user status pcdash-dashboard pcdash-terminal pcdash-vnc pcdash-novnc"
echo "   systemctl status cloudflared"
echo
echo " To enable the physical-screen mirror (log in via 'Ubuntu on Xorg' first):"
echo "   systemctl --user enable --now pcdash-vnc-mirror pcdash-novnc-mirror"
echo "============================================================"
