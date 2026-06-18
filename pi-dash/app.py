"""Minimal Pi dashboard — Flask app.
Single-user, standalone auth, runs on pi.himansh.in via Cloudflare tunnel.

Features:
  - Login (password, optional TOTP)
  - Overview (CPU, RAM, temp, uptime, Pi-hole stats, PC online, Wake PC)
  - Apps (Pi-hole first, plus custom)
  - Ports (dynamic subdomains via Cloudflare API)
  - Terminal (proxies to ttyd on localhost:7681)
  - Files (browse / upload / download / delete under a configurable root)

Runs under gunicorn in production (see systemd unit).
"""
from __future__ import annotations
import os, json, time, secrets, subprocess, re, shutil, mimetypes, base64
from pathlib import Path
from functools import wraps
from datetime import datetime, timedelta, timezone

from flask import (
    Flask, request, jsonify, render_template, redirect, url_for,
    make_response, send_file, abort, Response, stream_with_context,
)
import jwt  # pyjwt
import bcrypt
import requests
from wakeonlan import send_magic_packet
import pyotp
import qrcode
import io
from webauthn import (
    generate_registration_options, verify_registration_response,
    generate_authentication_options, verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor, AuthenticatorSelectionCriteria,
    ResidentKeyRequirement, UserVerificationRequirement,
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from flask_sock import Sock
import pty, select, fcntl, termios, struct, threading, signal

# ---- Config ----
ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

ENV_PATH = ROOT / ".env"
CONFIG_PATH = DATA_DIR / "config.json"
PORTS_PATH = DATA_DIR / "ports.json"
APPS_PATH = DATA_DIR / "apps.json"


def load_env():
    if not ENV_PATH.exists():
        return
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

load_env()

JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_hex(32)
COOKIE_NAME = f"__Secure-pidash-{os.environ.get('COOKIE_SUFFIX', 'nosuffix')}"
COOKIE_INSECURE = os.environ.get("DEV_INSECURE_COOKIE", "") == "1"
FILE_ROOT = Path(os.environ.get("FILE_ROOT", "/home/pi")).resolve()
TTYD_PORT = int(os.environ.get("TTYD_PORT", "7681"))
PC_MAC = os.environ.get("PC_MAC", "")
PC_IP = os.environ.get("PC_IP", "")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CLOUDFLARE_ZONE_ID = os.environ.get("CLOUDFLARE_ZONE_ID", "")
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
TUNNEL_ID = os.environ.get("TUNNEL_ID", "")

# Single-user config: password hash lives here
def read_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"password_hash": "", "totp_secret": "", "totp_enabled": False}
    return json.loads(CONFIG_PATH.read_text())

def write_config(cfg: dict):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


# ---- App ----
app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "static"))
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500MB upload
sock = Sock(app)


def make_token() -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": "admin", "exp": exp}, JWT_SECRET, algorithm="HS256")


