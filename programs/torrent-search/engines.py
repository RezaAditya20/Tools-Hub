"""
Torrent search engines - reimplemented from qBittorrent nova3 engines.
Each engine class implements search(query, cat) -> list[dict].
Results contain: link, name, size, seeds, leech, engine_url, desc_link, pub_date
"""

import datetime
import gzip
import html as html_mod
import io
import json
import math
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from typing import Any, Dict, List, Mapping, Optional, Tuple, TypedDict, Union
from urllib.parse import quote, unquote, urlencode


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _get_browser_ua() -> str:
    base_date = datetime.date(2024, 4, 16)
    base_version = 125
    now = datetime.date.today()
    ver = base_version + ((now - base_date).days // 30)
    return (
        f"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:{ver}.0) "
        f"Gecko/20100101 Firefox/{ver}.0"
    )


def retrieve_url(url: str, data: Optional[bytes] = None, timeout: int = 15) -> str:
    """Fetch URL content as string. Handles gzip, encoding, redirects."""
    # Encode spaces to %20 in the URL path/query
    url = url.replace(" ", "%20")
    headers = {"User-Agent": _get_browser_ua()}
    req = urllib.request.Request(url, data, headers)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return ""
    raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        with io.BytesIO(raw) as s, gzip.GzipFile(fileobj=s) as g:
            raw = g.read()
    charset = "utf-8"
    ct = resp.headers.get("Content-Type", "")
    if "charset=" in ct:
        charset = ct.split("charset=", 1)[1].split(";")[0].strip()
    return raw.decode(charset, "replace")


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class TorrentResult(TypedDict, total=False):
    link: str
    name: str
    size: str
    seeds: int
    leech: int
    engine_url: str
    desc_link: str
    pub_date: int
    poster: str


# ---------------------------------------------------------------------------
# PirateBay (API-based)
# ---------------------------------------------------------------------------

class PirateBay:
    name = "The Pirate Bay"
    url = "https://thepiratebay.org"
    supported_categories = {"all": "0", "music": "100", "movies": "200", "games": "400", "software": "300"}

    trackers_list = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://p4p.arenabg.ch:1337/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
        "udp://www.torrent.eu.org:451/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://open.stealth.si:80/announce",
        "udp://exodus.desync.com:6969/announce",
    ]
    trackers = "&".join(urlencode({"tr": t}) for t in trackers_list)

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        category = self.supported_categories.get(cat, "0")
        params: Dict[str, str] = {"q": query}
        if category != "0":
            params["cat"] = category
        url = "https://apibay.org/q.php?" + urlencode(params)
        data = retrieve_url(url)
        if not data:
            return []
        try:
            items = json.loads(data)
        except json.JSONDecodeError:
            return []
        if not items or (len(items) == 1 and items[0].get("id") == "0"):
            return []
        results: List[TorrentResult] = []
        for r in items:
            if r.get("info_hash", "").strip("0") == "":
                continue
            name = r.get("name", "")
            dn = urlencode({"dn": name})
            link = f"magnet:?xt=urn:btih:{r['info_hash']}&{dn}&{self.trackers}"
            results.append({
                "link": link,
                "name": name,
                "size": r.get("size", "0") + " B",
                "seeds": int(r.get("seeders", 0)),
                "leech": int(r.get("leechers", 0)),
                "engine_url": self.url,
                "desc_link": f"{self.url}/description.php?id={r.get('id', '')}",
                "pub_date": int(r.get("added", 0)),
            })
        return results


# ---------------------------------------------------------------------------
# TorrentsCSV (API-based)
# ---------------------------------------------------------------------------

class TorrentsCSV:
    name = "TorrentsCSV"
    url = "https://torrents-csv.com"
    supported_categories = {"all": ""}

    trackers_list = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://p4p.arenabg.ch:1337/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
        "udp://www.torrent.eu.org:451/announce",
        "udp://open.stealth.si:80/announce",
        "udp://exodus.desync.com:6969/announce",
    ]
    trackers = "&".join(urlencode({"tr": t}) for t in trackers_list)

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        url = f"{self.url}/service/search?size=100&q={query}"
        data = retrieve_url(url)
        if not data:
            return []
        try:
            resp = json.loads(data)
        except json.JSONDecodeError:
            return []
        results: List[TorrentResult] = []
        for r in resp.get("torrents", []):
            name = r.get("name", "")
            infohash = r.get("infohash", "")
            dn = urlencode({"dn": name})
            link = f"magnet:?xt=urn:btih:{infohash}&{dn}&{self.trackers}"
            results.append({
                "link": link,
                "name": name,
                "size": str(r.get("size_bytes", 0)) + " B",
                "seeds": int(r.get("seeders", 0)),
                "leech": int(r.get("leechers", 0)),
                "engine_url": self.url,
                "desc_link": f"{self.url}/#/search/torrent/{query}/1",
                "pub_date": int(r.get("created_unix", 0)),
            })
        return results


