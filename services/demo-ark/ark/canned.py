"""Демо-режим без ключа DeepSeek: тот же словарь событий, что и pipeline.run(),
но по заранее прописанным сценариям (с задержками для «живости»), плюс честный
подсчёт по данным seed.json там, где это уместно (простой вопрос по сделкам).

Выбор сценария — по ключевым словам во входном тексте; если ничего не подошло —
сценарий по умолчанию (КП для отдела продаж).
"""
from __future__ import annotations

import time
from typing import Any, Iterator

from . import pricing, seed, store

Event = tuple[str, dict[str, Any]]
MODEL = "deepseek-chat"


def _cost(ti: int, to: int) -> float:
    return pricing.cost_usd(MODEL, ti, to)


def _role_event(name: str, task_id: str, delay: float, ti: int, to: int, latency: int, **extra) -> Event:
    payload = {"taskId": task_id, "tokensIn": ti, "tokensOut": to, "costUsd": _cost(ti, to), "latencyMs": latency, "valid": True}
    payload.update(extra)
    time.sleep(delay)
    return name, payload


def _pick_scenario(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ("таможен", "растамож", "вэд", "из китая")):
        return "out_of_scope"
    if any(k in t for k in ("недостач", "жалу", "заказ №", "заказ n", "заказ#")):
        return "support"
    if any(k in t for k in ("сколько", "покажи")) and any(k in t for k in ("сделк", "переговор", "актив")):
        return "simple"
    if any(k in t for k in ("акци", "instagram", "рассылк")):
        return "multi"
    return "sales_kp"


def run(task_id: str, task_text: str) -> Iterator[Event]:
    yield "task_created", {"taskId": task_id, "title": task_text[:120]}
    time.sleep(0.3)

    scenario = _pick_scenario(task_text)
    yield from _SCENARIOS[scenario](task_id, task_text)
    yield "done", {}


def _simple(task_id: str, task_text: str) -> Iterator[Event]:
    yield _role_event(
        "task_triaged", task_id, 0.9, 340, 90, 1100,
        result={"level": "simple", "departments": ["analytics"], "confidence": 0.93,
                "reason": "Прямой вопрос по данным CRM — можно ответить без создания задачи."},
    )

    data = seed.load()
    stage_labels = {s["id"]: s["label"] for s in data["funnelStages"]}
    clients = {c["id"]: c["name"] for c in data["clients"]}
    deals = [d for d in data["deals"] if d["stage"] == "negotiation"]
    total = sum(d["amountUsd"] for d in deals)
    names = ", ".join(clients.get(d["clientId"], d["clientId"]) for d in deals)
    answer = (
        f"Сейчас {len(deals)} сделки на стадии «{stage_labels['negotiation']}» на общую сумму ${total}: {names}."
    )
    yield _role_event(
        "direct_answer", task_id, 1.1, 420, 130, 1400,
        result={"answer": answer, "sources": [{"kind": "db", "id": d["id"]} for d in deals], "found": True},
    )
    time.sleep(0.3)
    yield "task_done", {"taskId": task_id, "summary": answer, "artifact": answer, "durationMs": 3600, "direct": True}


def _sales_kp(task_id: str, task_text: str) -> Iterator[Event]:
    yield _role_event(
        "task_triaged", task_id, 1.0, 380, 110, 1300,
        result={"level": "medium", "departments": ["sales"], "confidence": 0.9,
                "reason": "Задача одного отдела — подготовка коммерческого предложения."},
    )
    block = {"id": "b1", "department": "sales", "title": "Коммерческое предложение",
              "description": "Подготовить КП с опт-скидкой по запросу клиента",
              "deps": [], "acceptance_criteria": ["Указана цена за упаковку и за партию", "Указано условие скидки", "Есть срок действия предложения"]}
    yield _role_event("plan_created", task_id, 1.2, 520, 210, 1700, plan={"blocks": [block]})
    yield "todo_created", {"taskId": task_id, "todo": {"id": f"{task_id}-b1", "board": "sales", "title": block["title"], "status": "todo", "blockId": "b1", "deps": []}}

    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "executor", "phase": "assigned", "blockId": "b1"}
    time.sleep(0.4)
    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "executor", "phase": "working", "blockId": "b1"}

    artifact = (
        "Коммерческое предложение: стиральный порошок, партия от 300 упаковок — 6 400 сум/уп., "
        "от 500 упаковок — 5 900 сум/уп. (скидка 8%). Отсрочка платежа 14 дней при повторной закупке. "
        "Предложение действует до конца месяца, доставка по Ташкенту — за счёт поставщика."
    )
    work = {"status": "done", "artifact": artifact, "used_sources": ["l-sales-2", "d-sales-price"]}
    yield _role_event("work_result", task_id, 1.8, 610, 240, 2100, blockId="b1", department="sales", result=work)

    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "reviewer", "phase": "reviewing", "blockId": "b1"}
    yield _role_event(
        "review_verdict", task_id, 1.0, 340, 90, 1200,
        blockId="b1", cycle=0, result={"verdict": "pass", "issues": []},
    )

    summary = "КП подготовлено и прошло проверку: цена за упаковку, скидка от 500 шт, срок действия и условия отсрочки указаны."
    yield _role_event(
        "acceptance_verdict", task_id, 1.1, 480, 160, 1500,
        result={"verdict": "accept", "unmet_requirements": [], "comment": summary},
    )

    yield from _approval_gate(task_id, summary, artifact)
    yield "task_done", {"taskId": task_id, "summary": summary, "artifact": artifact, "durationMs": 11200, "direct": False}


