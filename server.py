"""
Tools Hub Server
Run: python server.py
Opens on http://localhost:8420
"""

import json
import logging
import os
import sqlite3
import sys
import time
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tools-hub")

PORT = 8420
HUB_ROOT = ROOT_DIR
INDEX_FILE = os.path.join(HUB_ROOT, "index.html")

# ── SQLite settings DB ──
DB_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "ToolsHub")
DB_PATH = os.path.join(DB_DIR, "config.db")


def _init_db():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings ("
        "  key TEXT PRIMARY KEY,"
        "  value TEXT NOT NULL,"
        "  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ")"
    )
    conn.commit()
    conn.close()


def _db_get(key: str):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row is None:
        return None
    try:
        return json.loads(row[0])
    except (json.JSONDecodeError, TypeError):
        return row[0]


def _db_get_all() -> dict:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    result = {}
    for key, value in rows:
        try:
            result[key] = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            result[key] = value
    return result


def _db_set(key: str, value: str):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        (key, value),
    )
    conn.commit()
    conn.close()


def _db_delete(key: str):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM settings WHERE key = ?", (key,))
    conn.commit()
    conn.close()


_init_db()


class HubHandler(SimpleHTTPRequestHandler):
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
        elif path == "/api/settings":
            self._handle_settings_get(parse_qs(parsed.query))
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
        if path == "/api/settings":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b""
            self._handle_settings_post(body)
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

    def _handle_settings_get(self, params: dict):
        key = params.get("key", [None])[0]
        if key:
            val = _db_get(key)
            if val is None:
                self._json_response(404, {"error": "not found"})
            else:
                self._json_response(200, {key: val})
        else:
            self._json_response(200, _db_get_all())

    def _handle_settings_post(self, body: bytes):
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            self._json_response(400, {"error": "Invalid JSON"})
            return
        key = data.get("key")
        value = data.get("value")
        if not key:
            self._json_response(400, {"error": "Missing 'key'"})
            return
        if value is None:
            _db_delete(key)
        else:
            _db_set(key, str(value))
        self._json_response(200, {"ok": True})

    def _json_response(self, code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

    def handle_error(self, request, client_address):
        import traceback
        tb = traceback.format_exc()
        if "10053" in tb or "ConnectionAbortedError" in tb or "BrokenPipeError" in tb:
            return
        super().handle_error(request, client_address)


WATCH_EXTS = {".py", ".html", ".css", ".js", ".json", ".svg"}
IGNORE = {".git", "__pycache__", "node_modules", ".claude"}


def file_snapshots():
    snaps = {}
    for f in ROOT_DIR.rglob("*"):
        if not f.is_file() or f.suffix not in WATCH_EXTS:
            continue
        if any(d in IGNORE for d in f.relative_to(ROOT_DIR).parts):
            continue
        try:
            snaps[f.relative_to(ROOT_DIR).as_posix()] = f.stat().st_mtime
        except OSError:
            pass
    return snaps


def watcher(stop_event):
    prev = file_snapshots()
    while not stop_event.is_set():
        time.sleep(1)
        curr = file_snapshots()
        changed = [p for p in set(curr) | set(prev) if curr.get(p) != prev.get(p)]
        if changed:
            print(f"  [reload] {', '.join(changed)}")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        prev = curr


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), HubHandler)
    print(f"Tools Hub running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop.")
    if os.environ.get("TS_OPEN_BROWSER", "1") != "0":
        webbrowser.open(f"http://localhost:{PORT}")

    stop = threading.Event()
    t = threading.Thread(target=watcher, args=(stop,), daemon=True)
    t.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