# ---------------------------------------------------------------------------
# YTS (API-based, movies only)
# ---------------------------------------------------------------------------

class YTS:
    name = "YTS"
    url = "https://yts.mx/"
    api_url = "https://yts.mx/api/v2/list_movies.json?"
    supported_categories = {"all": "0", "movies": "1"}

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        params: Dict[str, Any] = {}
        what = unquote(query)

        # Parse quality
        quality_match = re.search(r"(2160|1080|720|480|240)p", what)
        if quality_match:
            params["quality"] = quality_match.group(0)
            what = re.sub(r"(?:2160|1080|720|480|240)p", "", what).strip()

        if what:
            params["query_term"] = what

        url = self.api_url + urlencode(params)
        data = retrieve_url(url)
        if not data:
            return []
        try:
            resp = json.loads(data)
        except json.JSONDecodeError:
            return []
        if resp.get("status") != "ok":
            return []
        movies = resp.get("data", {}).get("movies") or []
        results: List[TorrentResult] = []
        for movie in movies:
            title_long = movie.get("title_long", movie.get("title", ""))
            for t in movie.get("torrents", []):
                name = (
                    f"{title_long} [{t.get('quality', '')}] "
                    f"[{t.get('type', '')}] [{t.get('audio_channels', '')}]"
                )
                results.append({
                    "link": t.get("url", ""),
                    "name": name,
                    "size": t.get("size", ""),
                    "seeds": int(t.get("seeds", 0)),
                    "leech": int(t.get("peers", 0)),
                    "engine_url": self.url,
                    "desc_link": movie.get("url", self.url),
                    "pub_date": int(t.get("date_uploaded_unix", 0)),
                    "poster": movie.get("large_cover_image") or movie.get("medium_cover_image") or "",
                })
        return results


# ---------------------------------------------------------------------------
# Solid Torrents (HTML scraping)
# ---------------------------------------------------------------------------

class SolidTorrents:
    name = "Solid Torrents"
    url = "https://solidtorrents.to"
    supported_categories = {"all": "all", "music": "Audio"}

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        category = self.supported_categories.get(cat, "all")
        all_results: List[TorrentResult] = []
        for page in range(1, 4):
            url = (
                f"{self.url}/search?q={query}&category={category}"
                f"&sort=seeders&sort=desc&page={page}"
            )
            html = retrieve_url(url)
            if not html:
                break
            parser = _SolidParser(self.url)
            parser.feed(html)
            parser.close()
            all_results.extend(parser.results)
            if len(parser.results) < 15:
                break
        return all_results


class _SolidParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._reset()

    def _reset(self):
        self._found_result = False
        self._found_title = False
        self._parse_title = False
        self._found_stats = False
        self._parse_seeds = False
        self._parse_leech = False
        self._parse_size = False
        self._column = -1
        self._torrent: Dict[str, Any] = {
            "link": "", "name": "", "size": "-1",
            "seeds": "-1", "leech": "-1",
            "engine_url": self.base_url, "desc_link": "", "pub_date": -1,
        }

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        cls = p.get("class", "") or ""

        if "search-result" in cls:
            self._found_result = True
            return
        if self._found_result and tag == "h5" and "title" in cls:
            self._found_title = True
        if self._found_title and tag == "a":
            self._torrent["desc_link"] = self.base_url + (p.get("href") or "")
            self._parse_title = True
        if self._found_result and "stats" in cls:
            self._found_stats = True
            self._column = -1
        if self._found_stats and tag == "div":
            self._column += 1
            if self._column == 2:
                self._parse_size = True
        if self._found_stats and tag == "font" and self._column == 3:
            self._parse_seeds = True
        if self._found_stats and tag == "font" and self._column == 4:
            self._parse_leech = True
        if self._found_result and "dl-magnet" in cls and tag == "a":
            self._torrent["link"] = p.get("href", "")
            self._found_result = False
            self._found_stats = False
            if self._torrent["name"]:
                self.results.append(self._torrent.copy())  # type: ignore
            self._reset()

    def handle_data(self, data: str):
        if self._parse_title:
            stripped = data.strip()
            if stripped and stripped != "\n":
                self._torrent["name"] = stripped
            self._parse_title = False
            self._found_title = False
        if self._parse_size:
            self._torrent["size"] = data.strip()
            self._parse_size = False
        if self._parse_seeds:
            self._torrent["seeds"] = data.strip()
            self._parse_seeds = False
        if self._parse_leech:
            self._torrent["leech"] = data.strip()
            self._parse_leech = False


