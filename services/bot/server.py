#!/usr/bin/env python3
"""ARCOAI bot — приём заявок в Telegram (@ARCOAI_bot). Только stdlib, long polling.

Клиент проходит диалог (язык → имя → контакт → задача → подтверждение), заявка
сохраняется в SQLite и уходит всем админам из ADMIN_IDS. Админ нажимает
«Взять в работу», остальные админы видят, кто взял заявку.

Команды: /start, /cancel, /whoami (покажет ваш user_id), /help; админам ещё /leads.
Переменные окружения: BOT_TOKEN, ADMIN_IDS, DB_PATH (см. common/leads.py).
"""
from __future__ import annotations

import json
import sys
import time
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT.parent)]
from common import leads  # noqa: E402

MAX_LEADS_PER_HOUR = 3
LANGS = {"uz": "🇺🇿 O‘zbekcha", "ru": "🇷🇺 Русский", "en": "🇬🇧 English"}

TEXTS = {
    "ru": {
        "ask_name": "Как вас зовут?",
        "ask_contact": "Как с вами связаться? Отправьте номер кнопкой ниже или напишите телефон / @username.",
        "share": "📱 Поделиться номером",
        "ask_task": "Опишите задачу: что нужно автоматизировать?",
        "summary": "Проверьте заявку:\n\n<b>Имя:</b> {name}\n<b>Контакт:</b> {contact}\n\n{message}",
        "send": "✅ Отправить", "cancel": "✖ Отмена",
        "thanks": "Спасибо! Заявка #{id} принята. Мы свяжемся с вами по указанному контакту.",
        "cancelled": "Отменено. Чтобы начать заново, нажмите /start.",
        "too_many": "Слишком много заявок за последний час. Попробуйте позже.",
        "bad": "Не удалось разобрать ответ. Напишите текстом (не длиннее {n} символов).",
        "help": "Я принимаю заявки студии ARCOAI. /start — оставить заявку, /cancel — отменить, /whoami — ваш Telegram ID.",
    },
    "uz": {
        "ask_name": "Ismingiz nima?",
        "ask_contact": "Siz bilan qanday bog‘lanamiz? Raqamni pastdagi tugma bilan yuboring yoki telefon / @username yozing.",
        "share": "📱 Raqamni yuborish",
        "ask_task": "Vazifani tasvirlab bering: nimani avtomatlashtirish kerak?",
        "summary": "Arizani tekshiring:\n\n<b>Ism:</b> {name}\n<b>Kontakt:</b> {contact}\n\n{message}",
        "send": "✅ Yuborish", "cancel": "✖ Bekor qilish",
        "thanks": "Rahmat! #{id} ariza qabul qilindi. Ko‘rsatilgan kontakt orqali bog‘lanamiz.",
        "cancelled": "Bekor qilindi. Qayta boshlash uchun /start bosing.",
        "too_many": "So‘nggi soatda arizalar juda ko‘p. Keyinroq urinib ko‘ring.",
        "bad": "Javobni tushunib bo‘lmadi. Matn yozing ({n} belgigacha).",
        "help": "Men ARCOAI studiyasining arizalarini qabul qilaman. /start — ariza qoldirish, /cancel — bekor qilish, /whoami — Telegram ID.",
    },
    "en": {
        "ask_name": "What is your name?",
        "ask_contact": "How can we reach you? Share your number with the button below or type a phone / @username.",
        "share": "📱 Share my number",
        "ask_task": "Describe the task: what needs to be automated?",
        "summary": "Please review your request:\n\n<b>Name:</b> {name}\n<b>Contact:</b> {contact}\n\n{message}",
        "send": "✅ Send", "cancel": "✖ Cancel",
        "thanks": "Thank you! Request #{id} received. We will contact you using the details you gave.",
        "cancelled": "Cancelled. Press /start to begin again.",
        "too_many": "Too many requests in the last hour. Please try again later.",
        "bad": "Could not read that. Please send text (up to {n} characters).",
        "help": "I take project requests for ARCOAI studio. /start — send a request, /cancel — cancel, /whoami — your Telegram ID.",
    },
}
LIMIT = {"name": 80, "contact": 120, "message": 2000}
MIN_MESSAGE = 5


