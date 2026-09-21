#!/usr/bin/env python3
"""Генератор статического сайта hoolee. Только stdlib.

    python3 build.py            # собирает ../dist
    DEMO_URL=https://demo.hoolee.uz python3 build.py

Настройки — в config.json (домен, ссылка на демо, email, username бота, коды подтверждения).
"""
from __future__ import annotations

import html
import json
import os
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from content import DEFAULT_LANG, LANG_NAMES, LANGS, OG_LOCALE, T  # noqa: E402

DIST = ROOT.parent / "dist"
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
if os.environ.get("DEMO_URL"):
    CFG["demo_url"] = os.environ["DEMO_URL"]
if os.environ.get("SITE_URL"):
    CFG["domain"] = os.environ["SITE_URL"]
DOMAIN = CFG["domain"].rstrip("/")

ROUTES = {
    "home": "",
    "services": "services/",
    "cases": "cases/",
    "ark": "cases/ark-core/",
    "anton": "cases/anton/",
    "about": "about/",
    "contact": "contact/",
}
ASSET_V = date.today().strftime("%Y%m%d")


# ───────────── helpers ─────────────
def esc(s: str) -> str:
    return html.escape(s, quote=True)


def hl(s: str) -> str:
    """Экранирует и превращает {слово} в <em>слово</em>."""
    out = esc(s)
    return out.replace("{", "<em>").replace("}", "</em>")


def plain(s: str) -> str:
    return s.replace("{", "").replace("}", "")


def url(lang: str, route: str, absolute: bool = False) -> str:
    path = f"/{lang}/{ROUTES[route]}"
    return f"{DOMAIN}{path}" if absolute else path


def j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


# ───────────── SVG / визуальные блоки ─────────────
def logo_svg() -> str:
    return '<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="var(--accent)"/></svg>'


def arrow_svg() -> str:
    return '<svg class="arr" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h9M8.5 4L12.5 8l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def ark_mini_svg() -> str:
    pts = [(40, 110), (120, 50), (120, 170), (210, 110), (300, 50), (300, 170), (380, 110)]
    edges = [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (3, 5), (4, 6), (5, 6)]
    e = "".join(
        f'<line x1="{pts[a][0]}" y1="{pts[a][1]}" x2="{pts[b][0]}" y2="{pts[b][1]}" class="ln"/>'
        f'<circle r="3" class="pk" style="--d:{(i*0.55):.2f}s"><animateMotion dur="2.6s" begin="{(i*0.55):.2f}s" repeatCount="indefinite" path="M{pts[a][0]},{pts[a][1]} L{pts[b][0]},{pts[b][1]}"/></circle>'
        for i, (a, b) in enumerate(edges)
    )
    n = "".join(f'<circle cx="{x}" cy="{y}" r="9" class="nd" style="--d:{i*0.3:.1f}s"/>' for i, (x, y) in enumerate(pts))
    return f'<svg class="viz viz-ark" viewBox="0 0 420 220" aria-hidden="true">{e}{n}</svg>'


def anton_mini_svg() -> str:
    cells = []
    import random

    rnd = random.Random(7)
    for r in range(7):
        for c in range(14):
            x = 20 + c * 28
            y = 20 + r * 28
            lvl = rnd.choice([0, 0, 1, 1, 2, 3])
            cells.append(f'<rect x="{x}" y="{y}" width="20" height="20" rx="4" class="cell l{lvl}" style="--d:{rnd.random()*4:.2f}s"/>')
    return f'<svg class="viz viz-anton" viewBox="0 0 420 220" aria-hidden="true">{"".join(cells)}</svg>'