# ---------------------------------------------------------------------------
# EZTV (HTML scraping)
# ---------------------------------------------------------------------------

class EZTV:
    name = "EZTV"
    url = "https://eztvx.to/"
    supported_categories = {"all": "all", "tv": "tv"}

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        slug = query.replace("%20", "-").replace(" ", "-")
        url = f"{self.url}/search/{slug}"
        html = retrieve_url(url, data=b"layout=def_wlinks")
        if not html:
            return []
        parser = _EZTVParser(self.url)
        parser.feed(html)
        parser.close()
        return parser.results


class _EZTVParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._in_row = False
        self._item: Dict[str, Any] = {}
        self._now = datetime.datetime.now()
        self._date_parsers = {
            r"(\d+)h\s+(\d+)m": lambda m: self._now - datetime.timedelta(hours=int(m.group(1)), minutes=int(m.group(2))),
            r"(\d+)d\s+(\d+)h": lambda m: self._now - datetime.timedelta(days=int(m.group(1)), hours=int(m.group(2))),
            r"(\d+)\s+weeks?": lambda m: self._now - datetime.timedelta(weeks=int(m.group(1))),
            r"(\d+)\s+mo": lambda m: self._now - datetime.timedelta(days=int(m.group(1)) * 30),
            r"(\d+)\s+years?": lambda m: self._now - datetime.timedelta(days=int(m.group(1)) * 365),
        }

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        cls = p.get("class", "") or ""

        if cls == "forum_header_border" and p.get("name") == "hover":
            self._in_row = True
            self._item = {
                "link": "", "name": "", "size": "-1",
                "seeds": -1, "leech": -1,
                "engine_url": self.base_url, "desc_link": "", "pub_date": -1,
            }
        if tag == "a" and self._in_row and cls == "magnet":
            self._item["link"] = p.get("href", "")
        if tag == "a" and self._in_row and cls == "epinfo":
            href = p.get("href", "")
            title = p.get("title", "")
            self._item["desc_link"] = self.base_url + href
            self._item["name"] = title.split(" (")[0] if title else ""

    def handle_data(self, data: str):
        data_clean = data.replace(",", "")
        if self._in_row and any(data_clean.endswith(s) for s in (" KB", " MB", " GB")):
            self._item["size"] = data_clean
        elif self._in_row and data_clean.strip().isdigit():
            self._item["seeds"] = int(data_clean)
        elif self._in_row:
            for pat, calc in self._date_parsers.items():
                m = re.match(pat, data)
                if m:
                    self._item["pub_date"] = int(calc(m).timestamp())
                    break

    def handle_endtag(self, tag: str):
        if self._in_row and tag == "tr":
            if self._item.get("link") or self._item.get("name"):
                self.results.append(self._item.copy())  # type: ignore
            self._in_row = False


# ---------------------------------------------------------------------------
# LimeTorrents (HTML scraping)
# ---------------------------------------------------------------------------

class LimeTorrents:
    name = "LimeTorrents"
    url = "https://www.limetorrents.lol"
    supported_categories = {
        "all": "all", "anime": "anime", "software": "applications",
        "games": "games", "movies": "movies", "music": "music", "tv": "tv",
    }

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        category = self.supported_categories.get(cat, "all")
        slug = query.replace("%20", "-").replace(" ", "-")
        all_results: List[TorrentResult] = []
        for page in range(1, 4):
            url = f"{self.url}/search/{category}/{slug}/seeds/{page}/"
            html = retrieve_url(url)
            if not html:
                break
            parser = _LimeParser(self.url)
            parser.feed(html)
            parser.close()
            all_results.extend(parser.results)
            if len(parser.results) < 20:
                break
        return all_results


