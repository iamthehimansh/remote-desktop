# NetGuard-VPN — Android App Spec

A Kotlin/Compose Android VPN client built on the existing NetGuard fork
(`iamthehimansh/NetGuard`). Extends the DNS-only firewall into a full
tunneling VPN that sends all traffic through a remote server at
`vpn.himansh.in`, while preserving NetGuard's per-app / per-domain rules.

---

## 1. Goals

1. The app appears in **Android Settings → Network & Internet → VPN**
   (standard VpnService integration, exactly like the official WireGuard
   or Outline apps).
2. Two user-selectable modes:
   - **Direct Mode** — all device traffic tunneled to the server,
     no filtering. Fast path.
   - **Managed Mode** ("App VPN") — traffic flows into NetGuard's local
     DNS-filter + per-app rules engine first, then the remaining allowed
     traffic is tunneled to the server.
3. One single `VpnService` interface at all times (Android only permits
   one active VPN app). The two modes are configurations of that
   service, not two separate services.
4. Server: VLESS-over-WebSocket-over-TLS on `vpn.himansh.in`, terminating
   at sing-box running on the home Pi through a Cloudflare Tunnel.
5. DNS inside the tunnel always routes to the Pi's Pi-hole
   (`10.1.10.1` within the tunnel network), so blocklists are
   applied regardless of mode.

---

## 2. Architecture

```
  ┌────────────────────────────────────────────────────────────────┐
  │                        Android Device                           │
  │                                                                 │
  │   Apps ──▶ OS networking ──▶ [NetGuard VpnService (tun)] ──┐   │
  │                                                              │   │
  │                   ┌─── Mode 1 (Direct) ────┐                │   │
  │                   │                         ▼                ▼   │
  │                   │                   ┌──────────────────────┐  │
  │                   │                   │  sing-box (libbox)   │  │
  │                   │                   │  inbound: tun        │  │
  │                   │                   │  outbound: vless-ws  │  │
  │                   │                   └──────────┬───────────┘  │
  │                   │                              │              │
  │                   └─── Mode 2 (Managed) ─────┐   │              │
  │                                              ▼   │              │
  │                                    [NetGuard DNS filter +       │
  │                                     per-app allow/block] ──────►│
  │                                                                 │
  └─────────────────────────────────────────────────────────┬───────┘
                                                            │
                                                  wss://vpn.himansh.in
                                                            │
                                                  (Cloudflare edge)
                                                            │
                                                   (Cloudflare Tunnel)
                                                            │
  ┌─────────────────────────────────────────────────────────▼───────┐
  │                      Raspberry Pi (home)                         │
  │                                                                  │
  │   cloudflared ──▶ 127.0.0.1:8080  [sing-box server]              │
  │                       │                                          │
  │                       │ VLESS-WS decode → raw packets            │
  │                       ▼                                          │
  │                   NAT (iptables MASQUERADE) ──▶ Internet         │
  │                       │                                          │
  │                       └────▶ Pi-hole DNS 53/udp (ad-block)       │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 3. Server config (reference — you will install this on the Pi)

`/etc/sing-box/config.json`:

```json
{
  "log": { "level": "warn", "timestamp": true },
  "inbounds": [
    {
      "type": "vless",
      "tag": "vless-in",
      "listen": "127.0.0.1",
      "listen_port": 8080,
      "users": [ { "uuid": "<SERVER_UUID>", "flow": "" } ],
      "transport": {
        "type": "ws",
        "path": "/netguard"
      }
    }
  ],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "block",  "tag": "block"  },
    { "type": "dns",    "tag": "dns-out" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" }
    ],
    "final": "direct"
  },
  "dns": {
    "servers": [
      { "tag": "pihole", "address": "127.0.0.1", "detour": "direct" }
    ],
    "final": "pihole"
  }
}
```

Cloudflare Tunnel ingress:

```yaml
- hostname: vpn.himansh.in
  service: http://localhost:8080
  originRequest:
    noTLSVerify: true