def org_svg(labels: dict) -> str:
    # узлы: (ключ, x, y, w)
    W, H = 132, 44
    nodes = {
        "dispatcher": (334, 10, 132),
        "cpo": (110, 110, 132),
        "cto": (334, 110, 132),
        "design": (558, 110, 132),
        "squad": (334, 210, 176),
        "qa": (110, 316, 132),
        "security": (334, 316, 132),
        "release": (558, 316, 132),
    }
    edges = [("dispatcher", "cpo"), ("dispatcher", "cto"), ("dispatcher", "design"), ("cpo", "squad"), ("cto", "squad"), ("design", "squad"), ("squad", "qa"), ("squad", "security"), ("squad", "release")]

    def cx(k):
        x, y, w = nodes[k]
        return x + w / 2

    paths = []
    for i, (a, b) in enumerate(edges):
        ax, ay = cx(a), nodes[a][1] + H
        bx, by = cx(b), nodes[b][1]
        my = (ay + by) / 2
        d = f"M{ax},{ay} C{ax},{my} {bx},{my} {bx},{by}"
        paths.append(f'<path d="{d}" class="ln"/><circle r="3.2" class="pk"><animateMotion dur="2.8s" begin="{i*0.35:.2f}s" repeatCount="indefinite" path="{d}"/></circle>')
    boxes = []
    for i, (k, (x, y, w)) in enumerate(nodes.items()):
        cls = "nd top" if k == "dispatcher" else ("nd rev" if k in ("qa", "security", "release") else "nd")
        boxes.append(f'<g class="{cls}" style="--d:{i*0.25:.2f}s"><rect x="{x}" y="{y}" width="{w}" height="{H}" rx="12"/><text x="{x + w/2}" y="{y + H/2 + 5}" text-anchor="middle">{esc(labels[k])}</text></g>')
    return f'<svg class="org" viewBox="0 0 800 370" role="img" aria-label="{esc(labels["dispatcher"])}">{"".join(paths)}{"".join(boxes)}</svg>'


# ───────────── общие куски страницы ─────────────
def head(lang: str, route: str, title: str, desc: str, jsonld: list, noindex: bool = False) -> str:
    alts = "".join(f'<link rel="alternate" hreflang="{l}" href="{url(l, route, True)}">' for l in LANGS)
    alts += f'<link rel="alternate" hreflang="x-default" href="{url(DEFAULT_LANG, route, True)}">'
    og_alts = "".join(f'<meta property="og:locale:alternate" content="{OG_LOCALE[l]}">' for l in LANGS if l != lang)
    ver = ""
    if CFG["verification"].get("google"):
        ver += f'<meta name="google-site-verification" content="{esc(CFG["verification"]["google"])}">'
    if CFG["verification"].get("yandex"):
        ver += f'<meta name="yandex-verification" content="{esc(CFG["verification"]["yandex"])}">'
    ld = "".join(f'<script type="application/ld+json">{j(o)}</script>' for o in jsonld)
    robots = '<meta name="robots" content="noindex">' if noindex else '<meta name="robots" content="index,follow,max-image-preview:large">'
    return f"""<!doctype html>
<html lang="{lang}" data-lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{esc(plain(title))}</title>
<meta name="description" content="{esc(desc)}">
{robots}
<link rel="canonical" href="{url(lang, route, True)}">
{alts}
<meta name="theme-color" content="#08080b">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="hoolee">
<meta property="og:title" content="{esc(plain(title))}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url(lang, route, True)}">
<meta property="og:locale" content="{OG_LOCALE[lang]}">
{og_alts}
<meta property="og:image" content="{DOMAIN}/og.png">
<meta name="twitter:card" content="summary_large_image">
{ver}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/site.css?v={ASSET_V}" as="style">
<link rel="stylesheet" href="/assets/site.css?v={ASSET_V}">
{ld}
</head>"""


def header(lang: str, route: str) -> str:
    t = T[lang]
    def cur(r):
        return route == r or (r == "cases" and route in ("ark", "anton"))

    nav = "".join(f'<a href="{url(lang, r)}"{" aria-current=page" if cur(r) else ""}>{esc(t["nav"][r])}</a>' for r in ("services", "cases", "about", "contact"))
    # aria-current для вложенных кейсов
    langs = "".join(
        f'<a href="{url(l, route)}" hreflang="{l}" lang="{l}"{" aria-current=true" if l == lang else ""} title="{esc(LANG_NAMES[l])}">{l.upper()}</a>' for l in LANGS
    )
    return f"""<body>
<a class="skip" href="#main">{esc(t["site"]["skip"])}</a>
<div class="glow" aria-hidden="true"></div>
<header class="hdr" id="hdr">
  <a class="brand" href="{url(lang, 'home')}" aria-label="hoolee">{logo_svg()}<span>hoolee</span></a>
  <nav class="nav" id="nav" aria-label="Main">{nav}</nav>
  <div class="hdr-r">
    <div class="langs" role="group" aria-label="Language">{langs}</div>
    <a class="btn btn-sm hide-m" href="{url(lang, 'contact')}">{esc(t["cta"]["talk"])}{arrow_svg()}</a>
    <button class="burger" id="burger" aria-expanded="false" aria-controls="nav" aria-label="{esc(t["site"]["menu"])}"><i></i><i></i></button>
  </div>
</header>"""


