#!/usr/bin/env python3
"""Helper for executing commands on the Pi Zero W over SSH.

Usage:
  python pi-ssh.py setup         # one-time: push pubkey to Pi (uses password)
  python pi-ssh.py run "cmd"     # run a single command, print stdout+stderr
  python pi-ssh.py shell file.sh # run a local shell script remotely
"""
import sys
import os
from pathlib import Path
import paramiko

HOST = os.environ.get("PI_HOST", "192.168.1.34")
USER = os.environ.get("PI_USER", "pi")
PASSWORD = os.environ.get("PI_PASSWORD", "Iath@me")
KEY_PATH = str(Path.home() / ".ssh" / "id_ed25519")


def _connect(use_key: bool = True) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    if use_key and Path(KEY_PATH).exists():
        try:
            client.connect(HOST, username=USER, key_filename=KEY_PATH, timeout=10, look_for_keys=False, allow_agent=False)
            return client
        except paramiko.ssh_exception.AuthenticationException:
            pass  # fall back to password
    client.connect(HOST, username=USER, password=PASSWORD, timeout=10, look_for_keys=False, allow_agent=False)
    return client


def run_cmd(cmd: str, use_key: bool = True, sudo: bool = False, timeout: int = 600) -> tuple[int, str, str]:
    client = _connect(use_key=use_key)
    try:
        if sudo:
            # Wrap so any sudo -S within reads from stdin where we pipe the password
            cmd = f"echo {PASSWORD!r} | sudo -S -p '' bash -c {cmd!r}"
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err
    finally:
        client.close()


def setup_key():
    """One-time: push local pubkey to Pi's authorized_keys."""
    pub_path = Path(KEY_PATH + ".pub")
    if not pub_path.exists():
        print(f"Public key missing: {pub_path}")
        sys.exit(1)
    pub = pub_path.read_text().strip()
    # Use password to authenticate, then append pubkey if not present
    cmd = (
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
        f"grep -qF '{pub}' ~/.ssh/authorized_keys 2>/dev/null || "
        f"echo '{pub}' >> ~/.ssh/authorized_keys && "
        "chmod 600 ~/.ssh/authorized_keys && echo OK"
    )
    code, out, err = run_cmd(cmd, use_key=False)
    print(out or err)
    if code == 0 and "OK" in out:
        print("Key setup complete. Subsequent runs use key auth.")
    else:
        print(f"Setup failed (exit {code})")
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    action = sys.argv[1]
    if action == "setup":
        setup_key()
    elif action == "run" and len(sys.argv) >= 3:
        cmd = sys.argv[2]
        code, out, err = run_cmd(cmd)
        sys.stdout.buffer.write((out or "").encode("utf-8", errors="replace"))
        sys.stderr.buffer.write((err or "").encode("utf-8", errors="replace"))
        sys.exit(code)
    elif action == "sudo" and len(sys.argv) >= 3:
        cmd = sys.argv[2]
        code, out, err = run_cmd(cmd, sudo=True)
        sys.stdout.buffer.write((out or "").encode("utf-8", errors="replace"))
        sys.stderr.buffer.write((err or "").encode("utf-8", errors="replace"))
        sys.exit(code)
    elif action == "shell" and len(sys.argv) >= 3:
        script = Path(sys.argv[2]).read_text()
        code, out, err = run_cmd("bash -s", use_key=True)
        # exec_command doesn't accept stdin this way; fall back to sending inline
        # Simpler: encode as base64 and decode on Pi
        import base64
        b64 = base64.b64encode(script.encode()).decode()
        cmd = f"bash -c 'echo {b64} | base64 -d | bash'"
        code, out, err = run_cmd(cmd)
        if out:
            sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        sys.exit(code)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
