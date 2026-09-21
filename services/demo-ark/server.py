#!/usr/bin/env python3
"""«Арк ядро» — локальный демо-сервер. Только stdlib, ничего ставить не нужно.

Запуск:  python3 server.py
Откроется на http://127.0.0.1:8787

Версия для сайта hoolee: без внешних API и ключей. Цикл агентов идёт
по заранее прописанным сценариям (ark/canned.py), данные вымышленные.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"

sys.path.insert(0, str(ROOT))
from ark import canned, store  # noqa: E402


PORT = int(os.environ.get("PORT", "8787"))
HOST = os.environ.get("HOST", "127.0.0.1")
AI_LIVE = False
DEEPSEEK_MODEL = ""

INTERACTION_PATH_RE = re.compile(r"^/api/interactions/([A-Za-z0-9_\-]+)/resolve$")


def sse_frame(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ArkYadroDemo/1.0"

    # ---------- helpers ----------
    def _send_json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _serve_static(self, url_path: str) -> None:
        rel = url_path.lstrip("/") or "index.html"
        candidate = (PUBLIC_DIR / rel).resolve()
        if PUBLIC_DIR not in candidate.parents and candidate != PUBLIC_DIR:
            self.send_error(403, "Forbidden")
            return
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.exists() or not candidate.is_file():
            candidate = PUBLIC_DIR / "index.html"  # SPA fallback
        content_type, _ = mimetypes.guess_type(str(candidate))
        if candidate.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif candidate.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        elif candidate.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif candidate.suffix in (".html", ""):
            content_type = "text/html; charset=utf-8"
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _stream_task(self, qs: dict) -> None:
        text = (qs.get("text", [""])[0] or "").strip()
        task_id = qs.get("taskId", [""])[0] or f"t_{uuid.uuid4().hex[:10]}"
        if not text:
            self._send_json({"error": "text обязателен"}, 400)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            gen = canned.run(task_id, text)

            for name, data in gen:
                self.wfile.write(sse_frame(name, data))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001 — fail-closed: сообщаем клиенту, не роняем сервер
            try:
                self.wfile.write(sse_frame("error", {"taskId": task_id, "message": f"Внутренняя ошибка: {e}"}))
                self.wfile.write(sse_frame("done", {}))
                self.wfile.flush()
            except Exception:
                pass

    # ---------- routing ----------
    def do_GET(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        qs = parse_qs(parts.query)

        if parts.path == "/api/health":
            self._send_json({"ok": True, "aiLive": AI_LIVE, "model": None})
            return
        if parts.path == "/api/task/stream":
            self._stream_task(qs)
            return
        self._serve_static(parts.path)

    def do_POST(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        m = INTERACTION_PATH_RE.match(parts.path)
        if m:
            body = self._read_json_body()
            ok = store.resolve(m.group(1), body)
            self._send_json({"ok": ok})
            return
        self._send_json({"error": "not found"}, 404)

    def log_message(self, fmt: str, *args) -> None:  # тише стандартного лога
        sys.stderr.write("· %s\n" % (fmt % args))


def main() -> None:
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = "демо-сценарии, без внешних API"
    print("─" * 56)
    print("  Арк ядро — демо")
    print(f"  http://{HOST}:{PORT}")
    print(f"  Режим ИИ: {mode}")
    print("─" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено.")


if __name__ == "__main__":
    main()