class _LimeParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._inside_table = False
        self._inside_tr = False
        self._col = -1
        self._col_name: Optional[str] = None
        self._columns = ["name", "pub_date", "size", "seeds", "leech"]
        self._item: Dict[str, Any] = {}
        self._now = datetime.datetime.now()
        self._date_parsers = {
            r"yesterday": lambda m: self._now - datetime.timedelta(days=1),
            r"last\s+month": lambda m: self._now - datetime.timedelta(days=30),
            r"(\d+)\s+years?": lambda m: self._now - datetime.timedelta(days=int(m.group(1)) * 365),
            r"(\d+)\s+months?": lambda m: self._now - datetime.timedelta(days=int(m.group(1)) * 30),
            r"(\d+)\s+days?": lambda m: self._now - datetime.timedelta(days=int(m.group(1))),
            r"(\d+)\s+hours?": lambda m: self._now - datetime.timedelta(hours=int(m.group(1))),
            r"(\d+)\s+minutes?": lambda m: self._now - datetime.timedelta(minutes=int(m.group(1))),
        }

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        if p.get("class") == "table2":
            self._inside_table = True
        elif not self._inside_table:
            return

        if tag == "tr" and p.get("bgcolor") in ("#F4F4F4", "#FFFFFF"):
            self._inside_tr = True
            self._col = -1
            self._item = {"engine_url": self.base_url}
        elif not self._inside_tr:
            return

        if tag == "td":
            self._col += 1
            self._col_name = self._columns[self._col] if self._col < len(self._columns) else None

        if self._col_name == "name" and tag == "a":
            href = p.get("href")
            if href and href.endswith(".html"):
                try:
                    safe = quote(self.base_url + href, safe="/:")
                except KeyError:
                    safe = self.base_url + href
                self._item["link"] = safe
                self._item["desc_link"] = safe

    def handle_data(self, data: str):
        if self._col_name:
            if self._col_name in ("size", "seeds", "leech"):
                data = data.replace(",", "")
            elif self._col_name == "pub_date":
                ts = -1
                for pat, calc in self._date_parsers.items():
                    m = re.match(pat, data, re.IGNORECASE)
                    if m:
                        ts = int(calc(m).timestamp())
                        break
                data = str(ts)
            self._item[self._col_name] = data.strip()
            self._col_name = None

    def handle_endtag(self, tag: str):
        if tag == "table":
            self._inside_table = False
        if self._inside_tr and tag == "tr":
            self._inside_tr = False
            self._col_name = None
            if "link" in self._item:
                self.results.append(self._item.copy())  # type: ignore


# ---------------------------------------------------------------------------
# TorrentProject (HTML scraping)
# ---------------------------------------------------------------------------

class TorrentProject:
    name = "TorrentProject"
    url = "https://torrentproject.se"
    supported_categories = {"all": "0"}

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        q = query.replace("%20", "+")
        all_results: List[TorrentResult] = []
        for page in range(5):
            url = f"{self.url}/browse?t={q}&p={page}"
            html = retrieve_url(url)
            if not html:
                break
            parser = _TPParser(self.url)
            parser.feed(html)
            parser.close()
            all_results.extend(parser.results)
            if len(parser.results) < 20:
                break
        return all_results


class _TPParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._inside_results = False
        self._inside_data_div = False
        self._page_complete = False
        self._span_count = -1
        self._info_map = {"name": 0, "torrLink": 0, "seeds": 2, "leech": 3, "pub_date": 4, "size": 5}
        self._item: Dict[str, Any] = self._empty()

    def _empty(self) -> Dict[str, Any]:
        return {
            "name": "-1", "seeds": "-1", "leech": "-1", "size": "-1",
            "link": "-1", "desc_link": "-1", "engine_url": self.base_url, "pub_date": "-1",
        }

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        cls = p.get("class", "") or ""
        if tag == "div" and "nav" in (p.get("id") or ""):
            self._page_complete = True
        if tag == "div" and p.get("id") == "similarfiles":
            self._inside_results = True
        if tag == "div" and self._inside_results and "gac_bb" not in cls:
            self._inside_data_div = True
        elif tag == "span" and self._inside_data_div and p.get("title") != "verified":
            self._span_count += 1
        if self._inside_data_div and tag == "a" and len(attrs) > 0:
            if self._span_count == self._info_map["torrLink"] and "href" in p:
                self._item["link"] = self.base_url + p["href"]
            if self._span_count == self._info_map["name"] and "href" in p:
                self._item["desc_link"] = self.base_url + p["href"]

    def handle_endtag(self, tag: str):
        if not self._page_complete:
            if tag == "div":
                self._inside_data_div = False
                self._span_count = -1
                name = self._item.get("name", "-1")
                size = self._item.get("size", "-1")
                if name != "-1" and size != "-1":
                    desc = self._item.get("desc_link", "-1")
                    link = self._item.get("link", "-1")
                    if desc != "-1" or link != "-1":
                        try:
                            dt = datetime.datetime.strptime(str(self._item["pub_date"]), "%Y-%m-%d %H:%M:%S")
                            self._item["pub_date"] = int(dt.timestamp())
                        except Exception:
                            pass
                        self.results.append(self._item.copy())  # type: ignore
                self._item = self._empty()

    def handle_data(self, data: str):
        if self._inside_data_div:
            for key, val in self._info_map.items():
                if self._span_count == val:
                    d = data.strip()
                    if d and self._item[key] == "-1":
                        self._item[key] = d
                    elif d and key != "name":
                        self._item[key] += d