def verify_token(tok: str) -> bool:
    try:
        jwt.decode(tok, JWT_SECRET, algorithms=["HS256"])
        return True
    except Exception:
        return False


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kw):
        tok = request.cookies.get(COOKIE_NAME, "")
        if not tok or not verify_token(tok):
            if request.path.startswith("/api/") or request.headers.get("accept", "").startswith("application/json"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login_page", next=request.path))
        return fn(*args, **kw)
    return wrapper


# ---- Routes ----
@app.route("/")
@require_auth
def index():
    return render_template("dashboard.html", ttyd_port=TTYD_PORT)


@app.route("/login", methods=["GET"])
def login_page():
    return render_template("login.html")


@app.route("/api/login", methods=["POST"])
def login():
    if PASSWORD_LOGIN_DISABLED:
        return jsonify({"error": "Password login is disabled. Use passkey or TOTP."}), 403
    data = request.get_json(silent=True) or {}
    pw = data.get("password", "")
    cfg = read_config()
    if not cfg.get("password_hash"):
        return jsonify({"error": "Dashboard not initialized. Run set-password.py first."}), 500
    if not bcrypt.checkpw(pw.encode(), cfg["password_hash"].encode()):
        return jsonify({"error": "Invalid password"}), 401

    resp = make_response(jsonify({"ok": True}))
    resp.set_cookie(
        COOKIE_NAME, make_token(),
        httponly=True, secure=not COOKIE_INSECURE, samesite="Lax",
        path="/", max_age=7 * 24 * 3600,
    )
    return resp


@app.route("/api/logout", methods=["POST"])
def logout():
    resp = make_response(jsonify({"ok": True}))
    resp.set_cookie(COOKIE_NAME, "", expires=0, path="/")
    return resp


# ---- Methods discovery (public) ----
# Password login is intentionally disabled — only passkey and TOTP allowed.
PASSWORD_LOGIN_DISABLED = True


@app.route("/api/methods")
def list_methods():
    cfg = read_config()
    return jsonify({
        "password": False if PASSWORD_LOGIN_DISABLED else bool(cfg.get("password_hash")),
        "totp": bool(cfg.get("totp_secret") and cfg.get("totp_enabled")),
        "passkey": bool(cfg.get("passkeys")),
    })


# ---- TOTP ----
def _set_session_cookie(resp):
    resp.set_cookie(
        COOKIE_NAME, make_token(),
        httponly=True, secure=not COOKIE_INSECURE, samesite="Lax",
        path="/", max_age=7 * 24 * 3600,
    )


@app.route("/api/totp/setup", methods=["POST"])
@require_auth
def totp_setup():
    cfg = read_config()
    secret = pyotp.random_base32()
    cfg["totp_secret"] = secret
    cfg["totp_enabled"] = False
    write_config(cfg)
    otpauth = pyotp.totp.TOTP(secret).provisioning_uri(name="admin", issuer_name="Pi Dashboard")
    buf = io.BytesIO()
    qrcode.make(otpauth).save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    return jsonify({"secret": secret, "otpauth": otpauth, "qrCode": data_url})


@app.route("/api/totp/enable", methods=["POST"])
@require_auth
def totp_enable():
    code = (request.get_json(silent=True) or {}).get("code", "")
    cfg = read_config()
    secret = cfg.get("totp_secret")
    if not secret:
        return jsonify({"error": "Run setup first"}), 400
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 401
    cfg["totp_enabled"] = True
    cfg["totp_enabled_at"] = datetime.now(timezone.utc).isoformat()
    write_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/totp/enable", methods=["DELETE"])
@require_auth
def totp_disable():
    cfg = read_config()
    cfg.pop("totp_secret", None)
    cfg.pop("totp_enabled", None)
    cfg.pop("totp_enabled_at", None)
    write_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/totp/login", methods=["POST"])
def totp_login():
    code = (request.get_json(silent=True) or {}).get("code", "")
    cfg = read_config()
    secret = cfg.get("totp_secret")
    if not secret or not cfg.get("totp_enabled"):
        return jsonify({"error": "TOTP not enabled"}), 400
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 401
    resp = make_response(jsonify({"ok": True}))
    _set_session_cookie(resp)
    return resp


# ---- Passkey (WebAuthn) ----
RP_ID = os.environ.get("PASSKEY_RP_ID", "pi.himansh.in")
RP_NAME = "Pi Dashboard"
# Origin built per-request so dev on localhost also works
def _expected_origin():
    host = request.headers.get("host", RP_ID)
    scheme = "http" if host.startswith("localhost") else "https"
    return f"{scheme}://{host}"


def _load_passkeys() -> list[dict]:
    return read_config().get("passkeys", [])


def _save_passkeys(items: list[dict]):
    cfg = read_config()
    cfg["passkeys"] = items
    write_config(cfg)


@app.route("/api/passkey/register-options")
@require_auth
def passkey_register_options():
    cfg = read_config()
    existing = cfg.get("passkeys", [])
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_name="admin",
        user_display_name="Admin",
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(p["id"]))
            for p in existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
        ],
    )
    cfg["passkey_challenge"] = bytes_to_base64url(options.challenge)
    write_config(cfg)
    return jsonify(json.loads(options_to_json(options)))


