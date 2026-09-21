"""Хранилище пауз пайплайна, ожидающих человека (approvals, clarification).

SSE-поток идёт в отдельном треде на каждый запрос (ThreadingHTTPServer),
поэтому можно просто заблокироваться на threading.Event — другие запросы
(POST /api/interactions/<id>/resolve) обслуживаются параллельно.
"""
from __future__ import annotations

import uuid
import threading
from dataclasses import dataclass, field
from typing import Any

_lock = threading.Lock()
_pending: dict[str, "Interaction"] = {}

WAIT_TIMEOUT_SEC = 600  # 10 минут — если посетитель забыл вкладку, пайплайн не должен висеть вечно


@dataclass
class Interaction:
    id: str
    task_id: str
    kind: str  # "approval" | "clarification"
    payload: dict[str, Any]
    default_resolution: dict[str, Any]
    event: threading.Event = field(default_factory=threading.Event)
    resolution: dict[str, Any] | None = None
    timed_out: bool = False


def create(task_id: str, kind: str, payload: dict[str, Any], default_resolution: dict[str, Any]) -> Interaction:
    with _lock:
        iid = f"int_{uuid.uuid4().hex}"
        interaction = Interaction(iid, task_id, kind, payload, default_resolution)
        _pending[iid] = interaction
        return interaction


def resolve(interaction_id: str, resolution: dict[str, Any]) -> bool:
    with _lock:
        interaction = _pending.get(interaction_id)
        if not interaction or interaction.event.is_set():
            return False
        interaction.resolution = resolution
        interaction.event.set()
        return True


def wait(interaction: Interaction) -> dict[str, Any]:
    signalled = interaction.event.wait(WAIT_TIMEOUT_SEC)
    with _lock:
        _pending.pop(interaction.id, None)
    if not signalled:
        interaction.timed_out = True
        return interaction.default_resolution
    return interaction.resolution or interaction.default_resolution
