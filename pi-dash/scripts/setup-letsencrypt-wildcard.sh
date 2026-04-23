#!/bin/bash
# Issue a Let's Encrypt wildcard cert for *.himansh.in using DNS-01 via Cloudflare API.
# Only needed if you ever want to serve the Pi OUTSIDE the Cloudflare tunnel.
# When using cloudflared tunnel (default), Cloudflare's edge cert is used — this script isn't needed.
set -e

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Set CLOUDFLARE_API_TOKEN env var first (needs Zone:DNS:Edit on himansh.in)."
  exit 1
fi

# Install certbot + the Cloudflare DNS plugin
sudo apt-get update -qq
sudo apt-get install -y certbot python3-certbot-dns-cloudflare

# Cloudflare credentials file
CF_INI=/etc/letsencrypt/cloudflare.ini
sudo mkdir -p /etc/letsencrypt
sudo tee "$CF_INI" > /dev/null <<EOF
dns_cloudflare_api_token = $CLOUDFLARE_API_TOKEN
EOF
sudo chmod 600 "$CF_INI"

# Issue wildcard + apex
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials "$CF_INI" \
  --dns-cloudflare-propagation-seconds 30 \
  -d 'himansh.in' \
  -d '*.himansh.in' \
  --non-interactive \
  --agree-tos \
  --email "admin@himansh.in" \
  --preferred-challenges dns-01

echo "Cert issued at /etc/letsencrypt/live/himansh.in/"
echo "  fullchain.pem"
echo "  privkey.pem"

# Auto-renew cron (certbot already sets up a systemd timer on Debian)
sudo systemctl enable --now certbot.timer
echo "Renewal timer enabled."