```

---

## 3b. Retry / reconnection behavior

**Server side (sing-box on Pi):**
- Launched via `systemd` with `Restart=always RestartSec=3s RestartSteps=10 RestartMaxDelaySec=60s`.
  Exponential backoff: 3s → 6s → 12s → ... → capped at 60s. Survives OOM,
  crash, upstream network loss, CF Tunnel bounce.
- `sing-box.service` depends on `cloudflared.service`; if the tunnel flaps
  sing-box stays up — cloudflared reconnects on its own.
- Pi-hole hiccups? sing-box `dns` block uses `type: local` — falls back to
  system resolver, never panics the tunnel.

**Client side (NetGuard Android app):**
1. **WebSocket / VLESS retry** — sing-box's `libbox` has built-in
   connection retry on `outbound.vless` with WS transport. Configure
   via `route.rules.domain_strategy` + the `experimental.clash_api`
   control loop. Explicit knobs to set in the app's generated config:
   ```json
   "experimental": {
     "cache_file": { "enabled": true, "path": "cache.db" }
   },
   "outbounds": [{
     "type": "vless",
     "tag": "vless-out",
     "connect_timeout": "10s",
     "tcp_fast_open": true,
     "tcp_multi_path": false,
     ...
   }]
   ```
2. **VpnService lifecycle retry** — Android will kill the VpnService on
   backgrounding or network switch. The app registers a
   `ConnectivityManager.NetworkCallback` to detect network changes;
   on each change it calls `Libbox.newService(cfg).start(fd)` again
   with fresh state. Between restarts it keeps the TUN fd open so
   apps see a brief "no route" pause rather than losing their
   sockets.
3. **Exponential backoff in app code** — when the last connect
   attempt fails:
   ```kotlin
   val backoff = listOf(2, 5, 10, 20, 40, 60, 60, 60).map { it * 1000L }
   var i = 0
   while (!connected) {
       delay(backoff[i.coerceAtMost(backoff.lastIndex)])
       i++
       attemptConnect()
   }
   ```
   Reset the counter on a successful connect.
4. **Foreground service** — keep the VPN notification live even
   between retries so Android doesn't reclaim the service.
5. **Persistent kill-switch option** — in Managed mode, when the
   tunnel is down block all non-DNS traffic (drop instead of
   forward). Exposed as a checkbox in Settings.
6. **Health probe** — every 30s send an HTTP GET inside the tunnel
   to `https://www.gstatic.com/generate_204`. If 3 consecutive
   probes fail or time out (>5s), force a reconnect even if the
   socket still looks alive.

**Offline queue:** none — DNS queries that arrive during a retry
window receive an immediate `SERVFAIL` so the requesting app's own
retry backoff takes over. Do NOT buffer queries (leaks memory on
long outages).

---

## 4. Client config the app generates for sing-box

```json
{
  "log": { "level": "warn" },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "tun0",
      "inet4_address": "172.19.0.1/28",
      "mtu": 1420,
      "auto_route": true,
      "strict_route": true,
      "stack": "system",
      "sniff": true
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "vless-out",
      "server": "vpn.himansh.in",
      "server_port": 443,
      "uuid": "<SAME_UUID>",
      "tls": { "enabled": true, "server_name": "vpn.himansh.in" },
      "transport": { "type": "ws", "path": "/netguard", "headers": { "Host": "vpn.himansh.in" } }
    },
    { "type": "dns", "tag": "dns-out" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" }
    ],
    "final": "vless-out"
  },
  "dns": {
    "servers": [
      { "tag": "remote-pihole", "address": "10.1.10.1", "detour": "vless-out" }
    ],
    "strategy": "ipv4_only",
    "final": "remote-pihole"
  }
}
```

For Mode 2 (Managed), NetGuard rewrites the config **before** handing it
to sing-box: `inbounds` stays the same, but a middleware layer in the
app consumes DNS queries from the tun inbound, applies local block
rules, and only forwards allowed flows to sing-box. See §6.

---

## 5. High-level implementation prompt (what to ask the coder / IDE AI)