@app.route("/api/passkey/register", methods=["POST"])
@require_auth
def passkey_register():
    body = request.get_json(silent=True) or {}
    credential = body.get("credential")
    name = body.get("name") or f"Passkey {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    cfg = read_config()
    challenge_b64 = cfg.get("passkey_challenge")
    if not challenge_b64:
        return jsonify({"error": "No challenge"}), 400
    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=RP_ID,
            expected_origin=_expected_origin(),
        )
    except Exception as e:
        return jsonify({"error": f"Verification failed: {e}"}), 400

    pks = cfg.get("passkeys", [])
    pks.append({
        "id": bytes_to_base64url(verification.credential_id),
        "public_key": bytes_to_base64url(verification.credential_public_key),
        "counter": verification.sign_count,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    cfg["passkeys"] = pks
    cfg.pop("passkey_challenge", None)
    write_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/passkey/list")
@require_auth
def passkey_list():
    return jsonify([
        {"id": p["id"], "name": p["name"], "created_at": p.get("created_at")}
        for p in _load_passkeys()
    ])


@app.route("/api/passkey/delete", methods=["DELETE"])
@require_auth
def passkey_delete():
    pid = (request.get_json(silent=True) or {}).get("id", "")
    _save_passkeys([p for p in _load_passkeys() if p["id"] != pid])
    return jsonify({"ok": True})


@app.route("/api/passkey/login-options")
def passkey_login_options():
    cfg = read_config()
    passkeys = cfg.get("passkeys", [])
    if not passkeys:
        return jsonify({"error": "No passkeys"}), 404
    options = generate_authentication_options(
        rp_id=RP_ID,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(p["id"]))
            for p in passkeys
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    cfg["passkey_auth_challenge"] = bytes_to_base64url(options.challenge)
    write_config(cfg)
    return jsonify(json.loads(options_to_json(options)))


@app.route("/api/passkey/login", methods=["POST"])
def passkey_login():
    credential = request.get_json(silent=True) or {}
    cfg = read_config()
    challenge_b64 = cfg.get("passkey_auth_challenge")
    if not challenge_b64:
        return jsonify({"error": "No challenge"}), 400
    pk = next((p for p in cfg.get("passkeys", []) if p["id"] == credential.get("id")), None)
    if not pk:
        return jsonify({"error": "Unknown passkey"}), 404
    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=RP_ID,
            expected_origin=_expected_origin(),
            credential_public_key=base64url_to_bytes(pk["public_key"]),
            credential_current_sign_count=pk["counter"],
        )
    except Exception as e:
        return jsonify({"error": f"Verification failed: {e}"}), 401

    # Update counter
    pk["counter"] = verification.new_sign_count
    write_config(cfg)

    resp = make_response(jsonify({"ok": True}))
    _set_session_cookie(resp)
    return resp


# ---- System stats ----
def _read_temp() -> float | None:
    try:
        out = subprocess.check_output(["vcgencmd", "measure_temp"], text=True, timeout=2)
        m = re.search(r"([\d.]+)", out)
        return float(m.group(1)) if m else None
    except Exception:
        return None


def _read_meminfo() -> dict:
    try:
        text = Path("/proc/meminfo").read_text()
        def get(k):
            m = re.search(rf"^{k}:\s+(\d+)", text, re.M)
            return int(m.group(1)) * 1024 if m else 0
        total = get("MemTotal")
        available = get("MemAvailable")
        return {"total": total, "used": total - available, "usage": (total - available) / total * 100 if total else 0}
    except Exception:
        return {"total": 0, "used": 0, "usage": 0}


def _read_loadavg():
    try:
        return [float(x) for x in Path("/proc/loadavg").read_text().split()[:3]]
    except Exception:
        return [0, 0, 0]


def _uptime_seconds():
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except Exception:
        return 0


@app.route("/api/stats")
@require_auth
def stats():
    return jsonify({
        "cpu_load": _read_loadavg(),
        "memory": _read_meminfo(),
        "temp_c": _read_temp(),
        "uptime_sec": _uptime_seconds(),
        "hostname": os.uname().nodename,
        "pc_online": _ping(PC_IP) if PC_IP else None,
    })


def _ping(ip: str) -> bool:
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", ip], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


# ---- Pi-hole stats (via Pi-hole v6 REST API on localhost) ----
@app.route("/api/pihole")
@require_auth
def pihole_stats():
    try:
        r = requests.get("http://127.0.0.1/api/stats/summary", timeout=3)
        return jsonify(r.json())
    except Exception:
        try:
            r = requests.get("http://127.0.0.1/admin/api.php?summaryRaw", timeout=3)  # v5 fallback
            return jsonify(r.json())
        except Exception as e:
            return jsonify({"error": str(e)}), 502


# ---- Wake on LAN ----
@app.route("/api/wake-pc", methods=["POST"])
@require_auth
def wake_pc():
    if not PC_MAC:
        return jsonify({"error": "PC_MAC not configured"}), 400
    try:
        send_magic_packet(PC_MAC)
        return jsonify({"ok": True, "mac": PC_MAC})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/pc-status")
@require_auth
def pc_status():
    if not PC_IP:
        return jsonify({"online": False, "error": "PC_IP not set"})
    return jsonify({"online": _ping(PC_IP), "ip": PC_IP})


# ---- OAuth clients + authorization codes (for pidash-gate Worker) ----
OAUTH_CLIENTS_PATH = DATA_DIR / "oauth-clients.json"
OAUTH_CODES_PATH = DATA_DIR / "oauth-codes.json"
OAUTH_CODE_TTL = 90  # seconds
WORKER_NAME_PI = "pidash-gate"

RESERVED_SUBDOMAINS = {
    "pc", "pi", "dns", "vpn", "www", "mail", "api",
    "ftp", "ns1", "ns2", "mx", "smtp", "imap", "pop",
}


def _read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2))


def oauth_clients() -> dict:
    return _read_json(OAUTH_CLIENTS_PATH, {})


def oauth_save_clients(d: dict):
    _write_json(OAUTH_CLIENTS_PATH, d)


def oauth_add_client(cid: str, redirect_uris: list[str]) -> dict:
    clients = oauth_clients()
    existing = clients.get(cid)
    client = {
        "clientId": cid,
        "clientSecret": existing["clientSecret"] if existing else secrets.token_hex(32),
        "redirectUris": redirect_uris,
        "createdAt": existing["createdAt"] if existing else datetime.now(timezone.utc).isoformat(),
    }
    clients[cid] = client
    oauth_save_clients(clients)
    return client


def oauth_remove_client(cid: str):
    clients = oauth_clients()
    if cid in clients:
        del clients[cid]
        oauth_save_clients(clients)


def oauth_get_client(cid: str) -> dict | None:
    return oauth_clients().get(cid)


def oauth_issue_code(cid: str, redirect_uri: str) -> str:
    codes = _read_json(OAUTH_CODES_PATH, {})
    now = time.time()
    codes = {k: v for k, v in codes.items() if not v.get("used") and v.get("exp", 0) > now}
    code = secrets.token_urlsafe(24)
    codes[code] = {"clientId": cid, "redirectUri": redirect_uri, "exp": now + OAUTH_CODE_TTL, "used": False}
    _write_json(OAUTH_CODES_PATH, codes)
    return code


def oauth_consume_code(code: str, cid: str, redirect_uri: str) -> bool:
    codes = _read_json(OAUTH_CODES_PATH, {})
    entry = codes.get(code)
    now = time.time()
    if (not entry or entry.get("used")
        or entry.get("clientId") != cid or entry.get("redirectUri") != redirect_uri
        or entry.get("exp", 0) < now):
        return False
    entry["used"] = True
    codes[code] = entry
    _write_json(OAUTH_CODES_PATH, codes)
    return True


def oauth_app_jwt(cid: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=24)
    return jwt.encode({"sub": "admin", "kind": "app", "app": cid, "exp": exp}, JWT_SECRET, algorithm="HS256")


# ---- Cloudflare Worker route management (pidash-gate) ----
def worker_add_route(hostname: str) -> str:
    r = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/workers/routes",
        json={"pattern": f"{hostname}/*", "script": WORKER_NAME_PI},
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=10,
    ).json()
    if not r.get("success"):
        raise RuntimeError((r.get("errors") or [{"message": "unknown"}])[0]["message"])
    return r["result"]["id"]