def footer(lang: str) -> str:
    t = T[lang]
    bot = ""
    if CFG.get("bot_username"):
        bot = f'<li><a href="https://t.me/{esc(CFG["bot_username"])}" rel="noopener" target="_blank">Telegram</a></li>'
    mail = f'<li><a href="mailto:{esc(CFG["email"])}">{esc(CFG["email"])}</a></li>' if CFG.get("email") else ""
    pages = "".join(f'<li><a href="{url(lang, r)}">{esc(t["nav"][r])}</a></li>' for r in ("services", "cases", "about", "contact"))
    return f"""<footer class="ftr">
  <div class="wrap ftr-in">
    <div class="ftr-brand">
      <a class="brand big" href="{url(lang, 'home')}">{logo_svg()}<span>hoolee</span></a>
      <p>{esc(t["site"]["footer_note"])}</p>
    </div>
    <div><h4>{esc(t["footer"]["pages"])}</h4><ul>{pages}</ul></div>
    <div><h4>{esc(t["footer"]["contact"])}</h4><ul><li>{esc(t["site"]["city"])}</li>{bot}{mail}</ul></div>
  </div>
  <div class="wrap ftr-bot"><span>© {date.today().year} hoolee</span><span>hoolee.uz</span></div>
</footer>
<script src="/assets/site.js?v={ASSET_V}" defer></script>
{metrika()}
</body>
</html>"""


def metrika() -> str:
    mid = CFG["analytics"].get("yandex_metrika_id", "")
    if not mid:
        return ""
    return f"""<script>(function(m,e,t,r,i,k,a){{m[i]=m[i]||function(){{(m[i].a=m[i].a||[]).push(arguments)}};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)}})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym({esc(str(mid))},"init",{{clickmap:true,trackLinks:true,accurateTrackBounce:true}});</script>"""


def form(lang: str, page: str) -> str:
    f = T[lang]["form"]
    email_btn = ""
    if CFG.get("email"):
        email_btn = f'<button type="button" class="btn btn-ghost" data-send="email">{esc(f["email"])}{arrow_svg()}</button>'
    return f"""<form class="lead" id="lead" novalidate data-api="{esc(CFG['api_path'])}" data-lang="{lang}" data-page="{esc(page)}" data-email="{esc(CFG.get('email', ''))}" data-subject="{esc(f['subject'])}"
  data-ok="{esc(f['ok'])}" data-err="{esc(f['err'])}" data-required="{esc(f['required'])}" data-sending="{esc(f['sending'])}">
  <h3 class="lead-t">{esc(f["title"])}</h3>
  <div class="row2">
    <label class="fld"><span>{esc(f["name"])}</span><input name="name" autocomplete="name" required maxlength="80"></label>
    <label class="fld"><span>{esc(f["company"])}</span><input name="company" autocomplete="organization" maxlength="120"></label>
  </div>
  <label class="fld"><span>{esc(f["contact"])}</span><input name="contact" autocomplete="tel" required maxlength="120" inputmode="text"></label>
  <label class="fld"><span>{esc(f["message"])}</span><textarea name="message" rows="4" required maxlength="2000" placeholder="{esc(f["message_ph"])}"></textarea></label>
  <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <div class="send">
    <p class="send-t">{esc(f["step2"])}</p>
    <div class="send-b">
      <button type="button" class="btn" data-send="telegram">{esc(f["telegram"])}{arrow_svg()}</button>
      {email_btn}
    </div>
    <p class="hint">{esc(f["step2_hint"])}{(" " + esc(f["email_note"])) if CFG.get("email") else ""}</p>
    <p class="status" role="status" aria-live="polite"></p>
  </div>
</form>"""


def cta_band(lang: str) -> str:
    t = T[lang]
    return f"""<section class="sec cta-band" data-reveal>
  <div class="wrap cta-grid">
    <div><h2 class="h2">{esc(t["home"]["cta_title"])}</h2><p class="lead-p">{esc(t["home"]["cta_lead"])}</p></div>
    {form(lang, "home")}
  </div>
</section>"""


def breadcrumbs(lang: str, items: list) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": name, "item": url(lang, route, True)} for i, (name, route) in enumerate(items)],
    }