# ---------------------------------------------------------------------------
# BitSearch (HTML scraping)
# ---------------------------------------------------------------------------

class BitSearch:
    name = "BitSearch"
    url = "https://bitsearch.to"
    supported_categories = {"all": "all"}

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        q = query.replace("%20", "+").replace(" ", "+")
        all_results: List[TorrentResult] = []
        page = 1
        while page <= 5:
            url = f"{self.url}/search?q={q}&page={page}"
            html = retrieve_url(url)
            if not html:
                break
            parser = _BitSearchParser(self.url)
            parser.feed(html)
            parser.close()
            all_results.extend(parser.results)
            if len(parser.results) < 20:
                break
            page += 1
            time.sleep(0.5)
        return all_results


class _BitSearchParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._in_main = False
        self._in_list = False
        self._in_item = False
        self._in_torrent_info = False
        self._in_name = False
        self._in_stats = False
        self._in_swarm = False
        self._in_download = False
        self._metadata = 0
        self._column = 0
        self._item: Dict[str, Any] = {}

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        cls = p.get("class", "") or ""

        if tag == "main" and "mx-auto" in cls:
            self._in_main = True
            return
        if self._in_main and tag == "div" and "space-y-4" in cls:
            self._in_list = True
            return
        if self._in_list and tag == "div" and "bg-white" in cls:
            self._in_item = True
            self._item = {
                "link": "", "name": "", "size": "-1",
                "seeds": "-1", "leech": "-1",
                "engine_url": self.base_url, "desc_link": "", "pub_date": -1,
            }
            return
        if self._in_item and tag == "div" and "items-start" in cls:
            self._in_torrent_info = True
            return
        if self._in_item and tag == "div" and "items-center" in cls:
            if self._metadata == 0:
                self._in_name = True
                self._metadata = 1
                return
            if self._metadata == 1:
                self._in_stats = True
                self._column = 0
                self._metadata = 2
                return
            if self._metadata == 2:
                self._in_swarm = True
                self._column = 0
                self._metadata = 3
                return
        if self._in_name and tag == "a":
            href = p.get("href")
            if href:
                self._item["desc_link"] = self.base_url + href
            self._in_name = False
            # get name from data
            self._item["_get_name"] = True
            return
        if self._in_stats and tag == "span" and not cls:
            self._column += 1
            self._item["_get_stat"] = True
            return
        if self._in_swarm and tag == "span" and "font-medium" in cls:
            self._column += 1
            self._item["_get_swarm"] = True
            return
        if self._in_item and tag == "div" and "space-y-2" in cls:
            self._in_download = True
            return
        if self._in_download and tag == "a":
            href = p.get("href", "")
            if href.startswith("magnet"):
                self._item["link"] = href
            return

    def handle_data(self, data: str):
        if self._item.get("_get_name"):
            self._item["name"] = data.strip()
            del self._item["_get_name"]
            return
        if self._item.get("_get_stat"):
            if self._column == 2:
                self._item["size"] = data.replace(" ", "")
            elif self._column == 3:
                try:
                    self._item["pub_date"] = int(datetime.datetime.strptime(data.strip(), "%m/%d/%Y").timestamp())
                except Exception:
                    pass
            del self._item["_get_stat"]
            return
        if self._item.get("_get_swarm"):
            if self._column == 1:
                self._item["seeds"] = data.strip()
            elif self._column == 2:
                self._item["leech"] = data.strip()
            del self._item["_get_swarm"]
            return

    def handle_endtag(self, tag: str):
        if tag == "div" and self._in_swarm and not self._item.get("_get_swarm"):
            self._in_swarm = False
            self._metadata = 0
            return
        if self._in_download and tag == "div":
            self._in_download = False
            return
        if tag == "div" and self._in_torrent_info and not self._in_name and not self._in_stats and not self._in_swarm:
            self._in_torrent_info = False
            return
        if tag == "div" and self._in_item and not self._in_torrent_info and not self._in_download:
            self._in_item = False
            if self._item.get("name"):
                self.results.append(self._item.copy())  # type: ignore
            self._metadata = 0
            return
        if tag == "div" and self._in_list and not self._in_item:
            self._in_list = False
            return
        if tag == "main" and self._in_main:
            self._in_main = False
            return


# ---------------------------------------------------------------------------
# BT4GPRX (HTML scraping)
# ---------------------------------------------------------------------------