def worker_remove_route(route_id: str):
    requests.delete(
        f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/workers/routes/{route_id}",
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=10,
    )


def worker_sync_secrets():
    payload = json.dumps({cid: c["clientSecret"] for cid, c in oauth_clients().items()})
    requests.put(
        f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/workers/scripts/{WORKER_NAME_PI}/secrets",
        json={"name": "OAUTH_CLIENT_SECRETS", "text": payload, "type": "secret_text"},
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=10,
    )


# ---- OAuth routes ----
def _cors():
    origin = request.headers.get("Origin", "")
    ok = origin if (origin.startswith("https://") and (origin.endswith(".himansh.in"))) else "null"
    return {
        "Access-Control-Allow-Origin": ok,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
    }


@app.route("/api/oauth/authorize", methods=["GET"])
def oauth_authorize():
    cid = request.args.get("client_id", "")
    redirect_uri = request.args.get("redirect_uri", "")
    state = request.args.get("state", "")
    prompt = request.args.get("prompt", "")

    client = oauth_get_client(cid)
    if not client:
        return jsonify({"error": "invalid_client"}), 400
    if redirect_uri not in client["redirectUris"]:
        return jsonify({"error": "invalid_redirect_uri"}), 400

    tok = request.cookies.get(COOKIE_NAME, "")
    if tok and verify_token(tok):
        code = oauth_issue_code(cid, redirect_uri)
        sep = "&" if "?" in redirect_uri else "?"
        extra = f"&state={state}" if state else ""
        return redirect(f"{redirect_uri}{sep}code={code}{extra}")

    if prompt == "silent":
        sep = "&" if "?" in redirect_uri else "?"
        extra = f"&state={state}" if state else ""
        return redirect(f"{redirect_uri}{sep}error=login_required{extra}")

    from urllib.parse import quote
    qs = request.query_string.decode()
    return redirect(f"https://pi.himansh.in/login?return={quote('/api/oauth/authorize?' + qs)}")


@app.route("/api/oauth/token", methods=["POST"])
def oauth_token():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Basic "):
        return jsonify({"error": "invalid_client"}), 401
    try:
        decoded = base64.b64decode(auth[6:]).decode()
        cid, _, csec = decoded.partition(":")
    except Exception:
        return jsonify({"error": "invalid_client"}), 401
    client = oauth_get_client(cid)
    if not client or client["clientSecret"] != csec:
        return jsonify({"error": "invalid_client"}), 401
    body = request.get_json(silent=True) or {}
    code, redirect_uri = body.get("code"), body.get("redirectUri")
    if not code or not redirect_uri:
        return jsonify({"error": "invalid_request"}), 400
    if not oauth_consume_code(code, cid, redirect_uri):
        return jsonify({"error": "invalid_grant"}), 400
    return jsonify({"access_token": oauth_app_jwt(cid), "token_type": "Bearer", "expires_in": 24 * 3600})


@app.route("/api/oauth/password", methods=["POST", "OPTIONS"])
def oauth_password():
    if request.method == "OPTIONS":
        return ("", 204, _cors())
    if PASSWORD_LOGIN_DISABLED:
        return (jsonify({"error": "Password login is disabled"}), 403, _cors())
    body = request.get_json(silent=True) or {}
    pw = body.get("password", "")
    cid, redirect_uri = body.get("clientId", ""), body.get("redirectUri", "")
    client = oauth_get_client(cid)
    if not client or redirect_uri not in client["redirectUris"]:
        return (jsonify({"error": "invalid_client"}), 400, _cors())
    cfg = read_config()
    if not cfg.get("password_hash") or not bcrypt.checkpw(pw.encode(), cfg["password_hash"].encode()):
        return (jsonify({"error": "Invalid credentials"}), 401, _cors())
    return (jsonify({"code": oauth_issue_code(cid, redirect_uri)}), 200, _cors())


@app.route("/api/oauth/totp", methods=["POST", "OPTIONS"])
def oauth_totp_exchange():
    if request.method == "OPTIONS":
        return ("", 204, _cors())
    body = request.get_json(silent=True) or {}
    totp_code = body.get("totp", "")
    cid, redirect_uri = body.get("clientId", ""), body.get("redirectUri", "")
    client = oauth_get_client(cid)
    if not client or redirect_uri not in client["redirectUris"]:
        return (jsonify({"error": "invalid_client"}), 400, _cors())
    cfg = read_config()
    sec = cfg.get("totp_secret")
    if not sec or not cfg.get("totp_enabled"):
        return (jsonify({"error": "TOTP not enabled"}), 400, _cors())
    if not pyotp.TOTP(sec).verify(totp_code, valid_window=1):
        return (jsonify({"error": "Invalid code"}), 401, _cors())
    return (jsonify({"code": oauth_issue_code(cid, redirect_uri)}), 200, _cors())


# Alias that the Worker expects for discovering login methods
@app.route("/api/auth/methods")
def auth_methods():
    return list_methods()