def org_ld(lang: str) -> dict:
    t = T[lang]
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": f"{DOMAIN}/#org",
        "name": "hoolee",
        "url": f"{DOMAIN}/",
        "description": t["site"]["tagline"],
        "logo": f"{DOMAIN}/favicon.svg",
        "address": {"@type": "PostalAddress", "addressLocality": "Tashkent", "addressCountry": "UZ"},
        "areaServed": {"@type": "Country", "name": "Uzbekistan"},
        "knowsLanguage": ["uz", "ru", "en"],
        "knowsAbout": ["Business process automation", "AI agents", "AI orchestration", "Telegram bots", "Custom software development"],
    }


def website_ld(lang: str) -> dict:
    return {"@context": "https://schema.org", "@type": "WebSite", "@id": f"{DOMAIN}/#site", "url": f"{DOMAIN}/", "name": "hoolee", "inLanguage": lang, "publisher": {"@id": f"{DOMAIN}/#org"}}


def page_hero(kicker: str, h1: str, lead: str, extra: str = "") -> str:
    return f"""<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-reveal>{esc(kicker)}</p>
    <h1 class="h1 rv" data-reveal>{hl(h1)}</h1>
    <p class="lead-p" data-reveal>{esc(lead)}</p>
    {extra}
  </div>
</section>"""


# ───────────── страницы ─────────────
def page_home(lang: str) -> tuple[str, list, str]:
    t = T[lang]
    h = t["home"]
    lines = "".join(f'<span class="ln"><span class="w" style="--i:{i}">{hl(x)}</span></span>' for i, x in enumerate(h["h1"]))
    marquee = "".join(f"<span>{esc(x)}</span><i></i>" for x in h["marquee"])
    svc = "".join(
        f"""<a class="card spot" href="{url(lang, 'services')}#{s['id']}" data-reveal style="--i:{i}">
      <span class="num">{s['n']}</span><h3>{esc(s['title'])}</h3><p>{esc(s['short'])}</p><span class="more">{esc(t['cta']['all_services'])}{arrow_svg()}</span></a>"""
        for i, s in enumerate(t["services"]["items"])
    )
    ca, cn = t["cases"]["ark"], t["cases"]["anton"]
    cases = f"""<a class="case spot" href="{url(lang, 'ark')}" data-reveal>{ark_mini_svg()}<div class="case-b"><span class="tag">{esc(ca['tag'])}</span><h3>{esc(ca['name'])}</h3><p>{esc(ca['short'])}</p><span class="more">{esc(t['cta']['open'])}{arrow_svg()}</span></div></a>
<a class="case spot" href="{url(lang, 'anton')}" data-reveal style="--i:1">{anton_mini_svg()}<div class="case-b"><span class="tag">{esc(cn['tag'])}</span><h3>{esc(cn['name'])}</h3><p>{esc(cn['short'])}</p><span class="more">{esc(t['cta']['open'])}{arrow_svg()}</span></div></a>"""
    steps = "".join(f'<li data-reveal style="--i:{i}"><span class="num">{p["n"]}</span><h3>{esc(p["title"])}</h3><p>{esc(p["text"])}</p></li>' for i, p in enumerate(t["process"]))
    prin = "".join(f'<div class="prin" data-reveal style="--i:{i}"><h3>{esc(p["title"])}</h3><p>{esc(p["text"])}</p></div>' for i, p in enumerate(t["principles"]))
    faq = "".join(f'<details class="qa" data-reveal><summary>{esc(x["q"])}</summary><p>{esc(x["a"])}</p></details>' for x in t["faq"])
    body = f"""<main id="main">
<section class="hero" id="top">
  <canvas class="net" id="net" aria-hidden="true"></canvas>
  <div class="wrap hero-in">
    <p class="eyebrow pill" data-reveal><span class="dot"></span>{esc(h['eyebrow'])}</p>
    <h1 class="hero-h">{lines}</h1>
    <p class="hero-lead" data-reveal>{esc(h['lead'])}</p>
    <div class="hero-cta" data-reveal>
      <a class="btn" href="{url(lang, 'contact')}">{esc(t['cta']['talk'])}{arrow_svg()}</a>
      <a class="btn btn-ghost" href="{url(lang, 'cases')}">{esc(t['cta']['cases'])}</a>
    </div>
  </div>
  <div class="scroll-hint" aria-hidden="true"><span>{esc(h['scroll'])}</span><i></i></div>
</section>
<div class="marquee" aria-hidden="true"><div class="track">{marquee}{marquee}</div></div>

<section class="sec" id="services">
  <div class="wrap">
    <p class="eyebrow" data-reveal>{esc(h['services_eyebrow'])}</p>
    <h2 class="h2 rv" data-reveal>{esc(h['services_title'])}</h2>
    <div class="grid4">{svc}</div>
  </div>
</section>

<section class="sec" id="cases">
  <div class="wrap">
    <p class="eyebrow" data-reveal>{esc(h['cases_eyebrow'])}</p>
    <h2 class="h2 rv" data-reveal>{esc(h['cases_title'])}</h2>
    <p class="lead-p" data-reveal>{esc(h['cases_lead'])}</p>
    <div class="grid2">{cases}</div>
  </div>
</section>

<section class="sec" id="process">
  <div class="wrap">
    <p class="eyebrow" data-reveal>{esc(h['process_eyebrow'])}</p>
    <h2 class="h2 rv" data-reveal>{esc(h['process_title'])}</h2>
    <ol class="steps" id="steps"><span class="steps-line" aria-hidden="true"><i></i></span>{steps}</ol>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <p class="eyebrow" data-reveal>{esc(h['principles_eyebrow'])}</p>
    <h2 class="h2 rv" data-reveal>{esc(h['principles_title'])}</h2>
    <div class="grid4 prins">{prin}</div>
  </div>
</section>

<section class="sec">
  <div class="wrap narrow">
    <p class="eyebrow" data-reveal>{esc(h['faq_eyebrow'])}</p>
    <h2 class="h2 rv" data-reveal>{esc(h['faq_title'])}</h2>
    <div class="faq">{faq}</div>
  </div>
</section>
{cta_band(lang)}
</main>"""
    ld = [
        org_ld(lang),
        website_ld(lang),
        {"@context": "https://schema.org", "@type": "FAQPage", "inLanguage": lang, "mainEntity": [{"@type": "Question", "name": x["q"], "acceptedAnswer": {"@type": "Answer", "text": x["a"]}} for x in t["faq"]]},
    ]
    return body, ld, "home"


