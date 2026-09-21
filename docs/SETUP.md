# Настройка hoolee

## 1. Telegram-бот для заявок

1. В Telegram откройте **@BotFather** → `/newbot` → придумайте имя и username (должен заканчиваться на `bot`).
2. BotFather пришлёт **токен**. Положите его в `.env` (`BOT_TOKEN=...`). Токен никому не показывайте и не коммитьте.
3. Откройте своего бота, нажмите **Start** и отправьте любое сообщение.
4. Узнайте свой chat id:
   ```bash
   cd services/api && BOT_TOKEN=... python3 server.py --chat-id
   ```
   Вывод `CHAT_ID=123456789` тоже положите в `.env`.
5. Впишите username бота (без `@`) в `site/config.json` → `bot_username`, чтобы он появился в контактах и футере.
6. Проверка: `python3 dev.py`, отправьте заявку с сайта. Она придёт в чат с ботом.

## 2. Email в форме

Когда заведёте почту, впишите адрес в `site/config.json` → `"email"`. В форме появится кнопка «Отправить по email»:
она открывает почтовую программу посетителя с готовым письмом на этот адрес (`mailto:`).
Отправку с самого сервера (SMTP/Resend) можно добавить позже, это потребует SPF/DKIM для hoolee.uz в DNS.

## 3. Google Search Console

1. https://search.google.com/search-console → **Добавить ресурс** → тип **Домен** → `hoolee.uz`.
2. Google покажет TXT-запись. Добавьте её в DNS домена (кабинет aHOST: https://clients.ahost.uz) и нажмите «Подтвердить».
3. Раздел **Файлы Sitemap** → добавьте `https://hoolee.uz/sitemap.xml`.
4. Раздел **Проверка URL** → вставьте `https://hoolee.uz/uz/` → **Запросить индексирование** (то же для `/ru/` и `/en/`).

Если выберете тип «Префикс URL», можно подтвердить через мета-тег: впишите его значение в `site/config.json` → `verification.google`.

## 4. Яндекс.Вебмастер

1. https://webmaster.yandex.ru → **Добавить сайт** → `https://hoolee.uz`.
2. Подтверждение через мета-тег: значение `content` впишите в `site/config.json` → `verification.yandex`, пересоберите и выложите сайт, затем нажмите «Проверить».
3. **Индексирование → Файлы Sitemap** → `https://hoolee.uz/sitemap.xml`.
4. **Региональность**: Ташкент / Узбекистан.

## 5. Яндекс.Метрика

1. https://metrica.yandex.com → **Добавить счётчик** → адрес `hoolee.uz`.
2. Скопируйте **номер счётчика** (цифры) в `site/config.json` → `analytics.yandex_metrika_id`.
3. Пересоберите и выложите сайт. Счётчик подключается сам на всех страницах.
4. В Метрике включите Вебвизор, если он нужен (по умолчанию у нас включены карта кликов и отслеживание ссылок).

## 6. GEO (видимость в ИИ-поиске)

Уже сделано в сборке: `robots.txt` разрешает ИИ-краулеры (GPTBot, ClaudeBot, PerplexityBot и др.), есть `llms.txt`,
JSON-LD (Organization, FAQPage, Service, BreadcrumbList), `hreflang` для uz/ru/en и sitemap.
Дальше поможет: регулярно добавлять страницы с ответами на вопросы клиентов (блог/FAQ) и упоминания hoolee на внешних площадках.

## 7. Выкладка на сервер (когда будете готовы; сейчас ничего не выкладывалось)

Сервер: EC2 `mindmap-prod`, там же ffinance.uz. Порядок:

1. **DNS в aHOST** для `hoolee.uz`: `A @ → 3.70.84.61`, `A www → 3.70.84.61`, `A demo → 3.70.84.61`.
2. Скопировать проект на сервер (например `rsync` в `/opt/hoolee`, исключая `.git`, `anton`, `dist`, `.env`).
3. На сервере: `cp .env.example .env`, заполнить, затем `sudo docker compose up --build -d`.
4. Добавить блоки из `deploy/Caddyfile.snippet` в `/etc/caddy/Caddyfile` (блок ffinance.uz не трогать) и `sudo systemctl reload caddy`. Caddy сам выпустит HTTPS.
5. Проверка: `https://hoolee.uz/ru/`, `https://demo.hoolee.uz`, отправка тестовой заявки.

Замечание: на сервере 2 ГБ памяти, а ffinance.uz уже занимает часть. Наш стек лёгкий (nginx + два маленьких Python-процесса), но следите за `free -m` после запуска.