# ---- TCP health probe used by ports + apps ----
def _tcp_alive(host: str, port: int, timeout: float = 1.0) -> bool:
    import socket as _s
    try:
        with _s.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _ensure_tunnel(hostname: str, port: int) -> str:
    existing = cf_list_records(hostname)
    dns_record_id = None
    for rec in existing:
        if rec.get("type") == "CNAME":
            if TUNNEL_ID in (rec.get("content") or ""):
                dns_record_id = rec["id"]
                break
            else:
                raise RuntimeError(f"{hostname} already owned by another service")
    if not dns_record_id:
        rec = cf_create_cname(hostname.split(".")[0])
        dns_record_id = rec["id"]
    ingress = cf_get_tunnel_ingress()
    ingress = [r for r in ingress if r.get("hostname") != hostname]
    ingress.insert(-1, {"hostname": hostname, "service": f"http://localhost:{port}"})
    cf_put_tunnel_ingress(ingress)
    return dns_record_id


def _cleanup_tunnel(hostname: str, dns_record_id: str | None):
    try:
        ingress = [r for r in cf_get_tunnel_ingress() if r.get("hostname") != hostname]
        cf_put_tunnel_ingress(ingress)
    except Exception:
        pass
    try:
        if dns_record_id:
            cf_delete_record(dns_record_id)
        else:
            for rec in cf_list_records(hostname):
                cf_delete_record(rec["id"])
    except Exception:
        pass


# ---- Ports ----
def load_ports() -> list[dict]:
    if not PORTS_PATH.exists():
        return []
    return json.loads(PORTS_PATH.read_text())


def save_ports(items: list[dict]):
    PORTS_PATH.write_text(json.dumps(items, indent=2))


def cf_list_records(name: str) -> list[dict]:
    r = requests.get(
        f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        params={"name": name},
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
        timeout=10,
    )
    return r.json().get("result", [])


def cf_create_cname(subdomain: str) -> dict:
    r = requests.post(
        f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
        json={
            "type": "CNAME", "name": subdomain,
            "content": f"{TUNNEL_ID}.cfargotunnel.com",
            "proxied": True, "comment": "pi-dash port forward",
        },
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
        timeout=10,
    )
    data = r.json()
    if not data.get("success"):
        raise RuntimeError((data.get("errors") or [{"message": "unknown"}])[0]["message"])
    return data["result"]


def cf_delete_record(record_id: str):
    requests.delete(
        f"https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}",
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"},
        timeout=10,
    )


def cf_get_tunnel_ingress() -> list[dict]:
    r = requests.get(
        f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations",
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=10,
    )
    return (r.json().get("result") or {}).get("config", {}).get("ingress") or [{"service": "http_status:404"}]