```
You are extending iamthehimansh/NetGuard (Kotlin, Compose, Hilt, Room)
to add a full-tunnel VPN backend alongside the existing DNS-only filter.

REQUIREMENTS
============

A. Add sing-box as an embedded library
   - Add dependency: `io.nekohasekai:libbox:<latest>` (Apache-2.0)
     from Maven Central, or vendor the official libbox.aar from
     https://github.com/SagerNet/sing-box/releases.
   - Target ABI: arm64-v8a + armeabi-v7a + x86_64.

B. Modify `vpn/NetGuardVpnService.kt`:
   - Keep the existing `establishTunnel()` Builder.
   - Add a `TunnelMode` enum: `DIRECT`, `MANAGED`, `DNS_FILTER_ONLY`
     (current NetGuard behaviour).
   - When mode = DIRECT or MANAGED:
       * Do NOT start the custom DNS interception loop.
       * Instead, hand the VpnService's ParcelFileDescriptor to libbox
         via `Libbox.newService(config).start(fd)`.
       * sing-box owns the tun loop.
   - When mode = DNS_FILTER_ONLY: unchanged.

C. New screen in UI: `VpnServerConfigScreen`
   - Fields: server domain, UUID, WS path, server port, SNI (optional),
     alpn (optional).
   - Persist to Room in a new `vpn_server_config` table, one row.
   - QR import: scan a sing-box share link (`vless://…`) and populate.

D. New screen: `ConnectionModeScreen`
   - Radio group: Direct / Managed / DNS-filter only.
   - Save to SharedPreferences + reflect in ViewModel state flow.
   - When changed while VPN is active, cleanly restart the service.

E. Managed Mode (§6)
   - Before starting libbox, install a local DNS interceptor on
     the TUN fd. The interceptor:
       * Parses UDP/53 packets exactly like the existing
         `NetGuardVpnService.handleDnsPacket()`.
       * For each query, check Room rules: if domain or originating
         uid is blocked, inject a 0.0.0.0 NXDOMAIN-like response
         and drop the original.
       * For allowed queries, write them back to the tun fd
         unchanged — libbox picks them up and tunnels to server.
   - Non-DNS packets flow through untouched.
   - This requires splitting the tun fd into two readers — use a
     `NonBlockingTunReader` that tees packets to libbox for
     non-DNS and to the filter for UDP/53.
   - Libbox alternative: keep libbox in control of the fd and
     implement the DNS filter as a sing-box `rule_set` pointing to a
     local DoH / DoT server that the app runs in-process. Simpler
     but adds an extra hop.

F. Settings: "Show in system VPN settings"
   - Nothing special to implement — any VpnService is automatically
     listed under Settings → Network → VPN in Android.
   - Add a small how-to card on the main screen pointing the user
     there for Always-on toggle.

G. Notification
   - Keep the foreground service notification NetGuard already has.
   - Update text: "NetGuard — Managed VPN to vpn.himansh.in" etc.

H. Keys/UUIDs
   - Store server UUID encrypted via Android Keystore + EncryptedSharedPreferences.
   - Never log it.

I. Testing
   - Unit tests for DNS packet builder (Mode 2 filter injection).
   - Integration test: spin up sing-box server in CI via Docker,
     connect app, verify Google resolves to a non-0.0.0.0 IP
     and a blocked domain resolves to 0.0.0.0.

OUT OF SCOPE
============
- Multiple server profiles (start with one).
- Split tunneling by app (NetGuard already has per-app rules;
  Managed Mode covers this).
- IPv6 inside tunnel (disable; sing-box `ipv4_only`).

DELIVERABLES
============
1. Updated `NetGuardVpnService.kt` with mode switch.
2. New Compose screens + ViewModels.
3. Room migration script adding `vpn_server_config`.
4. README section: "Running your own server (sing-box on any Linux)".
5. GitHub Actions workflow: build debug + release APK with
   signing config from secrets.
