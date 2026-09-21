# hoolee

Custom software and business automation studio in Tashkent. Static pages in Uzbek, Russian and English, a Telegram lead API and an isolated Ark Core demo.

## Run locally

```sh
cp .env.example .env
# Set BOT_TOKEN and CHAT_ID, then press Start in @hooleeuz_bot.
python3 dev.py
```

Site: http://127.0.0.1:4321 · demo: http://127.0.0.1:8787 · API: http://127.0.0.1:8788.
The root `.env` is loaded by the API. If delivery is not configured, submissions return 503 rather than a false success. Local requests are proxied to the API. Restart the local API after changing environment settings.

## Build and verify

```sh
python3 site/build.py
python3 -m unittest discover -s tests -v
```

The tests check 21 localized pages, links, metadata, structured data and HTTP lead delivery with a mocked Telegram upstream. They do not send real messages.
Browser regression checks: `PLAYWRIGHT_MODULE=/path/to/playwright node scripts/browser-checks.cjs` (Google Chrome required). Set `BASE_URL` to check another deployment.

## Structure

- `site/content.py`: localized copy and studio positioning.
- `site/build.py`: static pages, metadata, sitemap, robots, llms.txt.
- `site/config.json`: public contact and domain settings. Never put bot tokens here.
- `site/static/`: accessible responsive UI, vector logo/favicon, real demo screenshot, social card.
- `services/api/`: bounded, validated lead requests delivered to Telegram; secrets remain server-side.
- `services/demo-ark/`: isolated demo with fictional data, no external AI calls.
- `docker/`, `docker-compose.yml`, `deploy/`: services and host Caddy configuration.
- `anton/`: excluded private repository; only the public description is published.

## Deployment

See [deployment and DNS notes](docs/SETUP.md). The server path is `/opt/hoolee`; existing finance and portfolio deployments are separate. The `.env` is excluded from Git and Docker build context.
