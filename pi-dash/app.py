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
import os, json, time, secrets, subprocess, re, shutil, mimetypes
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
    return jsonify(load_ports())


@app.route("/api/ports", methods=["POST"])
@require_auth
def ports_add():
    body = request.get_json(silent=True) or {}
    sub = (body.get("subdomain") or "").strip().lower()
    port = int(body.get("port") or 0)
    if not re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?", sub):
        return jsonify({"error": "Invalid subdomain"}), 400
    if not (1 <= port <= 65535):
        return jsonify({"error": "Invalid port"}), 400

    hostname = f"{sub}.himansh.in"
    # Collision check: reject if subdomain exists but points to a DIFFERENT tunnel
    existing = cf_list_records(hostname)
    for rec in existing:
        if rec.get("type") == "CNAME" and TUNNEL_ID not in (rec.get("content") or ""):
            return jsonify({"error": f"{hostname} is already owned by another service"}), 409

    # Create CNAME + add ingress
    try:
        if not existing:
            cf_create_cname(sub)
        ingress = cf_get_tunnel_ingress()
        ingress = [r for r in ingress if r.get("hostname") != hostname]
        ingress.insert(-1, {"hostname": hostname, "service": f"http://localhost:{port}"})
        cf_put_tunnel_ingress(ingress)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    items = load_ports()
    items.append({
        "id": secrets.token_hex(4), "subdomain": sub, "port": port, "hostname": hostname,
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
    # Remove CNAME
    try:
        for rec in cf_list_records(target["hostname"]):
            cf_delete_record(rec["id"])
    except Exception:
        pass
    # Remove ingress rule
    try:
        ingress = [r for r in cf_get_tunnel_ingress() if r.get("hostname") != target["hostname"]]
        cf_put_tunnel_ingress(ingress)
    except Exception:
        pass
    items = [i for i in items if i["id"] != fwd_id]
    save_ports(items)
    return jsonify({"ok": True})


# ---- Apps ----
DEFAULT_APPS = [
    {
        "id": "pihole", "name": "Pi-hole", "description": "Network-wide ad blocker + DNS",
        "subdomain": "dns", "port": 80, "status": "running", "managed": False,
        "path": "/admin/",
    },
]

def load_apps() -> list[dict]:
    if not APPS_PATH.exists():
        APPS_PATH.write_text(json.dumps(DEFAULT_APPS, indent=2))
        return list(DEFAULT_APPS)
    return json.loads(APPS_PATH.read_text())


def save_apps(items: list[dict]):
    APPS_PATH.write_text(json.dumps(items, indent=2))


@app.route("/api/apps", methods=["GET"])
@require_auth
def apps_list():
    return jsonify(load_apps())


@app.route("/api/apps", methods=["POST"])
@require_auth
def apps_add():
    body = request.get_json(silent=True) or {}
    required = ("name", "subdomain", "port")
    if not all(body.get(k) for k in required):
        return jsonify({"error": f"missing: {required}"}), 400
    sub = str(body["subdomain"]).lower().strip()
    if not re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?", sub):
        return jsonify({"error": "Invalid subdomain"}), 400

    hostname = f"{sub}.himansh.in"
    existing = cf_list_records(hostname)
    for rec in existing:
        if rec.get("type") == "CNAME" and TUNNEL_ID not in (rec.get("content") or ""):
            return jsonify({"error": f"{hostname} is already owned by another service"}), 409

    try:
        if not existing:
            cf_create_cname(sub)
        ingress = cf_get_tunnel_ingress()
        ingress = [r for r in ingress if r.get("hostname") != hostname]
        ingress.insert(-1, {"hostname": hostname, "service": f"http://localhost:{int(body['port'])}"})
        cf_put_tunnel_ingress(ingress)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    apps = load_apps()
    apps.append({
        "id": secrets.token_hex(4),
        "name": body["name"],
        "description": body.get("description", ""),
        "subdomain": sub,
        "port": int(body["port"]),
        "command": body.get("command", ""),
        "status": "stopped",
        "managed": True,
        "path": body.get("path", "/"),
    })
    save_apps(apps)
    return jsonify(apps[-1])


@app.route("/api/apps/<app_id>", methods=["DELETE"])
@require_auth
def apps_delete(app_id: str):
    apps = load_apps()
    target = next((a for a in apps if a["id"] == app_id), None)
    if not target:
        return jsonify({"error": "not found"}), 404
    if not target.get("managed"):
        return jsonify({"error": "cannot delete a built-in app"}), 403
    # Clean up DNS + ingress
    try:
        for rec in cf_list_records(f"{target['subdomain']}.himansh.in"):
            cf_delete_record(rec["id"])
        ingress = [r for r in cf_get_tunnel_ingress() if r.get("hostname") != f"{target['subdomain']}.himansh.in"]
        cf_put_tunnel_ingress(ingress)
    except Exception:
        pass
    save_apps([a for a in apps if a["id"] != app_id])
    return jsonify({"ok": True})


@app.route("/api/apps/<app_id>/start", methods=["POST"])
@require_auth
def apps_start(app_id: str):
    apps = load_apps()
    app_ = next((a for a in apps if a["id"] == app_id), None)
    if not app_ or not app_.get("command"):
        return jsonify({"error": "no start command"}), 400
    try:
        subprocess.Popen(app_["command"], shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        app_["status"] = "running"
        save_apps(apps)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
# (handled by cloudflared routing pi.himansh.in/terminal/ to localhost:7681 directly,
#  OR by this catch-all proxy. Simpler to let cloudflared do it, so no Flask code here.)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