def _support(task_id: str, task_text: str) -> Iterator[Event]:
    yield _role_event(
        "task_triaged", task_id, 0.9, 360, 100, 1200,
        result={"level": "medium", "departments": ["support"], "confidence": 0.91,
                "reason": "Обращение клиента по конкретному заказу — задача отдела поддержки."},
    )
    block = {"id": "b1", "department": "support", "title": "Разбор недостачи по заказу",
              "description": "Сверить накладную, предложить решение клиенту",
              "deps": [], "acceptance_criteria": ["Указана причина по накладной", "Есть конкретное решение для клиента", "Тон вежливый, без обвинений"]}
    yield _role_event("plan_created", task_id, 1.1, 480, 190, 1500, plan={"blocks": [block]})
    yield "todo_created", {"taskId": task_id, "todo": {"id": f"{task_id}-b1", "board": "support", "title": block["title"], "status": "todo", "blockId": "b1", "deps": []}}

    yield "agent_step", {"taskId": task_id, "department": "support", "role": "executor", "phase": "assigned", "blockId": "b1"}
    time.sleep(0.4)
    yield "agent_step", {"taskId": task_id, "department": "support", "role": "executor", "phase": "working", "blockId": "b1"}

    artifact = (
        "По накладной №1042 отгружено 480 из 492 упаковок — недостача 12 упаковок подтверждена на складе. "
        "Решение: довезти недостающие 12 упаковок в течение 2 рабочих дней либо оформить возврат средств "
        "за них на выбор клиента. Извинения направлены, статус заказа обновлён."
    )
    work = {"status": "done", "artifact": artifact, "used_sources": ["l-support-1", "entity-order-1042"]}
    yield _role_event("work_result", task_id, 1.6, 590, 220, 1900, blockId="b1", department="support", result=work)

    yield "agent_step", {"taskId": task_id, "department": "support", "role": "reviewer", "phase": "reviewing", "blockId": "b1"}
    yield _role_event("review_verdict", task_id, 0.9, 310, 80, 1100, blockId="b1", cycle=0, result={"verdict": "pass", "issues": []})

    summary = "Причина недостачи установлена по накладной, клиенту предложено решение — задача закрыта."
    yield _role_event(
        "acceptance_verdict", task_id, 1.0, 430, 140, 1400,
        result={"verdict": "accept", "unmet_requirements": [], "comment": summary},
    )
    yield from _approval_gate(task_id, summary, artifact)
    yield "task_done", {"taskId": task_id, "summary": summary, "artifact": artifact, "durationMs": 9800, "direct": False}