def cf_put_tunnel_ingress(ingress: list[dict]):
    requests.put(
        f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations",
        json={"config": {"ingress": ingress}},
        headers={"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}, timeout=10,
    )


@app.route("/api/ports", methods=["GET"])
@require_auth
def ports_list():
    items = load_ports()
    for it in items:
        it["status"] = "active" if _tcp_alive("127.0.0.1", it["port"]) else "unreachable"
    return jsonify(items)


@app.route("/api/ports", methods=["POST"])
@require_auth
def ports_add():
    body = request.get_json(silent=True) or {}
    sub = (body.get("subdomain") or "").strip().lower()
    port = int(body.get("port") or 0)
    protocol = (body.get("protocol") or "http").lower()
    if not re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?", sub):
        return jsonify({"error": "Invalid subdomain"}), 400
    if sub in RESERVED_SUBDOMAINS:
        return jsonify({"error": f"subdomain '{sub}' is reserved"}), 400
    if not (1 <= port <= 65535):
        return jsonify({"error": "Invalid port"}), 400

    hostname = f"{sub}.himansh.in"
    try:
        dns_record_id = _ensure_tunnel(hostname, port)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    items = load_ports()
    items.append({
        "id": secrets.token_hex(4), "subdomain": sub, "port": port,
        "hostname": hostname, "protocol": protocol,
        "dnsRecordId": dns_record_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })
    save_ports(items)
    return jsonify(items[-1])


@app.route("/api/ports/<fwd_id>", methods=["DELETE"])
@require_auth
def ports_del(fwd_id: str):
    items = load_ports()
    target = next((i for i in items if i["id"] == fwd_id), None)
    if not target:
        return jsonify({"error": "not found"}), 404
    _cleanup_tunnel(target["hostname"], target.get("dnsRecordId"))
    save_ports([i for i in items if i["id"] != fwd_id])
    return jsonify({"ok": True})


# ---- Apps ----
DEFAULT_APPS = [
    {
        "id": "pihole", "name": "Pi-hole", "icon": "Shield",
        "description": "Network-wide ad blocker + DNS",
        "subdomain": "dns", "port": 80, "path": "/admin/",
        "status": "running", "custom": False, "authEnabled": False,
    },
    {
        "id": "vnc", "name": "Remote Desktop (VNC)", "icon": "Monitor",
        "description": "Browser-based VNC via noVNC",
        "subdomain": "vnc", "port": 6080, "path": "/vnc.html?autoconnect=1&resize=remote",
        "status": "stopped", "custom": False, "authEnabled": False,
        "service": "pi-vnc",
    },
]


def load_apps() -> list[dict]:
    if not APPS_PATH.exists():
        APPS_PATH.write_text(json.dumps(DEFAULT_APPS, indent=2))
        return list(DEFAULT_APPS)
    apps = json.loads(APPS_PATH.read_text())
    ids = {a["id"] for a in apps}
    for d in DEFAULT_APPS:
        if d["id"] not in ids:
            apps.append(d)
    return apps


def save_apps(items: list[dict]):
    APPS_PATH.write_text(json.dumps(items, indent=2))


def _substitute_command(cmd: str, app_: dict) -> str:
    tok = app_.get("password") or ""
    return (cmd.replace("{port}", str(app_.get("port", "")))
               .replace("{token}", tok)
               .replace("{password}", tok)
               .replace("{username}", app_.get("username", "")))


@app.route("/api/apps", methods=["GET"])
@require_auth
def apps_list():
    apps = load_apps()
    for a in apps:
        alive = _tcp_alive("127.0.0.1", a.get("port", 0))
        if alive:
            a["status"] = "running"
        elif a.get("status") != "starting":
            a["status"] = "stopped"
    return jsonify(apps)


@app.route("/api/apps", methods=["POST"])
@require_auth
def apps_add():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    sub = (body.get("subdomain") or "").strip().lower()
    port = int(body.get("port") or 0)
    if not name or not sub or not port:
        return jsonify({"error": "name, subdomain, port required"}), 400
    if not re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?", sub):
        return jsonify({"error": "Invalid subdomain"}), 400
    if sub in RESERVED_SUBDOMAINS:
        return jsonify({"error": f"subdomain '{sub}' is reserved"}), 400
    if not (1 <= port <= 65535):
        return jsonify({"error": "Invalid port"}), 400

    hostname = f"{sub}.himansh.in"
    try:
        dns_record_id = _ensure_tunnel(hostname, port)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    apps = load_apps()
    new_app = {
        "id": secrets.token_hex(4),
        "name": name, "subdomain": sub, "port": port,
        "description": body.get("description", ""),
        "icon": body.get("icon", "Package"),
        "command": body.get("command", ""),
        "path": body.get("path", "/"),
        "status": "stopped", "custom": True, "authEnabled": False,
        "dnsRecordId": dns_record_id,
        "username": body.get("username", ""),
        "password": body.get("password", ""),
    }
    apps.append(new_app)
    save_apps(apps)
    return jsonify(new_app)


@app.route("/api/apps/<app_id>", methods=["DELETE"])
@require_auth
def apps_delete(app_id: str):
    apps = load_apps()
    target = next((a for a in apps if a["id"] == app_id), None)
    if not target:
        return jsonify({"error": "not found"}), 404
    if not target.get("custom"):
        return jsonify({"error": "cannot delete a built-in app"}), 403
    # Disable auth if enabled
    if target.get("authEnabled"):
        try:
            if target.get("workerRouteId"):
                worker_remove_route(target["workerRouteId"])
            oauth_remove_client(target["subdomain"])
            worker_sync_secrets()
        except Exception:
            pass
    _cleanup_tunnel(f"{target['subdomain']}.himansh.in", target.get("dnsRecordId"))
    save_apps([a for a in apps if a["id"] != app_id])
    return jsonify({"ok": True})


@app.route("/api/apps/<app_id>", methods=["PATCH"])
@require_auth
def apps_update(app_id: str):
    apps = load_apps()
    app_ = next((a for a in apps if a["id"] == app_id), None)
    if not app_:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "description", "icon", "command", "path", "username", "password"):
        if k in body:
            app_[k] = body[k]
    save_apps(apps)
    return jsonify(app_)


