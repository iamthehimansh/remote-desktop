# SSH Tunnels (`names.himansh.in`) — self-hosted serveo

Expose any local port to a public `https://<name>.himansh.in` URL by running a
single `ssh -R` from any machine — like serveo.net / ngrok, but on your own
domain and infrastructure.

```
client:  ssh -R 80:localhost:3000 names.himansh.in   (cloudflared carries the ssh)
                 │
        Cloudflare tunnel  ── names.himansh.in → ssh://localhost:2222
                 ▼
   server/tunnel-server.ts  (pcdash-tunnel.service)
        :2222  ssh server (auth + interactive naming)
        :8090  http mux   ── *.himansh.in → forwarded to your local port
        :8091  control api (dashboard list/kill)
                 ▲
public:  https://<name>.himansh.in   (Cloudflare TLS, free)
```

## One-time client setup

A plain `ssh` cannot traverse Cloudflare's proxy, so each client needs
`cloudflared` once (it wraps SSH so Cloudflare can carry it). After this,
`ssh names.himansh.in` works with **no `-p`**.

```bash
# 1. install cloudflared
#    macOS:   brew install cloudflared
#    Windows: winget install Cloudflare.cloudflared
#    Linux:   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
#               -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# 2. add the ssh-config entry (use %h literally on Windows; printf needs %%h)
printf 'Host names.himansh.in\n    ProxyCommand cloudflared access ssh --hostname %%h\n' >> ~/.ssh/config
```

## Usage

```bash
ssh -R 80:localhost:3000 names.himansh.in
```

You'll be prompted for a subdomain:
- type a name → served at `https://<name>.himansh.in`
- press Enter → a random name is assigned
- if taken → you get suggestions and are re-prompted

Keep the SSH session open; the tunnel lives only while connected. The dashboard
lists active tunnels at **/dashboard/tunnels** (with a kill button).

HTTP, HTTPS and WebSocket targets are supported (raw non-HTTP TCP is not, since
Cloudflare's edge multiplexes by HTTP host).

## Authentication

The SSH server accepts the **`TUNNEL_PASSWORD`** env value (set in `.env.linux`)
via keyboard-interactive; if unset it falls back to the dashboard bcrypt hash
(`DASHBOARD_PASSWORD_HASH`). To skip the password entirely, add a client public
key to `data/tunnel/authorized_keys` (one OpenSSH key per line) — key auth is
then used automatically.

## Server / infra

- Process: `server/tunnel-server.ts`, run by `pcdash-tunnel.service`
  (systemd user service, auto-starts on boot). Manual run: `npm run tunnel`.
- Cloudflare DNS + ingress: `npm run setup-tunnel-ingress` (idempotent). Creates
  `names.himansh.in → ssh://localhost:2222` and `*.himansh.in → http://localhost:8090`.
- Host key: `data/tunnel/host_key` (generated on first run).
- Env overrides: `TUNNEL_SSH_PORT` (2222), `TUNNEL_HTTP_PORT` (8090),
  `TUNNEL_CONTROL_PORT` (8091), `TUNNEL_BASE_DOMAIN` (himansh.in).
