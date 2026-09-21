#!/usr/bin/env python3
"""Локальный запуск всего hoolee одной командой:  python3 dev.py

  сайт        http://127.0.0.1:4321   (пересобирается при изменениях в site/)
  api заявок  http://127.0.0.1:8788   (проксируется на сайте как /api/*)
  демо Арк    http://127.0.0.1:8787

Ничего не деплоит: всё работает только на вашей машине.
"""
from __future__ import annotations

import http.client
import mimetypes
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SITE_PORT, API_PORT, DEMO_PORT = 4321, 8788, 8787


def build() -> None:
    env = dict(os.environ, DEMO_URL=f"http://127.0.0.1:{DEMO_PORT}")
    subprocess.run([sys.executable, str(ROOT / "site" / "build.py")], check=True, env=env)


def snapshot() -> float:
    return max((p.stat().st_mtime for p in (ROOT / "site").rglob("*") if p.is_file() and "__pycache__" not in p.parts), default=0)


def watch() -> None:
    last = snapshot()
    while True:
        time.sleep(1)
        cur = snapshot()
        if cur != last:
            last = cur
            try:
                build()
            except subprocess.CalledProcessError:
                print("✗ ошибка сборки")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        c = http.client.HTTPConnection("127.0.0.1", API_PORT, timeout=15)
        try:
            c.request(self.command, self.path, body=body, headers={"Content-Type": self.headers.get("Content-Type", "application/json"), "X-Forwarded-For": self.client_address[0]})
            r = c.getresponse()
            data = r.read()
            self.send_response(r.status)
            self.send_header("Content-Type", r.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError:
            self.send_error(502, "api недоступен")

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self.send_error(404)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/"):
            self._proxy()
            return
        rel = path.lstrip("/")
        f = (DIST / rel).resolve()
        if DIST not in f.parents and f != DIST:
            self.send_error(403)
            return
        if f.is_dir():
            f = f / "index.html"
        status = 200
        if not f.is_file():
            f, status = DIST / "404.html", 404
        data = f.read_bytes()
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        if f.suffix in (".html", ".xml", ".txt", ".js", ".css", ".svg", ".json"):
            ctype += "; charset=utf-8" if "charset" not in ctype else ""
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        pass


def main() -> None:
    mimetypes.add_type("text/javascript", ".js")
    build()
    procs = [
        subprocess.Popen([sys.executable, str(ROOT / "services" / "api" / "server.py")], env=dict(os.environ, PORT=str(API_PORT))),
        subprocess.Popen([sys.executable, str(ROOT / "services" / "demo-ark" / "server.py")], env=dict(os.environ, PORT=str(DEMO_PORT))),
    ]
    threading.Thread(target=watch, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", SITE_PORT), Handler)
    print(f"\n  hoolee · http://127.0.0.1:{SITE_PORT}   (Ctrl+C — остановить)\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