def page_services(lang: str):
    t = T[lang]
    s = t["services"]
    blocks = ""
    for i, it in enumerate(s["items"]):
        pts = "".join(f"<li>{esc(p)}</li>" for p in it["points"])
        blocks += f"""<article class="svc" id="{it['id']}" data-reveal>
  <div class="svc-l"><span class="num">{it['n']}</span><h2>{esc(it['title'])}</h2><p>{esc(it['short'])}</p></div>
  <div class="svc-r spot"><h3>{esc(s['for_label'])}</h3><p>{esc(it['for'])}</p><h3>{esc(s['gets_label'])}</h3><ul class="ticks">{pts}</ul></div>
</article>"""
    inds = "".join(f"<li>{esc(x)}</li>" for x in s["industries"])
    body = f"""<main id="main">
{page_hero(t['nav']['services'], s['h1'], s['lead'])}
<section class="sec tight"><div class="wrap">{blocks}</div></section>
<section class="sec tight"><div class="wrap"><h2 class="h3 rv" data-reveal>{esc(s['industries_title'])}</h2><ul class="chips" data-reveal>{inds}</ul></div></section>
{cta_band(lang)}
</main>"""
    ld = [
        org_ld(lang),
        breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["services"], "services")]),
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": t["nav"]["services"],
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "item": {"@type": "Service", "name": it["title"], "description": it["short"], "provider": {"@id": f"{DOMAIN}/#org"}, "areaServed": {"@type": "Country", "name": "Uzbekistan"}}}
                for i, it in enumerate(s["items"])
            ],
        },
    ]
    return body, ld, "services"


def page_cases(lang: str):
    t = T[lang]
    c = t["cases"]
    ca, cn = c["ark"], c["anton"]
    cards = f"""<a class="case spot" href="{url(lang, 'ark')}" data-reveal>{ark_mini_svg()}<div class="case-b"><span class="tag">{esc(ca['tag'])}</span><h2>{esc(ca['name'])}</h2><p>{esc(ca['short'])}</p><span class="more">{esc(t['cta']['open'])}{arrow_svg()}</span></div></a>
<a class="case spot" href="{url(lang, 'anton')}" data-reveal style="--i:1">{anton_mini_svg()}<div class="case-b"><span class="tag">{esc(cn['tag'])}</span><h2>{esc(cn['name'])}</h2><p>{esc(cn['short'])}</p><span class="more">{esc(t['cta']['open'])}{arrow_svg()}</span></div></a>"""
    body = f"""<main id="main">
{page_hero(t['nav']['cases'], c['h1'], c['lead'])}
<section class="sec tight"><div class="wrap grid2">{cards}</div></section>
{cta_band(lang)}
</main>"""
    ld = [org_ld(lang), breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["cases"], "cases")])]
    return body, ld, "cases"


