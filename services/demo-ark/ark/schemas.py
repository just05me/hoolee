"""Ручная валидация JSON-контрактов ролей — см. ТЗ разработчика, раздел 4.

Никакой внешней зависимости (zod и т.п.) — схемы маленькие и фиксированные,
а fail-closed поведение (см. validate()) важнее удобства библиотеки.
"""
from __future__ import annotations

from typing import Any, Callable


def _is_list_of_str(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def validate_triage(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    if obj.get("level") not in ("simple", "medium", "complex", "out_of_scope"):
        return "level должен быть simple|medium|complex|out_of_scope"
    if not _is_list_of_str(obj.get("departments")):
        return "departments должен быть списком строк"
    conf = obj.get("confidence")
    if not isinstance(conf, (int, float)) or not (0 <= conf <= 1):
        return "confidence должен быть числом 0..1"
    if not isinstance(obj.get("reason"), str):
        return "reason должен быть строкой"
    nc = obj.get("needs_clarification")
    if nc is not None and not _is_list_of_str(nc):
        return "needs_clarification должен быть списком строк или отсутствовать"
    return None


def validate_direct_answer(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    if not isinstance(obj.get("answer"), str):
        return "answer должен быть строкой"
    sources = obj.get("sources")
    if not isinstance(sources, list):
        return "sources должен быть списком"
    for s in sources:
        if not isinstance(s, dict) or s.get("kind") not in ("kb", "db") or not isinstance(s.get("id"), str):
            return "каждый source — {kind: kb|db, id: string}"
    if not isinstance(obj.get("found"), bool):
        return "found должен быть boolean"
    return None


def validate_plan(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    blocks = obj.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return "blocks должен быть непустым списком"
    for b in blocks:
        if not isinstance(b, dict):
            return "каждый блок — объект"
        for key in ("id", "department", "title", "description"):
            if not isinstance(b.get(key), str) or not b.get(key):
                return f"блок.{key} должен быть непустой строкой"
        if not _is_list_of_str(b.get("deps", [])):
            return "блок.deps должен быть списком строк"
        if not _is_list_of_str(b.get("acceptance_criteria")) or not b.get("acceptance_criteria"):
            return "блок.acceptance_criteria должен быть непустым списком строк"
    return None


def validate_work_result(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    if obj.get("status") not in ("done", "blocked"):
        return "status должен быть done|blocked"
    if not isinstance(obj.get("artifact"), str) or not obj.get("artifact"):
        return "artifact должен быть непустой строкой"
    if not _is_list_of_str(obj.get("used_sources", [])):
        return "used_sources должен быть списком строк"
    blockers = obj.get("blockers")
    if blockers is not None and not _is_list_of_str(blockers):
        return "blockers должен быть списком строк или отсутствовать"
    return None


def validate_review(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    if obj.get("verdict") not in ("pass", "rework"):
        return "verdict должен быть pass|rework"
    issues = obj.get("issues")
    if not isinstance(issues, list):
        return "issues должен быть списком"
    for i in issues:
        if not isinstance(i, dict) or not isinstance(i.get("text"), str):
            return "каждый issue — {severity, text}"
    return None


def validate_acceptance(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "ответ не объект"
    if obj.get("verdict") not in ("accept", "rework", "escalate"):
        return "verdict должен быть accept|rework|escalate"
    if not _is_list_of_str(obj.get("unmet_requirements", [])):
        return "unmet_requirements должен быть списком строк"
    if not isinstance(obj.get("comment"), str):
        return "comment должен быть строкой"
    return None


Validator = Callable[[Any], "str | None"]