```

---

## 6. Managed-mode filter pseudocode

```kotlin
// Runs on the VPN tun reader thread before libbox sees the packet.
fun interceptPacket(pkt: ByteArray, len: Int): Action {
    val ip = IpHeader.parse(pkt, len) ?: return Action.Forward
    if (ip.protocol != UDP || ip.destPort != 53) return Action.Forward

    val dns = DnsPacket.parse(ip.payload) ?: return Action.Forward
    val qname = dns.firstQuestion?.name ?: return Action.Forward

    val uid = connectivityManager.getUidFor(ip) ?: -1
    if (rules.isAppBlocked(uid) || rules.isDomainBlocked(qname)) {
        val resp = DnsPacket.synthBlocked(dns, rcode = NXDOMAIN)
        writeToTun(resp.toIpPacket(ip.reversed()))
        return Action.Drop
    }
    return Action.Forward     // libbox will tunnel it
}
```

---

## 7. How the "custom VPN in system settings" works

There is no special Android API to register as a "custom VPN option" in
Settings. Android already surfaces **any** app with a VpnService under
**Settings → Network & Internet → VPN**. The app will appear as
`NetGuard` automatically once `VpnService.prepare()` has been called at
least once and the user accepts the system consent dialog.

The "Always-on VPN" toggle next to the entry lets the user force the
tunnel to reconnect on boot and block traffic when the VPN drops —
that is the Android equivalent of "direct connect". Document this in
onboarding.

---

## 8. User-visible flows

**First run:**
1. User opens app → sees onboarding → "Configure server" → pastes
   `vless://…` link or scans QR.
2. Picks mode (defaults to Managed).
3. Taps "Connect" → Android consent dialog → VPN up.

**Switching mode:**
- Settings → Connection mode → pick one → service restarts.

**Status row on main screen:**
- Server: vpn.himansh.in
- Mode: Managed
- Connected for: 01:23:45
- RX / TX: 12.3 / 4.5 MB
- Blocked queries: 132
- Tunneled queries: 982

---

## 9. Build matrix

| ABI         | libbox size | target |
| ----------- | ----------- | ------ |
| arm64-v8a   | ~8 MB       | modern phones |
| armv7a      | ~7 MB       | older phones |
| x86_64      | ~9 MB       | emulators, Chromebooks |

Resulting APK (all ABIs + NetGuard base): ~30 MB.

---

## 9b. Live server details (what to put in the app for testing)

```
Protocol:   VLESS
Address:    vpn.himansh.in
Port:       443
UUID:       1e54c2e5-b5b8-44eb-ace9-b69102e34c5a
Flow:       (empty)
Encryption: none
Transport:  WebSocket
WS Path:    /netguard
WS Host:    vpn.himansh.in
Security:   TLS
SNI:        vpn.himansh.in
ALPN:       http/1.1
Fingerprint (uTLS): chrome
```

Share link (importable into v2rayNG, Hiddify, NekoBox, or sing-box):

```
vless://1e54c2e5-b5b8-44eb-ace9-b69102e34c5a@vpn.himansh.in:443?type=ws&security=tls&sni=vpn.himansh.in&host=vpn.himansh.in&path=%2Fnetguard&encryption=none&alpn=http%2F1.1&fp=chrome&headerType=none#NetGuard-Pi
```

> **Note on User-Agent:** Cloudflare Bot Fight Mode blocks requests
> with empty or "curl" / "python-requests" UAs. sing-box sends a
> Chrome-like UA by default when `fp=chrome`, so this is fine. If you
> write the WS client from scratch, send a real browser UA or CF
> will return 403.

---

## 10. Security notes

- CF Tunnel terminates TLS at the edge; traffic between CF edge and
  the Pi is re-wrapped by cloudflared (its own TLS). End-to-end is
  covered.
- Cloudflare can see your VPN metadata (SNI = `vpn.himansh.in`,
  WebSocket upgrade path = `/netguard`) but not the traffic inside
  VLESS (still encrypted with the UUID-based handshake).
- The UUID is effectively your password. Rotate via the sing-box
  config + push a new QR to the app.
- If you later move to a paid VPS, replace the VLESS inbound on the
  Pi with WireGuard UDP on the VPS and the app flips over by updating
  its server config.
