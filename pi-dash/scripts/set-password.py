#!/usr/bin/env python3
"""Initialize pi-dash password. Run once on the Pi."""
import json
import sys
import getpass
import bcrypt
from pathlib import Path

CFG = Path(__file__).resolve().parent.parent / "data" / "config.json"
CFG.parent.mkdir(exist_ok=True)

pw = getpass.getpass("Set dashboard password: ").strip()
if len(pw) < 4:
    print("Password must be at least 4 characters.")
    sys.exit(1)

h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()
cfg = {}
if CFG.exists():
    cfg = json.loads(CFG.read_text())
cfg["password_hash"] = h
CFG.write_text(json.dumps(cfg, indent=2))
print(f"Password saved to {CFG}")