class BT4GPRX:
    name = "BT4GPRX"
    url = "https://bt4gprx.com"
    supported_categories = {"all": "", "movies": "movie/", "tv": "movie/", "music": "audio/", "books": "doc/", "software": "app/"}

    trackers_list = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
    ]

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        cat_prefix = self.supported_categories.get(cat, "")
        all_results: List[TorrentResult] = []
        page = 1
        while page <= 5:
            url = f"{self.url}/{cat_prefix}search/{query}/byseeders/{page}"
            html = retrieve_url(url)
            if not html:
                break
            parser = _BT4GParser()
            parser.feed(html)
            if not parser.results:
                break
            for r in parser.results:
                all_results.append({
                    "name": r.get("title", ""),
                    "size": r.get("filesize", "-1"),
                    "seeds": int(r.get("seeders", 0)),
                    "leech": int(r.get("leechers", 0)),
                    "engine_url": self.url,
                    "desc_link": self.url + r.get("href", ""),
                    "link": self._build_magnet(r.get("href", "")),
                    "pub_date": -1,
                })
            page += 1
            time.sleep(0.5)
        return all_results

    def _build_magnet(self, href: str) -> str:
        """Try to extract torrent page and find magnet, fallback to torrent file link."""
        if not href:
            return ""
        page_url = self.url + href
        html = retrieve_url(page_url)
        if not html:
            return ""
        m = re.search(r'href="(magnet:[^"]+)"', html)
        if m:
            return html_mod.unescape(m.group(1))
        # Fallback: find hash from downloadtorrentfile.com link
        m2 = re.search(r'href="//downloadtorrentfile\.com/hash/([^"]+)', html)
        if m2:
            hash_val = m2.group(1).split("?")[0]
            dn = urlencode({"dn": href.split("/")[-1].replace("-", " ")})
            trackers = "&".join(urlencode({"tr": t}) for t in self.trackers_list)
            return f"magnet:?xt=urn:btih:{hash_val}&{dn}&{trackers}"
        return ""


class _BT4GParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results: List[Dict[str, str]] = []
        self._in_container = False
        self._in_entry = False
        self._b_value = ""
        self._temp: Dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        if tag == "div" and not self._in_container and p.get("class") == "container":
            self._in_container = True
        elif tag == "a" and self._in_container and "title" in p and "href" in p:
            self._in_entry = True
            self._temp = dict(attrs)
        elif tag == "b" and self._in_entry:
            cls = p.get("class", "") or ""
            id_ = p.get("id", "") or ""
            self._b_value = "filesize" if "cpill" in cls else id_

    def handle_endtag(self, tag: str):
        if tag == "div":
            self._in_entry = False

    def handle_data(self, data: str):
        if self._b_value and self._in_entry:
            self._temp[self._b_value] = data
            if self._b_value == "leechers":
                self.results.append(self._temp.copy())
                self._temp = {}
            self._b_value = ""


# ---------------------------------------------------------------------------
# CloudTorrents (API-based)
# ---------------------------------------------------------------------------

class CloudTorrents:
    name = "CloudTorrents"
    url = "https://cloudtorrents.com"
    api_url = "https://api.cloudtorrents.com/search/"
    supported_categories = {
        "all": None, "anime": "1", "software": "2", "books": "3",
        "games": "4", "movies": "5", "music": "6", "tv": "8",
    }

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        params: Dict[str, Any] = {"offset": 0, "limit": 50, "query": query}
        cat_id = self.supported_categories.get(cat)
        if cat_id is not None:
            params["torrent_type"] = cat_id
        all_results: List[TorrentResult] = []
        while True:
            url = self.api_url + "?" + urlencode(params, quote_via=lambda s, *_: s)
            data = retrieve_url(url)
            if not data:
                break
            try:
                resp = json.loads(data)
            except json.JSONDecodeError:
                break
            for r in resp.get("results", []):
                t = r.get("torrent", {})
                tt = t.get("torrentType", {})
                desc = self.url + "/" + tt.get("name", "").lower() + "/" + str(r.get("id", ""))
                try:
                    pub = int(datetime.datetime.fromisoformat(t.get("uploadedAt", "")).timestamp())
                except Exception:
                    pub = -1
                all_results.append({
                    "link": t.get("torrentMagnet", ""),
                    "name": t.get("name", ""),
                    "size": str(t.get("size", 0)),
                    "seeds": int(t.get("seeders", 0)),
                    "leech": int(t.get("leechers", 0)),
                    "engine_url": self.url,
                    "desc_link": desc,
                    "pub_date": pub,
                })
            if resp.get("next") is None:
                break
            params["offset"] += params["limit"]
        return all_results


# ---------------------------------------------------------------------------
# TorLock (HTML scraping)
# ---------------------------------------------------------------------------

