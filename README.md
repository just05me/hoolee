# hoolee

Сайт студии **hoolee.uz** (автоматизация бизнеса и ИИ-оркестраторы, Ташкент) и его сервисы.

```
site/            генератор статического сайта (Python, без зависимостей): content.py — тексты uz/ru/en,
                 build.py — шаблоны и SEO, static/ — CSS, JS, favicon, og.png, config.json — настройки
services/api/    приём заявок → Telegram-бот
services/demo-ark/  демо Ark Core (без внешних API, вымышленные данные)
docker/, docker-compose.yml, deploy/   упаковка и конфиг Caddy (на сервер пока НЕ выкладывалось)
anton/           отдельный приватный репозиторий (в git не входит), для страницы-кейса
dev.py           локальный запуск всего сразу
docs/SETUP.md    бот, Search Console, Яндекс, Метрика, выкладка на сервер
```

## Локально

```bash
python3 dev.py
```

Сайт http://127.0.0.1:4321 (пересобирается при правках в `site/`), демо на :8787, API заявок на :8788.
Пока `BOT_TOKEN` не задан, заявки не уходят в Telegram, а печатаются в консоль (dry-run).

## Что где менять

| Что | Где |
|---|---|
| Тексты, переводы, FAQ, услуги | `site/content.py` |
| Email для формы, username бота, Метрика, коды подтверждения | `site/config.json` |
| Вёрстка страниц, SEO-разметка | `site/build.py` |
| Стили и анимации | `site/static/site.css`, `site/static/site.js` |

Кнопка «Отправить по email» появляется в форме, когда в `config.json` указан `email`.
Фото основателя: блок `.photo` в `page_about` (`site/build.py`) заменить на `<img>`.
