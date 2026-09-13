"""
Torrent Search Server
Run: python server.py
Opens on http://localhost:8420
"""

import json
import logging
import os
import shutil
import sys
import subprocess
import time
import webbrowser
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote as url_quote
from typing import List
from concurrent.futures import ThreadPoolExecutor, as_completed
from engines import ALL_ENGINES

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("torrent-search")

PORT = 8420
HUB_ROOT = ROOT_DIR
INDEX_FILE = os.path.join(HUB_ROOT, "index.html")
TORRENT_FILE = os.path.join(HUB_ROOT, "page", "Torrent-Search.html")

# TMDB (read access token v4). Override via env TMDB_TOKEN if needed.
TMDB_TOKEN = os.environ.get(
    "TMDB_TOKEN",
    "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmM2VmNDNlYzY3MTc0YzYwNDk3NDE5MjcxNDljNzJhOCIsIm5iZiI6MTc0MzU2MTUzMS42OCwic3ViIjoiNjdlY2EzM2JiOTQyNGNkODk1YWFkYmNmIiwic2NvcGVzIjpbImFwaV9yZWFkIl0sInZlcnNpb24iOjF9._sJyNsBHNMvSPhoCQfb99FmLveDFdRLAOB67k08_ye8",
)
TMDB_API = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w500"


def _normalize_tmdb_images(item: dict) -> None:
    """Add absolute *_url fields for poster/backdrop paths on a TMDB item."""
    if not isinstance(item, dict):
        return
    if item.get("poster_path") and not item.get("poster_url"):
        item["poster_url"] = TMDB_IMG + item["poster_path"]
    if item.get("backdrop_path") and not item.get("backdrop_url"):
        item["backdrop_url"] = "https://image.tmdb.org/t/p/w780" + item["backdrop_path"]


class TorrentHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        try:
            self._do_GET()
        except (ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def _do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "" or path == "/index.html":
            self._serve_file(INDEX_FILE)
        elif path == "/page/torrent-search" or path == "/page/Torrent-Search.html":
            self._serve_file(TORRENT_FILE)
        elif path == "/api/search":
            self._handle_search(parse_qs(parsed.query))
        elif path == "/api/engines":
            self._handle_engines()
        elif path == "/api/torrserver":
            self._proxy_torrserver(parse_qs(parsed.query))
        elif path == "/api/play":
            self._launch_mpv(parse_qs(parsed.query))
        elif path == "/api/tmdb":
            self._proxy_tmdb(parse_qs(parsed.query))
        else:
            self._serve_static(path)

    def do_POST(self):
        try:
            self._do_POST()
        except (ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def _do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path == "/api/torrserver":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            self._proxy_torrserver_post(parse_qs(parsed.query), body)
        else:
            self.send_error(404)

    def _serve_file(self, filepath):
        try:
            with open(filepath, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            self.send_error(404)
            return
        ext = os.path.splitext(filepath)[1].lower()
        ct = self.MIME.get(ext, "text/html" if ext == ".html" else "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ct + ("; charset=utf-8" if ct.startswith("text/") else ""))
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    # MIME types for static files
    MIME = {
        ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
        ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
        ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
        ".ttf": "font/ttf", ".ico": "image/x-icon",
    }

    def _serve_static(self, path):
        """Serve static files from hub root."""
        safe = path.lstrip("/")
        if ".." in safe:
            self.send_error(403)
            return
        fp = os.path.normpath(os.path.join(HUB_ROOT, safe))
        if fp.startswith(HUB_ROOT) and os.path.isfile(fp):
            ext = os.path.splitext(fp)[1].lower()
            ct = self.MIME.get(ext, "application/octet-stream")
            with open(fp, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", len(data))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(404)

    def _handle_search(self, params: dict):
        query = params.get("q", [""])[0]
        if not query:
            self._json_response(400, {"error": "Missing query parameter 'q'"})
            return

        engines_param = params.get("engines", [""])[0]
        cat = params.get("cat", ["all"])[0]
        targets = [e.strip() for e in engines_param.split(",") if e.strip()] if engines_param else list(ALL_ENGINES.keys())

        log.info(f"Search: q={query!r} cat={cat} engines={targets}")

        # SSE response
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        def _send(event: str, data: dict):
            payload = json.dumps(data, ensure_ascii=False)
            self.wfile.write(f"event: {event}\ndata: {payload}\n\n".encode("utf-8"))
            self.wfile.flush()

        def _run(name: str):
            eng = ALL_ENGINES.get(name)
            if not eng:
                return name, []
            t0 = time.time()
            try:
                res = eng.search(query, cat)
                elapsed = time.time() - t0
                log.info(f"  {name}: {len(res)} results in {elapsed:.1f}s")
                return name, res
            except Exception as e:
                elapsed = time.time() - t0
                log.error(f"  {name}: ERROR after {elapsed:.1f}s - {e}")
                return name, []

        total = 0
        import random

        def _emit_results(name, res):
            nonlocal total
            # Sort by seeds desc (handle string seeds from some engines)
            res.sort(key=lambda x: int(x.get("seeds", 0) or 0), reverse=True)
            total += len(res)
            _send("engine_done", {"engine": name, "count": len(res)})
            for r in res:
                r["engine"] = name
                _send("result", r)
                time.sleep(random.uniform(0.02, 0.08))

        # Priority engines run & stream first (RARBG), then the rest in parallel.
        PRIORITY = ["therarbg"]
        first_batch = [n for n in PRIORITY if n in targets]
        rest = [n for n in targets if n not in PRIORITY]

        for n in first_batch:
            name, res = _run(n)
            _emit_results(name, res)

        with ThreadPoolExecutor(max_workers=min(len(rest), 12)) as pool:
            futures = {pool.submit(_run, n): n for n in rest}
            for f in as_completed(futures):
                try:
                    name, res = f.result()
                    _emit_results(name, res)
                except Exception as e:
                    log.error(f"  Future error: {e}")

        _send("done", {"total": total})
        log.info(f"Total: {total} results")

    def _launch_mpv(self, params: dict):
        """Launch MPV with a TorrServer stream. Decodes all audio codecs (AC3/DTS)
        and renders embedded subtitles (SSA/PGS) natively — fixing the no-audio /
        no-subtitle issue with the browser <video> element."""
        info_hash = params.get("hash", [""])[0]
        magnet = params.get("link", [""])[0]
        if not info_hash and magnet:
            import re
            m = re.search(r"btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{32})", magnet)
            if m:
                info_hash = m.group(1).lower()
        if not info_hash:
            self._json_response(400, {"error": "Missing 'hash' or 'link' parameter"})
            return

        base = params.get("base", ["http://127.0.0.1:8090"])[0].rstrip("/")
        title = params.get("title", [""])[0]
        # Prefer second audio track for dual-audio releases, show first subtitle
        audio_id = params.get("aid", [""])[0]
        sub_id = params.get("sid", [""])[0]

        mpv = shutil.which("mpv") or os.environ.get("MPV_PATH") or "mpv"
        stream_url = f"{base}/stream/?link={info_hash}&play"
        args = [mpv, f"--title={title or 'TorrStream'}", "--force-window=immediate"]
        if audio_id:
            args.append(f"--aid={audio_id}")
        if sub_id:
            args.append(f"--sid={sub_id}")
        args.append(stream_url)

        log.info(f"Launching MPV: {' '.join(args)}")
        try:
            # Detach MPV so it keeps running independent of the server process
            kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            if sys.platform == "win32":
                kwargs["creationflags"] = (
                    subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
                )
            else:
                kwargs["start_new_session"] = True
            subprocess.Popen(args, **kwargs)
            self._json_response(200, {"ok": True, "player": "mpv"})
        except FileNotFoundError:
            self._json_response(502, {"error": "mpv not found. Install MPV or set MPV_PATH env."})
        except Exception as e:
            self._json_response(502, {"error": str(e)})

    def _handle_engines(self):
        info = {}
        for key, eng in ALL_ENGINES.items():
            info[key] = {
                "name": eng.name,
                "url": eng.url,
                "categories": list(eng.supported_categories.keys()),
            }
        self._json_response(200, info)

    def _proxy_tmdb(self, params: dict):
        """Proxy TMDB v3 API: ?path=/trending/movie/week
        Keeps the API token server-side. Normalizes image paths to absolute URLs."""
        path = params.get("path", ["/trending/movie/week"])[0]
        if not path.startswith("/"):
            path = "/" + path
        # Disallow escaping the TMDB host
        if ".." in path or "://" in path:
            self._json_response(400, {"error": "Invalid path"})
            return
        url = f"{TMDB_API}{path}?language=en-US"
        # Forward optional extra query params (page, append_to_response, query, etc.)
        for k in ("page", "append_to_response", "query"):
            if k in params:
                url += f"&{k}={url_quote(params[k][0], safe='')}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {TMDB_TOKEN}")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            self._json_response(e.code, {"error": f"TMDB HTTP {e.code}"})
            return
        except Exception as e:
            self._json_response(502, {"error": str(e)})
            return
        # Normalize poster/backdrop/profile paths to absolute URLs
        for item in data.get("results", []) or []:
            _normalize_tmdb_images(item)
        # Single-item detail response (movie/tv + credits)
        _normalize_tmdb_images(data)
        if isinstance(data.get("credits"), dict):
            for c in data["credits"].get("cast", []) or []:
                if c.get("profile_path"):
                    c["profile_url"] = "https://image.tmdb.org/t/p/w185" + c["profile_path"]
        # Person endpoint: normalize movie_credits cast posters
        if isinstance(data.get("movie_credits"), dict):
            for m in data["movie_credits"].get("cast", []) or []:
                _normalize_tmdb_images(m)
        self._json_response(200, data)

    def _json_response(self, code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _proxy_torrserver(self, params: dict):
        base = params.get("base", ["http://127.0.0.1:8090"])[0].rstrip("/")
        path = params.get("path", ["/torrents"])[0]
        url = f"{base}{path}"
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                ct = resp.headers.get("Content-Type", "application/json")
                cl = resp.headers.get("Content-Length")
                self.send_response(200)
                self.send_header("Content-Type", ct)
                if cl:
                    self.send_header("Content-Length", cl)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                # Stream chunks (for video or large responses)
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.URLError as e:
            self._json_response(502, {"error": str(e)})
        except Exception as e:
            self._json_response(502, {"error": str(e)})

    def _proxy_torrserver_post(self, params: dict, body: bytes):
        base = params.get("base", ["http://127.0.0.1:8090"])[0].rstrip("/")
        path = params.get("path", ["/torrents"])[0]
        url = f"{base}{path}"
        try:
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", len(data))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.URLError as e:
            self._json_response(502, {"error": str(e)})
        except Exception as e:
            self._json_response(502, {"error": str(e)})

    def log_message(self, format, *args):
        pass

    def handle_error(self, request, client_address):
        import traceback
        tb = traceback.format_exc()
        if "10053" in tb or "ConnectionAbortedError" in tb or "BrokenPipeError" in tb:
            return
        super().handle_error(request, client_address)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), TorrentHandler)
    print(f"Torrent Search running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")
    if os.environ.get("TS_OPEN_BROWSER", "1") != "0":
        webbrowser.open(f"http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
