"""Расчёт стоимости вызова модели по токенам — конфиг из seed.json (config/pricing.yaml в реальном ТЗ)."""
from __future__ import annotations

from . import seed


def cost_usd(model: str, tokens_in: int, tokens_out: int) -> float:
    cfg = seed.pricing_config().get(model)
    if not cfg:
        return 0.0
    return round(
        (tokens_in / 1_000_000) * cfg["inputPerM"] + (tokens_out / 1_000_000) * cfg["outputPerM"],
        6,
    )
