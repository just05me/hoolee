"""Общий код заявок для api (сайт) и bot (Telegram): конфиг, Telegram API,
SQLite-хранилище и рассылка всем админам. Только stdlib.

Переменные окружения:
  BOT_TOKEN   токен бота из @BotFather
  ADMIN_IDS   Telegram user_id админов через запятую; им приходят все заявки
              (для совместимости используется и CHAT_ID)
  DB_PATH     путь к SQLite (в Docker — /data/leads.db на общем томе)
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
from html import escape
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def load_env() -> None:
    p = REPO / ".env"
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def parse_ids(*values: str) -> list[int]:
    ids: list[int] = []
    for v in values:
        for part in re.split(r"[,\s;]+", v or ""):
            if re.fullmatch(r"-?\d+", part) and int(part) not in ids:
                ids.append(int(part))
    return ids


load_env()
BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
ADMIN_IDS = parse_ids(os.environ.get("ADMIN_IDS", ""), os.environ.get("CHAT_ID", ""))
DB_PATH = os.environ.get("DB_PATH", str(REPO / "data" / "leads.db"))

TG_ERRORS = (urllib.error.URLError, TimeoutError, ValueError, OSError)


def configured() -> bool:
    return bool(BOT_TOKEN and ADMIN_IDS)


def tg(method: str, payload: dict, timeout: int = 10) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# ───────────────────────────── хранилище ─────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created REAL NOT NULL,
  source TEXT NOT NULL,            -- site | bot
  lang TEXT, page TEXT,
  name TEXT, company TEXT, contact TEXT, message TEXT,
  tg_user_id INTEGER, tg_username TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | taken
  taken_by TEXT, taken_at REAL
);
CREATE TABLE IF NOT EXISTS notifications (
  lead_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY, lang TEXT, step TEXT, data TEXT, updated REAL
);
"""


def db() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(SCHEMA)
    return c


FIELDS = ("lang", "page", "name", "company", "contact", "message", "tg_user_id", "tg_username")


def add_lead(source: str, **f) -> int:
    cols = [k for k in FIELDS if k in f]
    with db() as c:
        cur = c.execute(
            f"INSERT INTO leads (created, source{''.join(',' + k for k in cols)}) VALUES (?,?{',?' * len(cols)})",
            [time.time(), source, *[f[k] for k in cols]],
        )
        return cur.lastrowid


def get_lead(lead_id: int) -> dict | None:
    with db() as c:
        row = c.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    return dict(row) if row else None


def recent_leads(n: int = 10) -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM leads ORDER BY id DESC LIMIT ?", (n,))]


def count_recent(tg_user_id: int, seconds: int = 3600) -> int:
    with db() as c:
        return c.execute(
            "SELECT COUNT(*) FROM leads WHERE tg_user_id=? AND created>?", (tg_user_id, time.time() - seconds)
        ).fetchone()[0]


def take_lead(lead_id: int, who: str) -> bool:
    """Атомарно: только первый админ забирает заявку."""
    with db() as c:
        cur = c.execute(
            "UPDATE leads SET status='taken', taken_by=?, taken_at=? WHERE id=? AND status='new'",
            (who, time.time(), lead_id),
        )
        return cur.rowcount == 1


def notifications(lead_id: int) -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute("SELECT chat_id, message_id FROM notifications WHERE lead_id=?", (lead_id,))]


# ───────────────────────────── рассылка админам ─────────────────────────────
SOURCE_LABEL = {"site": "сайт", "bot": "бот"}


def format_lead(l: dict) -> str:
    e = lambda k: escape(str(l.get(k) or "—"))  # noqa: E731
    lines = [
        f"<b>🟠 Заявка #{l['id']} · {SOURCE_LABEL.get(l['source'], l['source'])}</b>\n",
        f"<b>Имя:</b> {e('name')}",
        f"<b>Компания:</b> {e('company')}",
        f"<b>Контакт:</b> {e('contact')}",
    ]
    if l.get("tg_user_id"):
        who = f"@{escape(l['tg_username'])}" if l.get("tg_username") else "без username"
        lines.append(f'<b>Telegram:</b> {who} · <a href="tg://user?id={int(l["tg_user_id"])}">{int(l["tg_user_id"])}</a>')
    lines.append(f"<b>Язык / страница:</b> {e('lang')} / {e('page')}")
    lines.append(f"\n{e('message')}")
    if l.get("status") == "taken":
        lines.append(f"\n🟢 <b>В работе:</b> {escape(l.get('taken_by') or '')}")
    return "\n".join(lines)


def keyboard(l: dict) -> dict:
    if l.get("status") == "new":
        return {"inline_keyboard": [[{"text": "✅ Взять в работу", "callback_data": f"take:{l['id']}"}]]}
    return {"inline_keyboard": []}


def notify_admins(lead_id: int) -> int:
    """Отправляет заявку каждому админу. Возвращает число успешных доставок."""
    lead = get_lead(lead_id)
    if not lead:
        return 0
    delivered = 0
    for admin in ADMIN_IDS:
        try:
            res = tg("sendMessage", {
                "chat_id": admin, "text": format_lead(lead), "parse_mode": "HTML",
                "disable_web_page_preview": True, "reply_markup": keyboard(lead),
            })
        except TG_ERRORS:
            continue
        if res.get("ok"):
            delivered += 1
            mid = (res.get("result") or {}).get("message_id")
            if mid:
                with db() as c:
                    c.execute("INSERT INTO notifications VALUES (?,?,?)", (lead_id, admin, mid))
    return delivered


def refresh_notifications(lead_id: int) -> None:
    """Обновляет сообщения у всех админов (после «Взять в работу»)."""
    lead = get_lead(lead_id)
    if not lead:
        return
    for n in notifications(lead_id):
        try:
            tg("editMessageText", {
                "chat_id": n["chat_id"], "message_id": n["message_id"], "text": format_lead(lead),
                "parse_mode": "HTML", "disable_web_page_preview": True, "reply_markup": keyboard(lead),
            })
        except TG_ERRORS:
            pass