# ───────────────────────────── сессии диалога ─────────────────────────────
def get_session(uid: int) -> dict | None:
    with leads.db() as c:
        r = c.execute("SELECT * FROM sessions WHERE user_id=?", (uid,)).fetchone()
    return None if not r else {"lang": r["lang"], "step": r["step"], "data": json.loads(r["data"] or "{}")}


def save_session(uid: int, lang: str | None, step: str, data: dict) -> None:
    with leads.db() as c:
        c.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET "
            "lang=excluded.lang, step=excluded.step, data=excluded.data, updated=excluded.updated",
            (uid, lang, step, json.dumps(data, ensure_ascii=False), time.time()),
        )


def drop_session(uid: int) -> None:
    with leads.db() as c:
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))


# ───────────────────────────── отправка ─────────────────────────────
def send(chat_id: int, text: str, markup: dict | None = None) -> None:
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if markup is not None:
        payload["reply_markup"] = markup
    try:
        leads.tg("sendMessage", payload)
    except leads.TG_ERRORS as e:
        sys.stderr.write(f"· sendMessage failed: {type(e).__name__}\n")


def answer_cb(cb_id: str, text: str = "", alert: bool = False) -> None:
    try:
        leads.tg("answerCallbackQuery", {"callback_query_id": cb_id, "text": text, "show_alert": alert})
    except leads.TG_ERRORS:
        pass


def lang_keyboard() -> dict:
    return {"inline_keyboard": [[{"text": v, "callback_data": f"lang:{k}"} for k, v in LANGS.items()]]}


def display_name(user: dict) -> str:
    return f"@{user['username']}" if user.get("username") else (user.get("first_name") or str(user["id"]))


# ───────────────────────────── диалог ─────────────────────────────
def start_dialog(uid: int, chat_id: int) -> None:
    save_session(uid, None, "lang", {})
    send(chat_id, "🌐 Tilni tanlang · Выберите язык · Choose language", lang_keyboard())


def ask(chat_id: int, lang: str, step: str) -> None:
    t = TEXTS[lang]
    if step == "name":
        send(chat_id, t["ask_name"], {"remove_keyboard": True})
    elif step == "contact":
        send(chat_id, t["ask_contact"], {"keyboard": [[{"text": t["share"], "request_contact": True}]], "resize_keyboard": True, "one_time_keyboard": True})
    elif step == "message":
        send(chat_id, t["ask_task"], {"remove_keyboard": True})


def confirm(chat_id: int, lang: str, data: dict) -> None:
    t = TEXTS[lang]
    send(chat_id, t["summary"].format(**{k: escape(data[k]) for k in ("name", "contact", "message")}),
         {"inline_keyboard": [[{"text": t["send"], "callback_data": "send"}, {"text": t["cancel"], "callback_data": "cancel"}]]})


def handle_message(m: dict) -> None:
    chat = m.get("chat") or {}
    user = m.get("from") or {}
    if chat.get("type") != "private" or not user.get("id"):
        return
    uid, cid = user["id"], chat["id"]
    text = (m.get("text") or "").strip()
    cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    sess = get_session(uid)
    lang = (sess or {}).get("lang") or "ru"

    if cmd == "/start":
        return start_dialog(uid, cid)
    if cmd == "/whoami":
        return send(cid, f"Your Telegram ID / Ваш ID: <code>{uid}</code>")
    if cmd == "/help":
        return send(cid, TEXTS[lang]["help"])
    if cmd == "/cancel":
        drop_session(uid)
        return send(cid, TEXTS[lang]["cancelled"], {"remove_keyboard": True})
    if cmd == "/leads":
        if uid not in leads.ADMIN_IDS:
            return
        rows = leads.recent_leads(10)
        body = "\n".join(
            f"#{r['id']} {'🟢' if r['status'] == 'taken' else '🟠'} {leads.SOURCE_LABEL.get(r['source'], r['source'])} · "
            f"{escape(r['name'] or '—')} · {escape(r['contact'] or '—')}" + (f" → {escape(r['taken_by'])}" if r["taken_by"] else "")
            for r in rows
        ) or "—"
        return send(cid, f"<b>Последние заявки</b>\n{body}")
    if cmd:
        return send(cid, TEXTS[lang]["help"])

    if not sess or sess["step"] in ("lang", "confirm"):
        if not sess:
            return start_dialog(uid, cid)
        return  # ждём нажатия кнопки

    step, data, t = sess["step"], sess["data"], TEXTS[lang]
    value = ((m.get("contact") or {}).get("phone_number") or "").strip() if step == "contact" and m.get("contact") else text
    if not value or len(value) > LIMIT[step] or (step == "message" and len(value) < MIN_MESSAGE):
        return send(cid, t["bad"].format(n=LIMIT[step]))
    data[step] = value
    nxt = {"name": "contact", "contact": "message", "message": "confirm"}[step]
    save_session(uid, lang, nxt, data)
    if nxt == "confirm":
        return confirm(cid, lang, data)
    ask(cid, lang, nxt)