@app.route("/api/apps/<app_id>/start", methods=["POST"])
@require_auth
def apps_start(app_id: str):
    apps = load_apps()
    app_ = next((a for a in apps if a["id"] == app_id), None)
    if not app_:
        return jsonify({"error": "not found"}), 404
    # Generate token placeholder if used in command and no password set
    if app_.get("command") and "{token}" in app_["command"] and not app_.get("password"):
        app_["password"] = secrets.token_urlsafe(20)
    try:
        if app_.get("service"):
            subprocess.run(["sudo", "systemctl", "start", app_["service"]], check=False, timeout=20)
        elif app_.get("command"):
            cmd = _substitute_command(app_["command"], app_)
            subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            return jsonify({"error": "no start command or service"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Poll readiness ~10s
    for _ in range(20):
        if _tcp_alive("127.0.0.1", app_["port"]):
            app_["status"] = "running"
            save_apps(apps)
            return jsonify({"ok": True, "status": "running"})
        time.sleep(0.5)
    app_["status"] = "starting"
    save_apps(apps)
    return jsonify({"ok": True, "status": "starting"})


@app.route("/api/apps/<app_id>/stop", methods=["POST"])
@require_auth
def apps_stop(app_id: str):
    apps = load_apps()
    app_ = next((a for a in apps if a["id"] == app_id), None)
    if not app_:
        return jsonify({"error": "not found"}), 404
    if app_.get("service"):
        try:
            subprocess.run(["sudo", "systemctl", "stop", app_["service"]], check=False, timeout=20)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    app_["status"] = "stopped"
    save_apps(apps)
    return jsonify({"ok": True})


@app.route("/api/apps/<app_id>/auth", methods=["PATCH"])
@require_auth
def apps_toggle_auth(app_id: str):
    apps = load_apps()
    app_ = next((a for a in apps if a["id"] == app_id), None)
    if not app_:
        return jsonify({"error": "not found"}), 404
    enable = bool((request.get_json(silent=True) or {}).get("enabled"))
    hostname = f"{app_['subdomain']}.himansh.in"

    if enable and not app_.get("authEnabled"):
        redirect_uri = f"https://{hostname}/__pcdash/callback"
        oauth_add_client(app_["subdomain"], [redirect_uri])
        try:
            route_id = worker_add_route(hostname)
            worker_sync_secrets()
        except Exception as e:
            oauth_remove_client(app_["subdomain"])
            return jsonify({"error": str(e)}), 500
        app_["workerRouteId"] = route_id
        app_["authEnabled"] = True
    elif not enable and app_.get("authEnabled"):
        try:
            if app_.get("workerRouteId"):
                worker_remove_route(app_["workerRouteId"])
        except Exception:
            pass
        oauth_remove_client(app_["subdomain"])
        try:
            worker_sync_secrets()
        except Exception:
            pass
        app_.pop("workerRouteId", None)
        app_["authEnabled"] = False
    save_apps(apps)
    return jsonify(app_)


# ---- Files ----
def _safe(p: str) -> Path:
    root = FILE_ROOT
    target = (root / p.lstrip("/")).resolve() if p else root
    if root not in target.parents and target != root:
        abort(403)
    return target


@app.route("/api/files")
@require_auth
def files_list():
    rel = request.args.get("path", "")
    p = _safe(rel)
    if not p.exists():
        return jsonify({"error": "not found"}), 404
    if p.is_file():
        return send_file(p, as_attachment=request.args.get("download") == "1")
    items = []
    for entry in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        try:
            st = entry.stat()
            items.append({
                "name": entry.name,
                "type": "directory" if entry.is_dir() else "file",
                "size": st.st_size if entry.is_file() else 0,
                "mtime": st.st_mtime,
            })
        except Exception:
            continue
    return jsonify({"path": str(p.relative_to(FILE_ROOT)), "items": items})


@app.route("/api/files/upload", methods=["POST"])
@require_auth
def files_upload():
    rel = request.form.get("path", "")
    dest = _safe(rel)
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in request.files.getlist("file"):
        out = dest / f.filename
        f.save(out)
        saved.append(f.filename)
    return jsonify({"ok": True, "files": saved})


@app.route("/api/files/delete", methods=["POST"])
@require_auth
def files_delete():
    paths = (request.get_json(silent=True) or {}).get("paths", [])
    for rel in paths:
        p = _safe(rel)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
    return jsonify({"ok": True})


@app.route("/api/files/mkdir", methods=["POST"])
@require_auth
def files_mkdir():
    rel = (request.get_json(silent=True) or {}).get("path", "")
    _safe(rel).mkdir(parents=True, exist_ok=True)
    return jsonify({"ok": True})


# ---- Terminal: proxy /terminal to ttyd on localhost:7681 ----
# ---- Terminal: server-side PTY sessions with TTL, log files, multi-tab, cross-device reattach ----
SESSIONS_DIR = DATA_DIR / "terminal-sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
SESSIONS_META = SESSIONS_DIR / "sessions.json"

SHELLS = {
    "bash": ["/bin/bash"],
    "sh": ["/bin/sh"],
    "login": ["login", "-f", os.environ.get("USER", "pi")],
}

DEFAULT_TTL_MS = 30 * 60 * 1000
SESSIONS: dict[str, "TermSession"] = {}
SESSIONS_LOCK = threading.Lock()


def _read_sessions_meta() -> dict:
    if not SESSIONS_META.exists():
        return {}
    try:
        return json.loads(SESSIONS_META.read_text())
    except Exception:
        return {}


def _write_sessions_meta(data: dict):
    SESSIONS_META.write_text(json.dumps(data, indent=2))


def _update_meta(sid: str, patch: dict):
    m = _read_sessions_meta()
    if sid in m:
        m[sid].update(patch)
        _write_sessions_meta(m)


class TermSession:
    def __init__(self, shell: str, sid: str | None = None, title: str | None = None):
        self.id = sid or secrets.token_hex(6)
        self.shell = shell if shell in SHELLS else "bash"
        self.title = title or self.shell
        self.created_at = time.time()
        self.ttl_ms: int | str = DEFAULT_TTL_MS
        self.clients: set = set()
        self.ttl_timer: threading.Timer | None = None
        self.cols, self.rows = 80, 24
        self.log_path = SESSIONS_DIR / f"{self.id}.log"
        self._lock = threading.Lock()

        pid, fd = pty.fork()
        if pid == 0:
            # Child: set env, exec shell
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env["HOME"] = os.path.expanduser("~")
            try:
                os.chdir(env["HOME"])
            except Exception:
                pass
            cmd = SHELLS[self.shell]
            os.execvpe(cmd[0], cmd, env)
        self.pid = pid
        self.fd = fd
        print(f"[term {self.id}] spawned {self.shell} pid={pid}", flush=True)

        # Truncate log on new session
        self.log_path.write_bytes(b"")

        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self):
        while True:
            try:
                r, _, _ = select.select([self.fd], [], [], 0.5)
            except Exception:
                break
            if self.fd in r:
                try:
                    data = os.read(self.fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    with open(self.log_path, "ab") as f:
                        f.write(data)
                except Exception:
                    pass
                text = data.decode("utf-8", errors="replace")
                dead = []
                for ws in list(self.clients):
                    try:
                        ws.send(json.dumps({"type": "output", "data": text}))
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    self.clients.discard(ws)

        # PTY closed — notify and destroy
        try:
            code = os.waitpid(self.pid, os.WNOHANG)[1]
        except ChildProcessError:
            code = -1
        for ws in list(self.clients):
            try:
                ws.send(json.dumps({"type": "exit", "code": code}))
            except Exception:
                pass
        self.destroy()

    def resize(self, cols: int, rows: int):
        self.cols, self.rows = cols, rows
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except Exception:
            pass

    def write(self, data: str):
        try:
            os.write(self.fd, data.encode("utf-8"))
        except Exception:
            pass

    def attach(self, ws):
        with self._lock:
            self.clients.add(ws)
            if self.ttl_timer:
                self.ttl_timer.cancel()
                self.ttl_timer = None
        # Replay backlog
        try:
            if self.log_path.exists():
                buf = self.log_path.read_bytes()
                if buf:
                    ws.send(json.dumps({"type": "output", "data": buf.decode("utf-8", errors="replace")}))
        except Exception:
            pass

    def detach(self, ws):
        with self._lock:
            self.clients.discard(ws)
            if not self.clients:
                self._start_ttl()

    def _start_ttl(self):
        if self.ttl_timer:
            self.ttl_timer.cancel()
            self.ttl_timer = None
        if self.ttl_ms == "unlimited":
            return
        ms = int(self.ttl_ms)
        if ms <= 0:
            return
        self.ttl_timer = threading.Timer(ms / 1000, self._ttl_expire)
        self.ttl_timer.daemon = True
        self.ttl_timer.start()

    def _ttl_expire(self):
        print(f"[term {self.id}] ttl expired", flush=True)
        self.destroy()

    def set_ttl(self, ttl_ms):
        with self._lock:
            self.ttl_ms = ttl_ms
            _update_meta(self.id, {"ttl_ms": ttl_ms})
            if not self.clients:
                self._start_ttl()

    def destroy(self):
        if self.ttl_timer:
            self.ttl_timer.cancel()
        try:
            os.close(self.fd)
        except Exception:
            pass
        try:
            os.kill(self.pid, signal.SIGTERM)
        except Exception:
            pass
        with SESSIONS_LOCK:
            SESSIONS.pop(self.id, None)
        try:
            if self.log_path.exists():
                self.log_path.unlink()
        except Exception:
            pass
        m = _read_sessions_meta()
        m.pop(self.id, None)
        _write_sessions_meta(m)


@app.route("/api/terminal/sessions", methods=["GET"])
@require_auth
def term_list():
    with SESSIONS_LOCK:
        return jsonify([{
            "id": s.id, "shell": s.shell, "title": s.title,
            "createdAt": datetime.fromtimestamp(s.created_at, tz=timezone.utc).isoformat(),
            "connected": len(s.clients), "ttlMs": s.ttl_ms,
        } for s in SESSIONS.values()])


@app.route("/api/terminal/sessions", methods=["POST"])
@require_auth
def term_create():
    body = request.get_json(silent=True) or {}
    shell = body.get("shell", "bash")
    title = body.get("title") or shell
    s = TermSession(shell=shell, title=title)
    with SESSIONS_LOCK:
        SESSIONS[s.id] = s
    m = _read_sessions_meta()
    m[s.id] = {"id": s.id, "shell": s.shell, "title": s.title, "ttl_ms": s.ttl_ms}
    _write_sessions_meta(m)
    return jsonify({"id": s.id, "shell": s.shell, "title": s.title, "ttlMs": s.ttl_ms})


@app.route("/api/terminal/sessions/<sid>", methods=["PATCH"])
@require_auth
def term_update(sid):
    body = request.get_json(silent=True) or {}
    with SESSIONS_LOCK:
        s = SESSIONS.get(sid)
    if not s:
        return jsonify({"error": "not found"}), 404
    if "ttlMs" in body:
        s.set_ttl(body["ttlMs"])
    if "title" in body:
        s.title = str(body["title"])
        _update_meta(sid, {"title": s.title})
    return jsonify({"ok": True})


@app.route("/api/terminal/sessions/<sid>", methods=["DELETE"])
@require_auth
def term_delete(sid):
    with SESSIONS_LOCK:
        s = SESSIONS.get(sid)
    if s:
        s.destroy()
    return jsonify({"ok": True})


@sock.route("/ws/terminal")
def ws_terminal(ws):
    # Auth: cookie-based (Flask request context)
    tok = request.cookies.get(COOKIE_NAME, "")
    if not tok or not verify_token(tok):
        ws.close(1008, "unauthorized")
        return

    sid = request.args.get("sessionId")
    shell = request.args.get("shell", "bash")

    with SESSIONS_LOCK:
        s = SESSIONS.get(sid) if sid else None
    if not s:
        s = TermSession(shell=shell, sid=sid, title=shell)
        with SESSIONS_LOCK:
            SESSIONS[s.id] = s
        m = _read_sessions_meta()
        m[s.id] = {"id": s.id, "shell": s.shell, "title": s.title, "ttl_ms": s.ttl_ms}
        _write_sessions_meta(m)

    s.attach(ws)
    try:
        ws.send(json.dumps({"type": "session", "id": s.id, "ttlMs": s.ttl_ms}))
    except Exception:
        pass

    try:
        while True:
            msg = ws.receive(timeout=None)
            if msg is None:
                break
            try:
                m = json.loads(msg)
            except Exception:
                continue
            t = m.get("type")
            if t == "input":
                s.write(m.get("data", ""))
            elif t == "resize":
                s.resize(int(m.get("cols", 80)), int(m.get("rows", 24)))
            elif t == "ttl":
                s.set_ttl(m.get("ttlMs", DEFAULT_TTL_MS))
    except Exception:
        pass
    finally:
        s.detach(ws)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
