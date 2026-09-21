"""Загрузка общего seed.json — единственный источник демо-данных.

И бэкенд (для контекста промптов), и фронтенд (public/data/seed.json,
отдаётся статикой) читают один и тот же файл, чтобы цифры нигде не расходились.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_SEED_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "seed.json"

_cache: dict[str, Any] | None = None


def load() -> dict[str, Any]:
    global _cache
    if _cache is None:
        with open(_SEED_PATH, "r", encoding="utf-8") as f:
            _cache = json.load(f)
    return _cache


def departments() -> list[dict[str, Any]]:
    return load()["departments"]


def department_ids() -> list[str]:
    return [d["id"] for d in departments()]


def department_by_id(dept_id: str) -> dict[str, Any] | None:
    for d in departments():
        if d["id"] == dept_id:
            return d
    return None


def clients_deals_snapshot() -> str:
    """Компактная сводка по клиентам/сделкам — контекст для роли «Базовый ИИ»."""
    data = load()
    clients = {c["id"]: c["name"] for c in data["clients"]}
    stage_labels = {s["id"]: s["label"] for s in data["funnelStages"]}
    lines = []
    for d in data["deals"]:
        client = clients.get(d["clientId"], d["clientId"])
        stage = stage_labels.get(d["stage"], d["stage"])
        lines.append(f"- {d['title']} · клиент {client} · стадия «{stage}» · {d['amountUsd']}$")
    return "\n".join(lines)


def kb_snapshot(department_id: str | None = None) -> str:
    data = load()
    lines = []
    for n in data["kbNodes"]:
        if n["type"] not in ("lesson", "doc", "entity"):
            continue
        if department_id and n.get("departmentId") not in (department_id, None):
            continue
        lines.append(f"- [{n['type']}] {n['title']}")
    return "\n".join(lines)


def pricing_config() -> dict[str, Any]:
    return load()["pricingConfig"]
