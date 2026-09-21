# ARCOAI production setup

## Contacts and lead handling

Public Telegram bot: https://t.me/ARCOAI_bot
Public email: none for now (removed from the site; set "email" in site/config.json to bring it back).

Every lead, from the website form and from the bot dialog, is stored in SQLite (`/data/leads.db`, shared Docker volume `data`) and sent to every admin. Admins are the Telegram user ids in `ADMIN_IDS` (comma-separated); each admin must press Start in the bot once. Any admin can press "Взять в работу": the message updates for all admins and shows who took it. Admins can list recent leads with `/leads`; anyone can learn their own id with `/whoami`.

Put `BOT_TOKEN` and `ADMIN_IDS` into `/opt/hoolee/.env`, permissions 600. The API answers success only when at least one admin actually received the lead; the lead stays in the database either way.

After changing `.env`: `sudo docker compose up -d --force-recreate api bot` from `/opt/hoolee`.
Never log, commit or expose `.env`. The Docker context explicitly excludes it.

## Hosting

Existing EC2: 3.70.84.61. Dedicated Compose project `ARCOAI` in `/opt/ARCOAI`.
Host-only ports: site 4321, lead API 8788, Ark demo 8787. The bot uses long polling and opens no port.
Caddy imports `/etc/caddy/sites-enabled/hoolee.caddy`; existing domains keep their own configuration.

DNS (aHOST zone editor, nameservers rdns1/2/3.ahost.uz). Required records, TTL 14400:

| Name | Type | Value |
| --- | --- | --- |
| `@` | A | `3.70.84.61` |
| `www` | CNAME | `arcoai.info` |
| `demo` | A | `3.70.84.61` |

Remove the registrar defaults that point to the old hosting IP `185.196.212.52`: the old `@` A record, `mail` and `ftp` CNAMEs, the `@` MX record, and update the SPF TXT. Caddy obtains HTTPS once the names resolve publicly.

Deploy source with rsync excluding `.git`, `.env*`, `anton`, `dist`, and `__pycache__`. Copy `.env` separately through SSH only when updating secrets. Run `sudo docker compose up --build -d`. Validate Caddy before reloading. Keep the prior source release for rollback.

Checks:

```sh
curl -I https://arcoai.info/ru/
curl https://arcoai.info/api/health
curl https://demo.arcoai.info/api/health
curl -I https://arcoai.info/not-found
```

`www` redirects to apex. `/` redirects to `/uz/`; each language has a stable URL. Unknown pages return 404. The demo is noindex.

## Search

The site ships canonical URLs, reciprocal hreflang for uz/ru/en/x-default, a sitemap with 21 pages, descriptive metadata, Organization/Service/Breadcrumb/FAQ structured data and a 1200×630 social image. Primary text and links work without JavaScript. There are no invented ratings, client results or dates.

Verify `arcoai.info` in Google Search Console with a DNS TXT record, submit `https://arcoai.info/sitemap.xml`, then inspect the language home pages. Optionally verify Yandex Webmaster and configure Tashkent as the region. Verification tokens and the optional Yandex Metrika counter are in `site/config.json`; no counter is installed until a real ID is provided.

GEO relies on the same accessible, useful, factual content as SEO. `llms.txt` is supplementary and does not guarantee AI citations or indexing. Keep case status current, add real outcomes when available, and track actual indexing in Search Console.
Reference: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