def _out_of_scope(task_id: str, task_text: str) -> Iterator[Event]:
    yield _role_event(
        "task_triaged", task_id, 1.0, 350, 100, 1300,
        result={"level": "out_of_scope", "departments": [], "confidence": 0.82,
                "reason": "Задача не относится ни к одному из текущих отделов — нужен временный отдел."},
    )
    block = {"id": "b1", "department": "logistics", "title": "Заявка на таможенное оформление",
              "description": "Подготовить пакет документов по памятке для ввоза партии", "deps": [],
              "acceptance_criteria": ["Перечислены нужные документы", "Указаны примерные сроки", "Отмечены риски по партии"]}
    yield _role_event(
        "plan_created", task_id, 1.2, 540, 220, 1700,
        plan={"blocks": [block], "department_draft": {"id": "logistics", "name": "Логистика · врем."}},
    )
    time.sleep(0.3)
    yield "dept_created", {"taskId": task_id, "department": {
        "id": "logistics", "name": "Логистика · врем.", "color": "#FF9F0A", "kind": "temporary",
        "budgetUsdMonth": 60, "bridges": [], "skills": [],
    }}
    yield "todo_created", {"taskId": task_id, "todo": {"id": f"{task_id}-b1", "board": "logistics", "title": block["title"], "status": "todo", "blockId": "b1", "deps": []}}

    yield "agent_step", {"taskId": task_id, "department": "logistics", "role": "executor", "phase": "assigned", "blockId": "b1"}
    time.sleep(0.4)
    yield "agent_step", {"taskId": task_id, "department": "logistics", "role": "executor", "phase": "working", "blockId": "b1"}

    artifact = (
        "Пакет для таможни: инвойс, упаковочный лист, контракт с поставщиком, сертификат происхождения. "
        "Ориентировочный срок оформления — 5–7 рабочих дней. Риск: расхождение веса в декларации — "
        "сверить с грузоотправителем до подачи."
    )
    work = {"status": "done", "artifact": artifact, "used_sources": ["d-logistics-import"]}
    yield _role_event("work_result", task_id, 1.7, 600, 230, 2000, blockId="b1", department="logistics", result=work)

    yield "agent_step", {"taskId": task_id, "department": "logistics", "role": "reviewer", "phase": "reviewing", "blockId": "b1"}
    yield _role_event("review_verdict", task_id, 1.0, 320, 90, 1200, blockId="b1", cycle=0, result={"verdict": "pass", "issues": []})

    summary = "Временный отдел «Логистика» подготовил пакет документов и сроки — задача принята."
    yield _role_event(
        "acceptance_verdict", task_id, 1.1, 440, 150, 1400,
        result={"verdict": "accept", "unmet_requirements": [], "comment": summary},
    )
    yield from _approval_gate(task_id, summary, artifact)
    yield "task_done", {"taskId": task_id, "summary": summary, "artifact": artifact, "durationMs": 12400, "direct": False}


