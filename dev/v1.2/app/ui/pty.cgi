#!/bin/python3

import errno
import json
import os
import pwd
import socket
import subprocess
import sys
import traceback


TMP_DIR = "/tmp/dsm-terminal-pty"
LOG_FILE = os.path.join(TMP_DIR, "pty-cgi.log")
SOCKET_PATH = os.path.join(TMP_DIR, "pty.sock")
AUTH_TOKEN_PATH = os.path.join(TMP_DIR, "auth.token")
AUTH_CGI = "/usr/syno/synoman/webman/modules/authenticate.cgi"


def ensure_log_dir() -> None:
    try:
        os.makedirs(TMP_DIR, mode=0o777, exist_ok=True)
    except OSError:
        pass
    try:
        os.chmod(TMP_DIR, 0o777)
    except OSError:
        pass


def log_error(message: str) -> None:
    ensure_log_dir()
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(message)
            if not message.endswith("\n"):
                handle.write("\n")
    except OSError:
        pass


def send_json(payload) -> None:
    sys.stdout.write("Content-Type: application/json\r\n")
    sys.stdout.write("Cache-Control: no-store\r\n\r\n")
    sys.stdout.write(json.dumps(payload))
    sys.stdout.write("\n")
    sys.stdout.flush()


def read_body() -> bytes:
    length_raw = os.environ.get("CONTENT_LENGTH", "0")
    try:
        length = int(length_raw)
    except ValueError:
        length = 0
    return sys.stdin.buffer.read(length) if length > 0 else b""


def resolve_dsm_user() -> str:
    remote_user = os.environ.get("REMOTE_USER", "").strip()
    if remote_user:
        return remote_user

    result = subprocess.run(
        [AUTH_CGI],
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    return next((line.strip() for line in result.stdout.splitlines() if line.strip()), "")


def authenticated_request(body: bytes) -> bytes:
    request = json.loads(body.decode("utf-8"))
    if request.get("action") != "create" or not request.get("as_current_user"):
        return body

    user = resolve_dsm_user()
    if not user or any(ord(char) < 32 for char in user):
        raise ValueError("DSM authentication failed")
    try:
        pwd.getpwnam(user)
    except KeyError as exc:
        raise ValueError("DSM user does not exist") from exc

    request.pop("as_current_user", None)
    request["user"] = user
    try:
        with open(AUTH_TOKEN_PATH, "r", encoding="ascii") as handle:
            request["_auth_token"] = handle.read().strip()
    except OSError as exc:
        raise ValueError("PTY authentication token is unavailable") from exc
    return json.dumps(request).encode("utf-8")


def main() -> int:
    body = read_body()
    try:
        body = authenticated_request(body)
    except (json.JSONDecodeError, ValueError) as exc:
        send_json({"ok": False, "error": str(exc)})
        return 0

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(SOCKET_PATH)
    except OSError as exc:
        if exc.errno in (errno.ENOENT, errno.ECONNREFUSED):
            send_json({"ok": False, "error": "PTY service is not running"})
            return 0
        if exc.errno == errno.EACCES:
            send_json({"ok": False, "error": "PTY service socket permission denied"})
            return 0
        raise

    try:
        sock.sendall(body)
        sock.shutdown(socket.SHUT_WR)
        response = bytearray()
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            response.extend(chunk)
    finally:
        sock.close()

    if not response:
        send_json({"ok": False, "error": "PTY service did not return a response"})
        return 0

    sys.stdout.write("Content-Type: application/json\r\n")
    sys.stdout.write("Cache-Control: no-store\r\n\r\n")
    sys.stdout.flush()
    sys.stdout.buffer.write(response)
    if not response.endswith(b"\n"):
        sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    ensure_log_dir()
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        log_error(traceback.format_exc())
        send_json({"ok": False, "error": "PTY CGI bridge failed"})
        raise SystemExit(0)
