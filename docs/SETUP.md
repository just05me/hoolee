# hoolee production setup

## Contacts and delivery

Public Telegram bot: https://t.me/hooleeuz_bot
Public email: hoolee.uz@gmail.com

Put BOT_TOKEN and CHAT_ID into `/opt/hoolee/.env`, permissions 600. The recipient must press Start in the bot. The API verifies Telegram success before showing success on the website. Email opens a draft in the visitor’s mail client; it is not a server SMTP delivery.

After changing `.env`: `sudo docker compose up -d --force-recreate api` from `/opt/hoolee`.
Never log, commit or expose `.env`. The Docker context explicitly excludes it.

## Hosting

Existing EC2: 3.70.84.61. Dedicated Compose project `hoolee` in `/opt/hoolee`.
Host-only ports: site 4321, lead API 8788, Ark demo 8787.
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
