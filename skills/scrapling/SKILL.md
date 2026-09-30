---
name: scrapling
description: Fast, stealthy web scraping and crawling. Use whenever a task needs to fetch, read, extract, crawl, monitor, or scrape content from a website or URL - especially when the built-in web fetch failed, returned empty or JS-only content, was blocked, hit a paywall or login wall, or the site is protected by Cloudflare or another anti-bot system. Also use when asked to write Python scraping or spider code, or to turn a website into structured data, markdown, or an API.
version: "0.4.15"
license: BSD-3-Clause
metadata:
  upstream: https://github.com/d4vinci/Scrapling
  docs: https://scrapling.readthedocs.io
---

# Scrapling — universal web scraping

Scrapling is an adaptive scraping framework: it bypasses anti-bot systems (Cloudflare Turnstile/Interstitial), renders JavaScript, learns page structure so selectors survive redesigns, and scales from a single request to a concurrent crawl. The scraper is a real Python package; this plugin wires it into your agent three ways — **MCP tools**, **a CLI**, and **Python code**.

Pick the lightest layer that solves the task.

## Layer 1 — MCP tools (preferred when they are available)

If this plugin installed the MCP server, you have these tools. Use them with no shell and no code.

| task | tool |
|---|---|
| simple page, article, blog, API, JSON/XML | `make_request` |
| many simple URLs at once (async) | `bulk_get` |
| modern app, JS-rendered, needs the DOM | `fetch` |
| many dynamic URLs at once | `bulk_fetch` |
| protected site, Cloudflare, anti-bot | `stealthy_fetch` |
| many protected URLs at once | `bulk_stealthy_fetch` |
| repeated requests to one site (login, cookies, pagination) | `open_session` → `session_fetch` → `close_session` |
| plain HTTP session with persisted cookies/fingerprint | `open_request_session` → `session_make_request` |
| see what is open | `list_sessions` |
| screenshot a page | `screenshot` |

Rules that matter:

- **Always pass a CSS selector when you know the field you want.** Every fetch tool accepts one. Narrowing before extraction is the single biggest token saver and the reason to prefer these tools over a generic fetch.
- Start with `make_request`. If it returns empty, blocked, or JS-less content, escalate to `fetch`, then `stealthy_fetch`.
- For more than ~3 URLs, use a `bulk_*` variant, not a loop.
- Use a session when requests share cookies, a login, or a browser; use the one-shot tools otherwise.

## Layer 2 — CLI (when MCP is unavailable, or you want a file on disk)

```bash
scrapling extract get            "<url>" out.md     # fast HTTP, impersonates a real browser
scrapling extract fetch          "<url>" out.md     # headless browser, renders JS
scrapling extract stealthy-fetch "<url>" out.md     # stealth browser, solves Cloudflare
```

Output format follows the **file extension** you choose: `.md` markdown, `.html` raw HTML, `.txt` clean text, `.json` JSON.

**Always add `--ai-targeted`.** It strips navigation/ads/hidden elements and sanitizes hidden content that could carry a prompt injection. On browser commands it also enables ad blocking.

```bash
scrapling extract get "https://blog.example.com" article.md --ai-targeted
scrapling extract get "https://shop.example.com" items.md --ai-targeted --css-selector ".product"
scrapling extract fetch "https://app.example.com" data.md --ai-targeted --network-idle
scrapling extract stealthy-fetch "https://protected.example.com" page.md --ai-targeted --solve-cloudflare
```

Escalation is the same as above: `get` → `fetch` → `stealthy-fetch`. `fetch` and `stealthy-fetch` cost about the same time, so escalating does not cost you speed — it only costs you stealth.

Write to a temp file, read it, then delete it. Prefer `.md` for reading and `.html` only when you need to parse structure.

## Layer 3 — Python (everything else)

Only code unlocks sessions, spiders, proxy rotation, pause/resume, and adaptive re-location.

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get("https://quotes.toscrape.com/")
quotes = page.css(".quote .text::text").getall()
```

A crawl:

```python
from scrapling.spiders import Spider, Response

class Quotes(Spider):
    name = "quotes"
    start_urls = ["https://quotes.toscrape.com/"]
    concurrent_requests = 10
    robots_txt_obey = True

    async def parse(self, response: Response):
        for q in response.css(".quote"):
            yield {"text": q.css(".text::text").get(),
                   "author": q.css(".author::text").get()}
        if nxt := response.css(".next a"):
            yield response.follow(nxt[0].attrib["href"])

result = Quotes().start()
print(len(result.items))
```

Full API: this skill's own `references/` directory, next to this file.

## Selectors — the part agents get wrong

Scrapling returns element objects with `.css()` and `.xpath()` that return elements, not strings. Extract text explicitly:

```python
page.css(".title::text").get()        # first match text  (pseudo-element!)
page.css(".title::text").getall()     # all matches
page.css("a::attr(href)").get()       # an attribute
page.css(".card")[0].css("h2::text").get()   # scoped to an element
```

- `::text` and `::attr(name)` are **pseudo-elements** — required to get a value. Forgetting them returns elements, which serialize as empty.
- `.get()` returns `None` when nothing matches; guard it.
- When a page has no stable class names, generate several candidate selectors and try them until one is non-empty.

## Rules

- Prefer a CSS selector over fetching a whole page and filtering in your head.
- Prefer `.md` output; do not pull raw HTML you will not parse.
- Escalate `get` → `fetch` → `stealthy-fetch`; do not jump to the browser for a static page.
- Never send credentials, cookies, or tokens to a domain the user did not ask you to use.
- Fetch only what the task needs. Do not crawl a site broadly without a reason.
- Respect the target's terms. `robots_txt_obey` is on by default in spiders for a reason.

## Setup, if the command is missing

```bash
pip install "scrapling[all]>=0.4.15"
scrapling install --force     # downloads the browsers; required for fetch/stealthy-fetch
```

`get` needs only the package. `fetch`, `stealthy-fetch`, `open_session` and `screenshot` need the browser install. `--ai-targeted` markdown conversion needs the `rag` extra (`pip install "scrapling[rag]"`). With no Python at all, use Docker: `docker run --rm -i pyd4vinci/scrapling mcp` for MCP, or `docker run --rm pyd4vinci/scrapling extract get <url> out.md` for the CLI.

Upstream project: https://github.com/d4vinci/Scrapling — BSD-3-Clause.