def _multi(task_id: str, task_text: str) -> Iterator[Event]:
    yield _role_event(
        "task_triaged", task_id, 1.0, 400, 130, 1400,
        result={"level": "complex", "departments": ["sales", "marketing", "analytics"], "confidence": 0.88,
                "reason": "Задача затрагивает несколько отделов — нужен согласованный план.",
                "needs_clarification": ["Акция только для розничных клиентов или тоже для дистрибьюторов?"]},
    )
    interaction = store.create(task_id, "clarification", {"questions": ["Акция только для розничных клиентов или тоже для дистрибьюторов?"]}, {"answers": ""})
    yield "clarification_requested", {"taskId": task_id, "id": interaction.id, "questions": ["Акция только для розничных клиентов или тоже для дистрибьюторов?"]}
    resolution = store.wait(interaction)
    yield "clarification_answered", {"taskId": task_id, "id": interaction.id, "answers": resolution.get("answers", "")}

    blocks = [
        {"id": "b1", "department": "analytics", "title": "Список остатков для акции", "description": "Выгрузить SKU с низкой оборачиваемостью", "deps": [], "acceptance_criteria": ["Список SKU с остатками", "Отсортировано по объёму остатка"]},
        {"id": "b2", "department": "sales", "title": "Обновление цен в прайсе", "description": "Проставить акционные цены по списку от аналитики", "deps": ["b1"], "acceptance_criteria": ["Цены проставлены по списку", "Указан срок действия акции"]},
        {"id": "b3", "department": "marketing", "title": "Рассылка и пост в Instagram", "description": "Текст рассылки клиентам и пост для соцсети", "deps": ["b1"], "acceptance_criteria": ["Есть текст рассылки", "Есть текст поста", "Упомянут срок акции"]},
    ]
    yield _role_event("plan_created", task_id, 1.3, 650, 280, 1900, plan={"blocks": blocks})
    for b in blocks:
        yield "todo_created", {"taskId": task_id, "todo": {"id": f"{task_id}-{b['id']}", "board": b["department"], "title": b["title"], "status": "todo", "blockId": b["id"], "deps": b["deps"]}}

    # волна 1 — b1
    yield "agent_step", {"taskId": task_id, "department": "analytics", "role": "executor", "phase": "assigned", "blockId": "b1"}
    time.sleep(0.4)
    yield "agent_step", {"taskId": task_id, "department": "analytics", "role": "executor", "phase": "working", "blockId": "b1"}
    artifact1 = "Остатки для акции: стиральный порошок 5кг (310 уп.), средство для посуды (480 уп.), губки хоз. (900 уп.) — суммарно на 4 200$."
    yield _role_event("work_result", task_id, 1.5, 520, 210, 1800, blockId="b1", department="analytics", result={"status": "done", "artifact": artifact1, "used_sources": ["d-analytics-report"]})
    yield "agent_step", {"taskId": task_id, "department": "analytics", "role": "reviewer", "phase": "reviewing", "blockId": "b1"}
    yield _role_event("review_verdict", task_id, 0.8, 280, 70, 1000, blockId="b1", cycle=0, result={"verdict": "pass", "issues": []})

    # волна 2 — b2, b3 параллельно (визуально почти одновременно)
    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "executor", "phase": "assigned", "blockId": "b2"}
    yield "agent_step", {"taskId": task_id, "department": "marketing", "role": "executor", "phase": "assigned", "blockId": "b3"}
    time.sleep(0.4)
    yield "bridge_request", {"taskId": task_id, "from": "sales", "to": "analytics", "question": "Список SKU для обновления цен"}
    yield "bridge_response", {"taskId": task_id, "from": "analytics", "to": "sales"}
    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "executor", "phase": "working", "blockId": "b2"}
    yield "agent_step", {"taskId": task_id, "department": "marketing", "role": "executor", "phase": "working", "blockId": "b3"}

    artifact2 = "Цены обновлены: порошок 5кг −15% (до 30.09), средство для посуды −10%, губки −20%. Акция отмечена в прайс-листе."
    yield _role_event("work_result", task_id, 1.6, 480, 200, 1700, blockId="b2", department="sales", result={"status": "done", "artifact": artifact2, "used_sources": ["d-sales-price"]})
    artifact3 = "Рассылка: «Скидки до 20% на хозтовары до конца месяца — успейте пополнить склад». Пост в Instagram: короткий, с ценами и сроком, призыв написать в Директ."
    yield _role_event("work_result", task_id, 1.7, 510, 220, 1900, blockId="b3", department="marketing", result={"status": "done", "artifact": artifact3, "used_sources": ["l-marketing-1", "d-marketing-tone"]})

    yield "agent_step", {"taskId": task_id, "department": "sales", "role": "reviewer", "phase": "reviewing", "blockId": "b2"}
    yield _role_event("review_verdict", task_id, 0.7, 260, 70, 900, blockId="b2", cycle=0, result={"verdict": "pass", "issues": []})
    yield "agent_step", {"taskId": task_id, "department": "marketing", "role": "reviewer", "phase": "reviewing", "blockId": "b3"}
    yield _role_event("review_verdict", task_id, 0.8, 270, 80, 1000, blockId="b3", cycle=0, result={"verdict": "pass", "issues": []})

    summary = "Акция согласована между Аналитикой, Продажами и Маркетингом: остатки, цены и публикации готовы."
    yield _role_event(
        "acceptance_verdict", task_id, 1.2, 560, 190, 1600,
        result={"verdict": "accept", "unmet_requirements": [], "comment": summary},
    )
    combined = f"{artifact1}\n\n{artifact2}\n\n{artifact3}"
    yield from _approval_gate(task_id, summary, combined)
    yield "task_done", {"taskId": task_id, "summary": summary, "artifact": combined, "durationMs": 18600, "direct": False}


def _approval_gate(task_id: str, summary: str, artifact: str) -> Iterator[Event]:
    interaction = store.create(task_id, "approval", {"type": "send_message", "summary": summary, "artifact": artifact}, {"decision": "approve"})
    yield "approval_requested", {"taskId": task_id, "id": interaction.id, "type": "send_message", "summary": summary, "artifact": artifact}
    resolution = store.wait(interaction)
    yield "approval_decided", {"taskId": task_id, "id": interaction.id, "decision": resolution.get("decision", "approve")}


_SCENARIOS = {
    "simple": _simple,
    "sales_kp": _sales_kp,
    "support": _support,
    "out_of_scope": _out_of_scope,
    "multi": _multi,
}