def feature_grid(items) -> str:
    return '<div class="grid3">' + "".join(f'<div class="feat spot" data-reveal style="--i:{i % 3}"><h3>{esc(x["t"])}</h3><p>{esc(x["d"])}</p></div>' for i, x in enumerate(items)) + "</div>"


def stack_chips(items) -> str:
    return '<ul class="chips" data-reveal>' + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>"


def page_ark(lang: str):
    t = T[lang]
    a = t["cases"]["ark"]
    chain = "".join(f'<li style="--i:{i}"><span class="n">{i+1}</span>{esc(x)}</li>' for i, x in enumerate(a["chain"]))
    demo = CFG["demo_url"]
    body = f"""<main id="main">
{page_hero(a['tag'], a['h1'], a['lead'])}
<section class="sec tight"><div class="wrap">
  <h2 class="h3 rv" data-reveal>{esc(a['chain_title'])}</h2>
  <ol class="chain" data-reveal>{chain}</ol>
</div></section>
<section class="sec tight" id="demo"><div class="wrap">
  <h2 class="h2 rv" data-reveal>{esc(a['demo_title'])}</h2>
  <p class="lead-p" data-reveal>{esc(a['demo_lead'])}</p>
  <div class="frame" data-reveal>
    <div class="frame-bar"><span></span><span></span><span></span><em>demo.hoolee.uz</em><a href="{esc(demo)}" target="_blank" rel="noopener">{esc(a['demo_open'])}{arrow_svg()}</a></div>
    <div class="frame-body"><div class="frame-load">{esc(a['demo_loading'])}</div><iframe data-src="{esc(demo)}" title="Ark Core demo" loading="lazy" allow="clipboard-write" referrerpolicy="no-referrer"></iframe></div>
  </div>
  <p class="note" data-reveal>{esc(a['demo_note'])}</p>
</div></section>
<section class="sec tight"><div class="wrap">
  <h2 class="h2 rv" data-reveal>{esc(a['features_title'])}</h2>
  {feature_grid(a['features'])}
  <h3 class="h3" data-reveal style="margin-top:56px">{esc(a['stack_title'])}</h3>
  {stack_chips(a['stack'])}
</div></section>
<section class="sec cta-band" data-reveal><div class="wrap cta-grid"><div><h2 class="h2">{esc(a['cta'])}</h2><p class="lead-p">{esc(t['home']['cta_lead'])}</p></div>{form(lang, 'ark-core')}</div></section>
</main>"""
    ld = [
        org_ld(lang),
        breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["cases"], "cases"), (a["name"], "ark")]),
        {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": a["name"], "applicationCategory": "BusinessApplication", "operatingSystem": "Web", "description": a["description"], "inLanguage": lang, "creator": {"@id": f"{DOMAIN}/#org"}},
    ]
    return body, ld, "ark"


def page_anton(lang: str):
    t = T[lang]
    a = t["cases"]["anton"]
    body = f"""<main id="main">
{page_hero(a['tag'], a['h1'], a['lead'])}
<section class="sec tight"><div class="wrap">
  <h2 class="h2 rv" data-reveal>{esc(a['org_title'])}</h2>
  <p class="lead-p" data-reveal>{esc(a['org_lead'])}</p>
  <div class="org-wrap spot" data-reveal>{org_svg(a['org'])}</div>
</div></section>
<section class="sec tight"><div class="wrap">
  <h2 class="h2 rv" data-reveal>{esc(a['features_title'])}</h2>
  {feature_grid(a['features'])}
</div></section>
<section class="sec tight"><div class="wrap two">
  <div data-reveal><h3 class="h3">{esc(a['status_title'])}</h3><p class="lead-p">{esc(a['status'])}</p></div>
  <div data-reveal><h3 class="h3">{esc(a['stack_title'])}</h3><ul class="chips">{"".join(f"<li>{esc(x)}</li>" for x in a['stack'])}</ul></div>
</div></section>
<section class="sec cta-band" data-reveal><div class="wrap cta-grid"><div><h2 class="h2">{esc(a['cta'])}</h2><p class="lead-p">{esc(t['home']['cta_lead'])}</p></div>{form(lang, 'anton')}</div></section>
</main>"""
    ld = [
        org_ld(lang),
        breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["cases"], "cases"), (a["name"], "anton")]),
        {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": a["name"], "applicationCategory": "BusinessApplication", "operatingSystem": "Web", "description": a["description"], "inLanguage": lang, "creator": {"@id": f"{DOMAIN}/#org"}},
    ]
    return body, ld, "anton"