class TorLock:
    name = "TorLock"
    url = "https://www.torlock.com"
    supported_categories = {
        "all": "all", "anime": "anime", "software": "software",
        "games": "game", "movies": "movie", "music": "music",
        "tv": "television", "books": "ebooks",
    }

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        category = self.supported_categories.get(cat, "all")
        q = query.replace("%20", "-").replace(" ", "-")
        all_results: List[TorrentResult] = []
        for page in range(1, 4):
            url = f"{self.url}/{category}/torrents/{q}.html?sort=seeds&page={page}"
            html = retrieve_url(url)
            if not html:
                break
            parser = _TorLockParser(self.url)
            parser.feed(html)
            parser.close()
            all_results.extend(parser.results)
            if len(parser.results) < 20:
                break
        return all_results


class _TorLockParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._in_article = False
        self._item_found = False
        self._item_bad = False
        self._item: Dict[str, Any] = {}
        self._item_name: Optional[str] = None
        self._class_map = {"td": "pub_date", "ts": "size", "tul": "seeds", "tdl": "leech"}
        self._now = datetime.datetime.now()

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        if self._item_found and tag == "td":
            cls = p.get("class", "")
            if cls:
                mapped = self._class_map.get(cls)
                if mapped:
                    self._item_name = mapped
                    self._item[mapped] = ""
        elif self._in_article and tag == "a":
            href = p.get("href")
            if href and href.startswith("/torrent"):
                self._item["desc_link"] = self.base_url + href
                parts = href.split("/")
                tid = parts[2] if len(parts) > 2 else ""
                self._item["link"] = self.base_url + "/tor/" + tid + ".torrent"
                self._item["engine_url"] = self.base_url
                self._item_found = True
                self._item_name = "name"
                self._item["name"] = ""
                self._item_bad = p.get("rel") == "nofollow"
        elif tag == "article":
            self._in_article = True
            self._item = {}

    def handle_data(self, data: str):
        if self._item_name:
            self._item[self._item_name] = self._item.get(self._item_name, "") + data

    def handle_endtag(self, tag: str):
        if tag == "article":
            self._in_article = False
        elif self._item_name and tag in ("a", "td"):
            self._item_name = None
        elif self._item_found and tag == "tr":
            self._item_found = False
            if not self._item_bad:
                try:
                    pd = self._item.get("pub_date", "")
                    if pd == "Today":
                        dt = self._now
                    elif pd == "Yesterday":
                        dt = self._now - datetime.timedelta(days=1)
                    else:
                        dt = datetime.datetime.strptime(pd, "%m/%d/%Y")
                    self._item["pub_date"] = int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
                except Exception:
                    self._item["pub_date"] = -1
                if self._item.get("name"):
                    self.results.append(self._item.copy())  # type: ignore
            self._item = {}


# ---------------------------------------------------------------------------
# TheRarBg (HTML scraping)
# ---------------------------------------------------------------------------

class TheRarBg:
    name = "TheRarBg"
    url = "https://therarbg.com"
    supported_categories = {
        "all": "All", "movies": "Movies", "tv": "TV", "music": "Music",
        "games": "Games", "anime": "Anime", "software": "Apps",
    }

    def search(self, query: str, cat: str = "all") -> List[TorrentResult]:
        category = self.supported_categories.get(cat, "All")
        # Phase 1: parse listing pages (fast, no magnet yet)
        candidates: List[TorrentResult] = []
        deadline = time.time() + 20  # hard cap so the engine never exceeds ~20s
        for page in range(1, 3):  # 2 pages max (was 3)
            if time.time() >= deadline:
                break
            if category == "All":
                url = f"{self.url}/get-posts/order:-se:keywords:{query}/?page={page}"
            else:
                url = f"{self.url}/get-posts/order:-se:category:{category}:keywords:{query}/?page={page}"
            html = retrieve_url(url, timeout=8)
            if not html:
                break
            parser = _TheRarBgListParser(self.url)
            parser.feed(html)
            parser.close()
            candidates.extend(parser.results)
            if not re.search(r'<a.*?>&raquo;</a>', html):
                break
        if not candidates:
            return []

        # Cap candidates to keep magnet-fetch phase bounded
        candidates = candidates[:30]

        # Phase 2: fetch magnet links concurrently (short per-request timeout)
        def _fetch_magnet(item: TorrentResult) -> TorrentResult:
            if time.time() >= deadline:
                return item
            detail_url = item.get("desc_link", "")
            if not detail_url:
                return item
            try:
                page_html = retrieve_url(detail_url, timeout=6)
            except Exception:
                page_html = ""
            if page_html:
                m = re.search(r'href=["\']?(magnet:[^"\'>\s]+)', page_html)
                if m:
                    item["link"] = html_mod.unescape(m.group(1))
                # Fallback poster from detail page (og:image or meta property)
                if not item.get("poster"):
                    pm = re.search(
                        r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']',
                        page_html, re.I,
                    ) or re.search(
                        r'content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\']',
                        page_html, re.I,
                    )
                    if pm:
                        src = pm.group(1)
                        if src.startswith("//"):
                            src = "https:" + src
                        item["poster"] = src
            return item

        with ThreadPoolExecutor(max_workers=min(len(candidates), 8)) as pool:
            candidates = list(pool.map(_fetch_magnet, candidates))

        return [r for r in candidates if r.get("link")]


