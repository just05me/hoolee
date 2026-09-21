#!/usr/bin/env python3
"""ARCOAI API — приём заявок с сайта и отправка их в Telegram-бота. Только stdlib.

Переменные окружения (можно положить в .env рядом с файлом):
  BOT_TOKEN   токен бота из @BotFather
  ADMIN_IDS   Telegram user_id админов через запятую (узнать свой: написать боту /whoami)
              Заявки сохраняются в SQLite (DB_PATH) и уходят каждому админу.
  HOST, PORT  по умолчанию 127.0.0.1:8788
  ALLOWED_ORIGIN  необязательно: https://arcoai.info

Без BOT_TOKEN/ADMIN_IDS заявка не принимается и не печатается в лог,
клиенту возвращается ошибка 503; ложного подтверждения отправки нет.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import deque
from threading import Lock
import ipaddress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_env() -> None:
    p = ROOT / ".env"
    if not p.exists() and len(ROOT.parents) > 1:
        p = ROOT.parents[1] / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
sys.path[:0] = [str(ROOT), str(ROOT.parent)]  # общий код: services/common (локально) или /app/common (Docker)
from common import leads  # noqa: E402
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8788"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "").strip()

LIMITS = {"name": 80, "company": 120, "contact": 120, "message": 2000, "page": 40, "lang": 5}
RATE_WINDOW, RATE_MAX = 600, 5  # не более 5 заявок с одного IP за 10 минут
_hits: dict[str, deque] = {}
_rate_lock = Lock()


def rate_ok(ip: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        for key in list(_hits):
            if not _hits[key] or now - _hits[key][-1] > RATE_WINDOW:
                del _hits[key]
        if ip not in _hits and len(_hits) >= 10000:
            return False
        q = _hits.setdefault(ip, deque())
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= RATE_MAX:
            return False
        q.append(now)
        return True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ARCOAI-api"

    def _json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.end_headers()
        self.wfile.write(body)

    def _ip(self) -> str:
        # Trust only the address appended by our loopback/private reverse proxy.
        peer = self.client_address[0]
        if ipaddress.ip_address(peer).is_private:
            forwarded = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
            try:
                return str(ipaddress.ip_address(forwarded))
            except ValueError:
                pass
        return peer

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        if ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/api/health", "/health"):
            self._json({"ok": True, "telegram": leads.configured()})
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") not in ("/api/lead", "/lead"):
            self._json({"ok": False, "error": "not found"}, 404)
            return
        origin = self.headers.get("Origin")
        if ALLOWED_ORIGIN and origin and origin != ALLOWED_ORIGIN:
            self.close_connection = True
            self._json({"ok": False, "error": "origin not allowed"}, 403)
            return
        if self.headers.get_content_type() != "application/json":
            self.close_connection = True
            self._json({"ok": False, "error": "application/json required"}, 415)
            return
        self.connection.settimeout(15)
        try:
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n <= 0 or n > 10_000:
                raise ValueError("size")
            raw = json.loads(self.rfile.read(n).decode("utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("shape")
        except (ValueError, OSError):
            self.close_connection = True
            self._json({"ok": False, "error": "bad request"}, 400)
            return

        if raw.get("website"):  # honeypot: бот заполнил скрытое поле, молча «принимаем»
            self._json({"ok": True})
            return
        if not rate_ok(self._ip()):
            self._json({"ok": False, "error": "too many requests"}, 429)
            return

        if any(not isinstance(raw.get(k, ""), str) or len(raw.get(k, "")) > m for k, m in LIMITS.items()):
            self._json({"ok": False, "error": "invalid fields"}, 422)
            return
        d = {k: raw.get(k, "").strip() for k in LIMITS}
        if not (d["name"] and d["contact"] and d["message"]):
            self._json({"ok": False, "error": "required fields"}, 422)
            return

        if not leads.configured():
            self._json({"ok": False, "error": "delivery not configured"}, 503)
            return
        try:
            lead_id = leads.add_lead("site", **d)
            delivered = leads.notify_admins(lead_id)
        except (OSError, leads.sqlite3.Error):
            sys.stderr.write("· storage failed\n")
            self._json({"ok": False, "error": "storage"}, 500)
            return
        if not delivered:
            sys.stderr.write("· Telegram delivery failed (lead #%d saved)\n" % lead_id)
        self._json({"ok": bool(delivered)}, 200 if delivered else 502)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("· %s\n" % (fmt % args))


def main() -> None:
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = f"Telegram, админов: {len(leads.ADMIN_IDS)}" if leads.configured() else "delivery unavailable (BOT_TOKEN/ADMIN_IDS не заданы)"
    print(f"ARCOAI API · http://{HOST}:{PORT} · режим: {mode}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