def handle_callback(cb: dict) -> None:
    user = cb.get("from") or {}
    uid = user.get("id")
    msg = cb.get("message") or {}
    cid = (msg.get("chat") or {}).get("id")
    data = cb.get("data") or ""
    if not uid or not cid:
        return

    if data.startswith("take:"):
        if uid not in leads.ADMIN_IDS:
            return answer_cb(cb["id"])  # чужие нажатия игнорируем
        try:
            lead_id = int(data[5:])
        except ValueError:
            return answer_cb(cb["id"])
        if leads.take_lead(lead_id, display_name(user)):
            answer_cb(cb["id"], "✅")
            leads.refresh_notifications(lead_id)
        else:
            lead = leads.get_lead(lead_id) or {}
            answer_cb(cb["id"], f"Уже в работе: {lead.get('taken_by', '—')}", True)
        return

    sess = get_session(uid)
    if data.startswith("lang:") and sess and sess["step"] == "lang":
        lang = data[5:]
        if lang not in TEXTS:
            return answer_cb(cb["id"])
        save_session(uid, lang, "name", {})
        answer_cb(cb["id"])
        return ask(cid, lang, "name")

    if data in ("send", "cancel") and sess and sess["step"] == "confirm":
        lang, t = sess["lang"], TEXTS[sess["lang"]]
        answer_cb(cb["id"])
        drop_session(uid)
        if data == "cancel":
            return send(cid, t["cancelled"], {"remove_keyboard": True})
        if leads.count_recent(uid) >= MAX_LEADS_PER_HOUR:
            return send(cid, t["too_many"])
        d = sess["data"]
        lead_id = leads.add_lead("bot", lang=lang, page="telegram", name=d["name"], contact=d["contact"], message=d["message"],
                                 tg_user_id=uid, tg_username=user.get("username") or "")
        if not leads.notify_admins(lead_id):
            sys.stderr.write(f"· lead #{lead_id} saved, no admin received it\n")
        return send(cid, t["thanks"].format(id=lead_id))
    answer_cb(cb["id"])


def handle_update(u: dict) -> None:
    if u.get("message"):
        handle_message(u["message"])
    elif u.get("callback_query"):
        handle_callback(u["callback_query"])


# ───────────────────────────── polling ─────────────────────────────
def run() -> None:
    if not leads.configured():
        sys.stderr.write("BOT_TOKEN/ADMIN_IDS не заданы — бот не запущен, ждём конфигурацию.\n")
        while True:
            time.sleep(3600)
    me = leads.tg("getMe", {}).get("result", {})
    leads.tg("deleteWebhook", {})
    print(f"ARCOAI bot · @{me.get('username')} · админов: {len(leads.ADMIN_IDS)}", flush=True)
    offset, backoff = None, 1
    while True:
        try:
            res = leads.tg("getUpdates", {"offset": offset, "timeout": 25, "allowed_updates": ["message", "callback_query"]}, timeout=40)
            backoff = 1
        except leads.TG_ERRORS as e:
            sys.stderr.write(f"· getUpdates failed: {type(e).__name__}\n")
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)
            continue
        for u in res.get("result", []):
            offset = u["update_id"] + 1
            try:
                handle_update(u)
            except Exception as e:  # noqa: BLE001 — один плохой апдейт не должен ронять бота
                sys.stderr.write(f"· update {u.get('update_id')} failed: {type(e).__name__}: {e}\n")


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