def page_about(lang: str):
    t = T[lang]
    a = t["about"]
    story = "".join(f'<p data-reveal>{esc(p)}</p>' for p in a["story"])
    vals = "".join(f"<li>{esc(v)}</li>" for v in a["values"])
    initials = "MA"
    body = f"""<main id="main">
{page_hero(t['nav']['about'], a['h1'], a['lead'])}
<section class="sec tight"><div class="wrap two">
  <div><h2 class="h3 rv" data-reveal>{esc(a['story_title'])}</h2><div class="prose">{story}</div></div>
  <div class="founder spot" data-reveal>
    <div class="photo" role="img" aria-label="{esc(a['founder_photo'])}"><span>{initials}</span><small>{esc(a['founder_photo'])}</small></div>
    <p class="tag">{esc(a['founder_title'])}</p>
    <h3>{esc(a['founder_name'])}</h3>
    <p class="role">{esc(a['founder_role'])}</p>
    <p>{esc(a['founder_text'])}</p>
  </div>
</div></section>
<section class="sec tight"><div class="wrap"><h2 class="h3 rv" data-reveal>{esc(a['values_title'])}</h2><ul class="chips" data-reveal>{vals}</ul></div></section>
{cta_band(lang)}
</main>"""
    ld = [
        org_ld(lang),
        breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["about"], "about")]),
        {"@context": "https://schema.org", "@type": "Person", "name": a["founder_name"], "jobTitle": a["founder_role"], "worksFor": {"@id": f"{DOMAIN}/#org"}, "address": {"@type": "PostalAddress", "addressLocality": "Tashkent", "addressCountry": "UZ"}},
    ]
    return body, ld, "about"


def page_contact(lang: str):
    t = T[lang]
    c = t["contact"]
    bot = ""
    if CFG.get("bot_username"):
        bot = f'<p><a class="link" href="https://t.me/{esc(CFG["bot_username"])}" target="_blank" rel="noopener">Telegram @{esc(CFG["bot_username"])}</a></p>'
    mail = f'<p><a class="link" href="mailto:{esc(CFG["email"])}">{esc(CFG["email"])}</a></p>' if CFG.get("email") else ""
    body = f"""<main id="main">
{page_hero(t['nav']['contact'], c['h1'], c['lead'])}
<section class="sec tight"><div class="wrap cta-grid">
  <div data-reveal class="contact-side"><p class="tag">{esc(c['location'])}</p>{bot}{mail}</div>
  {form(lang, 'contact')}
</div></section>
</main>"""
    ld = [org_ld(lang), breadcrumbs(lang, [("hoolee", "home"), (t["nav"]["contact"], "contact")]), {"@context": "https://schema.org", "@type": "ContactPage", "url": url(lang, "contact", True), "inLanguage": lang}]
    return body, ld, "contact"


