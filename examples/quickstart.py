"""Scrapling quickstart: one request, one selector, one crawl.

Run:  python examples/quickstart.py
Deps: pip install "scrapling[all]>=0.4.15" && scrapling install
"""

from __future__ import annotations


def static_page() -> None:
    """Fast path: plain HTTP with a real browser's TLS fingerprint."""
    from scrapling.fetchers import Fetcher

    page = Fetcher.get("https://quotes.toscrape.com/")
    print("status:", page.status)
    for text in page.css(".quote .text::text").getall()[:3]:
        print("  ", text.strip())


def session() -> None:
    """Keep cookies and connections across requests - use for logins, pagination."""
    from scrapling.fetchers import FetcherSession

    with FetcherSession(impersonate="chrome") as s:
        page = s.get("https://quotes.toscrape.com/", stealthy_headers=True)
        print("session quotes:", len(page.css(".quote")))


def dynamic_page() -> None:
    """JS-rendered page: needs a real browser."""
    from scrapling.fetchers import DynamicFetcher

    page = DynamicFetcher.fetch("https://quotes.toscrape.com/js/", network_idle=True)
    print("dynamic quotes:", len(page.css(".quote")))


def stealthy_page() -> None:
    """Anti-bot protected page. Uncomment once `scrapling install` has run."""
    from scrapling.fetchers import StealthyFetcher

    page = StealthyFetcher.fetch("https://nopecha.com/demo/cloudflare", solve_cloudflare=True)
    print("stealthy title:", page.css("title::text").get())


def crawl() -> None:
    """A concurrent crawler with pause/resume and proxy rotation available."""
    from scrapling.spiders import Spider, Response

    class Quotes(Spider):
        name = "quotes"
        start_urls = ["https://quotes.toscrape.com/"]
        concurrent_requests = 5
        robots_txt_obey = True

        async def parse(self, response: Response):
            for q in response.css(".quote"):
                yield {
                    "text": q.css(".text::text").get(),
                    "author": q.css(".author::text").get(),
                }
            if nxt := response.css(".next a"):
                yield response.follow(nxt[0].attrib["href"])

    result = Quotes().start()
    print("crawled:", len(result.items), "items")
    result.items.to_json("quotes.json")
    print("wrote quotes.json")


if __name__ == "__main__":
    static_page()
    session()
    dynamic_page()
    crawl()
    # stealthy_page()   # needs `scrapling install` and network access to nopecha.com