class _TheRarBgListParser(HTMLParser):
    """Parse listing page only — no magnet fetching."""

    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.results: List[TorrentResult] = []
        self._in_table = False
        self._in_tbody = False
        self._in_row = False
        self._in_cell = False
        self._col = 0
        self._item: Dict[str, Any] = {}
        self._parse_name = False
        self._parse_category = False
        self._parse_size = False
        self._parse_seeds = False
        self._parse_leech = False
        self._name_parsed = False
        self._poster_parsed = False

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Union[str, None]]]):
        p = dict(attrs)
        if tag == "table":
            self._in_table = True
        if tag == "tbody" and self._in_table:
            self._in_tbody = True
        if tag == "tr" and self._in_tbody:
            self._col = 0
            self._in_row = True
            self._item = {}
            self._name_parsed = False
            self._poster_parsed = False
        if tag == "td" and self._in_row:
            self._col += 1
            self._in_cell = True
        if self._in_cell:
            # Poster image usually in the first cell(s) of the row
            if tag == "img" and not self._poster_parsed:
                src = p.get("data-src") or p.get("data-original") or p.get("src")
                if src and not src.startswith("data:"):
                    if src.startswith("//"):
                        src = "https:" + src
                    elif src.startswith("/"):
                        src = self.base_url + src
                    self._item["poster"] = src
                    self._poster_parsed = True
            if self._col == 2 and tag == "a" and not self._name_parsed:
                href = p.get("href")
                if href:
                    self._item["desc_link"] = self.base_url + href
                self._parse_name = True
            if self._col == 3 and tag == "a":
                self._parse_category = True
            if self._col == 6:
                self._parse_size = True
            if self._col == 7:
                self._parse_seeds = True
            if self._col == 8:
                self._parse_leech = True

    def handle_data(self, data: str):
        if self._parse_name:
            self._item["name"] = data
            self._parse_name = False
            self._name_parsed = True
        if self._parse_category:
            self._item["name"] = self._item.get("name", "") + f" ({data.strip()})"
            self._parse_category = False
        if self._parse_size:
            self._item["size"] = data.replace(",", ".").replace("\xa0", " ")
            self._parse_size = False
        if self._parse_seeds:
            self._item["seeds"] = data.strip()
            self._parse_seeds = False
        if self._parse_leech:
            self._item["leech"] = data.strip()
            self._parse_leech = False

    def handle_endtag(self, tag: str):
        if tag == "td":
            self._in_cell = False
        if tag == "tr" and self._in_tbody:
            self._item["engine_url"] = self.base_url
            if self._item.get("name"):
                self.results.append(self._item.copy())  # type: ignore
            self._in_row = False


# ---------------------------------------------------------------------------
# Engine registry
# ---------------------------------------------------------------------------

ALL_ENGINES = {
    "therarbg": TheRarBg(),
    "piratebay": PirateBay(),
    "torrentscsv": TorrentsCSV(),
    "yts": YTS(),
    "solidtorrents": SolidTorrents(),
    "bitsearch": BitSearch(),
    "bt4gprx": BT4GPRX(),
    "eztv": EZTV(),
    "limetorrents": LimeTorrents(),
    "torrentproject": TorrentProject(),
    "torlock": TorLock(),
}


def search_all(query: str, engines: Optional[List[str]] = None, cat: str = "all") -> List[TorrentResult]:
    """Search multiple engines concurrently."""
    targets = engines or list(ALL_ENGINES.keys())
    results: List[TorrentResult] = []

    def _run(name: str) -> List[TorrentResult]:
        eng = ALL_ENGINES.get(name)
        if not eng:
            return []
        try:
            return eng.search(query, cat)
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=min(len(targets), 12)) as pool:
        futures = {pool.submit(_run, name): name for name in targets}
        for f in as_completed(futures):
            try:
                results.extend(f.result())
            except Exception:
                pass

    return results