PAGES = {
    "home": (page_home, lambda t: (t["home"]["title"], t["home"]["description"])),
    "services": (page_services, lambda t: (t["services"]["title"], t["services"]["description"])),
    "cases": (page_cases, lambda t: (t["cases"]["title"], t["cases"]["description"])),
    "ark": (page_ark, lambda t: (t["cases"]["ark"]["title"], t["cases"]["ark"]["description"])),
    "anton": (page_anton, lambda t: (t["cases"]["anton"]["title"], t["cases"]["anton"]["description"])),
    "about": (page_about, lambda t: (t["about"]["title"], t["about"]["description"])),
    "contact": (page_contact, lambda t: (t["contact"]["title"], t["contact"]["description"])),
}


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    shutil.copytree(ROOT / "static", DIST / "assets", ignore=shutil.ignore_patterns("favicon.svg", "og.png", "*.md"))
    for name in ("favicon.svg", "og.png"):
        if (ROOT / "static" / name).exists():
            shutil.copy(ROOT / "static" / name, DIST / name)

    for lang in LANGS:
        for route, (fn, meta) in PAGES.items():
            body, ld, r = fn(lang)
            title, desc = meta(T[lang])
            html_doc = head(lang, route, title, desc, ld) + header(lang, route) + body + footer(lang)
            write(DIST / lang / ROUTES[route] / "index.html", html_doc)

    # 404 (без языка: показываем на трёх языках)
    nf = "".join(f'<p><a class="link" href="/{l}/">{esc(T[l]["not_found"]["text"])}</a></p>' for l in LANGS)
    write(
        DIST / "404.html",
        head("en", "home", "404 — hoolee", "Not found", [], noindex=True)
        + header("en", "home")
        + f'<main id="main"><section class="phero"><div class="wrap"><h1 class="h1">404</h1>{nf}</div></section></main>'
        + footer("en"),
    )

    # корень: перенаправление на язык по умолчанию + выбор языка по браузеру
    alts = "".join(f'<link rel="alternate" hreflang="{l}" href="{url(l, "home", True)}">' for l in LANGS)
    links = "".join(f'<a href="/{l}/">{LANG_NAMES[l]}</a> ' for l in LANGS)
    write(
        DIST / "index.html",
        f"""<!doctype html><html lang="{DEFAULT_LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hoolee</title><meta name="description" content="{esc(T[DEFAULT_LANG]['home']['description'])}">
<link rel="canonical" href="{url(DEFAULT_LANG, 'home', True)}">{alts}<link rel="alternate" hreflang="x-default" href="{url(DEFAULT_LANG, 'home', True)}">
<meta name="theme-color" content="#08080b"><meta name="robots" content="index,follow">
<meta http-equiv="refresh" content="0;url=/{DEFAULT_LANG}/">
<style>body{{background:#08080b;color:#f2f2f5;font:16px system-ui;display:grid;place-items:center;height:100vh}}a{{color:#ff8a00;margin:0 8px}}</style>
<script>try{{var l=(navigator.language||'').slice(0,2).toLowerCase();var m={{ru:'ru',en:'en',uz:'uz'}};var p=localStorage.getItem('lang')||m[l]||'{DEFAULT_LANG}';location.replace('/'+p+'/');}}catch(e){{}}</script>
</head><body><p>{links}</p></body></html>""",
    )

    # sitemap с hreflang
    urls = []
    for route in ROUTES:
        for lang in LANGS:
            alt = "".join(f'<xhtml:link rel="alternate" hreflang="{l}" href="{url(l, route, True)}"/>' for l in LANGS)
            alt += f'<xhtml:link rel="alternate" hreflang="x-default" href="{url(DEFAULT_LANG, route, True)}"/>'
            pr = "1.0" if route == "home" else "0.8"
            urls.append(f"<url><loc>{url(lang, route, True)}</loc><lastmod>{date.today().isoformat()}</lastmod><priority>{pr}</priority>{alt}</url>")
    write(DIST / "sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' + "".join(urls) + "</urlset>")

    # robots: разрешаем поисковые и ИИ-краулеры (GEO)
    bots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "YandexBot"]
    robots = "User-agent: *\nAllow: /\nDisallow: /api/\n\n" + "".join(f"User-agent: {b}\nAllow: /\n\n" for b in bots) + f"Sitemap: {DOMAIN}/sitemap.xml\n"
    write(DIST / "robots.txt", robots)

    # llms.txt — краткое описание для ИИ-поисковиков
    write(DIST / "llms.txt", llms_txt())
    print(f"✓ dist собран: {sum(1 for _ in DIST.rglob('*.html'))} html, языки: {', '.join(LANGS)}")


def llms_txt() -> str:
    en = T["en"]
    lines = [
        "# hoolee",
        "",
        f"> {en['site']['tagline']}. {en['home']['description']}",
        "",
        "hoolee is a software studio based in Tashkent, Uzbekistan. We work with businesses in Uzbekistan and speak Uzbek, Russian and English.",
        "",
        "## Services",
    ]
    for it in en["services"]["items"]:
        lines.append(f"- [{it['title']}]({url('en', 'services', True)}#{it['id']}): {it['short']}")
    lines += ["", "## Cases"]
    for k in ("ark", "anton"):
        c = en["cases"][k]
        lines.append(f"- [{c['name']}]({url('en', k, True)}): {c['short']}")
    lines += ["", "## Languages", ""]
    for l in LANGS:
        lines.append(f"- {LANG_NAMES[l]}: {DOMAIN}/{l}/")
    lines += ["", "## Contact", f"- {url('en', 'contact', True)}", "", "## FAQ"]
    for x in en["faq"]:
        lines += [f"### {x['q']}", x["a"], ""]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    build()
