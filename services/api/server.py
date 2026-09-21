#!/usr/bin/env python3
"""hoolee API — приём заявок с сайта и отправка их в Telegram-бота. Только stdlib.

Переменные окружения (можно положить в .env рядом с файлом):
  BOT_TOKEN   токен бота из @BotFather
  CHAT_ID     id вашего чата с ботом (узнать: python3 server.py --chat-id)
  HOST, PORT  по умолчанию 127.0.0.1:8788
  ALLOWED_ORIGIN  необязательно: https://arcoai.info

Без BOT_TOKEN/CHAT_ID заявка не принимается и не печатается в лог,
клиенту возвращается ошибка 503; ложного подтверждения отправки нет.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from threading import Lock
import ipaddress
from html import escape
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
BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
CHAT_ID = os.environ.get("CHAT_ID", "").strip()
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


def tg(method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def format_lead(d: dict) -> str:
    e = lambda k: escape(d.get(k, "") or "—")  # noqa: E731
    return (
        "<b>🟠 Новая заявка · arcoai.info</b>\n\n"
        f"<b>Имя:</b> {e('name')}\n"
        f"<b>Компания:</b> {e('company')}\n"
        f"<b>Контакт:</b> {e('contact')}\n"
        f"<b>Язык / страница:</b> {e('lang')} / {e('page')}\n\n"
        f"{e('message')}"
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hoolee-api"

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
            self._json({"ok": True, "telegram": bool(BOT_TOKEN and CHAT_ID)})
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

        text = format_lead(d)
        if not (BOT_TOKEN and CHAT_ID):
            self._json({"ok": False, "error": "delivery not configured"}, 503)
            return
        try:
            res = tg("sendMessage", {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
            self._json({"ok": bool(res.get("ok"))}, 200 if res.get("ok") else 502)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            sys.stderr.write("· Telegram delivery failed\n")
            self._json({"ok": False, "error": "upstream"}, 502)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("· %s\n" % (fmt % args))


def print_chat_id() -> None:
    if not BOT_TOKEN:
        sys.exit("Сначала задайте BOT_TOKEN (в .env или в окружении), затем напишите боту любое сообщение.")
    res = tg("getUpdates", {})
    seen = {}
    for u in res.get("result", []):
        m = u.get("message") or u.get("channel_post") or {}
        c = m.get("chat")
        if c:
            seen[c["id"]] = c.get("username") or c.get("title") or c.get("first_name")
    if not seen:
        sys.exit("Обновлений нет. Откройте бота в Telegram, нажмите Start, отправьте любое сообщение и повторите.")
    for cid, name in seen.items():
        print(f"CHAT_ID={cid}   ({name})")


def main() -> None:
    if "--chat-id" in sys.argv:
        print_chat_id()
        return
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = "Telegram" if (BOT_TOKEN and CHAT_ID) else "delivery unavailable (BOT_TOKEN/CHAT_ID не заданы)"
    print(f"hoolee API · http://{HOST}:{PORT} · режим: {mode}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
