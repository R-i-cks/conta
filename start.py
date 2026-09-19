#!/usr/bin/env python3
"""Launch Conta locally with Python's standard library; Ctrl+C stops the server."""
import argparse
import errno
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
PORT = 4173
URL = f"http://localhost:{PORT}"
ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
PUBLIC_FILES = {"index.html", "styles.css", "app.mjs", "core.mjs", "payroll.mjs", "loans.mjs", "planning.mjs", "investments.mjs",
                "dm-sans-variable-latin.woff2", "manrope-variable-latin.woff2"}
DATA_FILE = ROOT / "conta-data.json"
HISTORY_DIR = ROOT / "history"
HISTORY_KEEP = 30
MAX_BODY = 20 * 1024 * 1024
DATA_LOCK = threading.Lock()


def read_data():
    """Return (bytes, etag), or (None, None) before the first save."""
    try:
        body = DATA_FILE.read_bytes()
    except FileNotFoundError:
        return None, None
    return body, hashlib.sha256(body).hexdigest()[:32]


def write_data(body):
    """Replace the workspace atomically, keeping the previous copy."""
    HISTORY_DIR.mkdir(exist_ok=True)
    if DATA_FILE.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        DATA_FILE.replace(HISTORY_DIR / f"conta-{stamp}.json")
        old = sorted(HISTORY_DIR.glob("conta-*.json"))
        for stale in old[:-HISTORY_KEEP]:
            stale.unlink(missing_ok=True)
    # Same directory as the target: os.replace is only atomic within one filesystem.
    handle, temp = tempfile.mkstemp(dir=DATA_FILE.parent, prefix=".conta-", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, DATA_FILE)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise
    return hashlib.sha256(body).hexdigest()[:32]


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".woff2": "font/woff2"}

    def allowed_host(self):
        """Refuse hostnames that resolve here from elsewhere, such as DNS rebinding."""
        if self.headers.get("Host") in ALLOWED_HOSTS:
            return True
        self.send_error(421, "Conta only answers on http://localhost:4173")
        return False

    def do_HEAD(self):
        if self.allowed_host():
            super().do_HEAD()

    def respond(self, status, body=b"", content_type="application/json", headers=()):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self):
        """Only the page itself may write. A cross-site form cannot send PUT with
        a JSON content type, and a cross-origin fetch is stopped by the preflight
        this server never answers; Sec-Fetch-Site closes the gap in older cases."""
        site = self.headers.get("Sec-Fetch-Site")
        origin = self.headers.get("Origin")
        if site is not None and site not in ("same-origin", "none"):
            return False
        if origin is not None and origin not in (f"http://{h}" for h in ALLOWED_HOSTS):
            return False
        return self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"

    def do_PUT(self):
        if not self.allowed_host():
            return
        if self.path.split("?", 1)[0] != "/data":
            self.send_error(404, "Not found")
            return
        if not self.same_origin():
            self.send_error(403, "Conta only accepts writes from its own page")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.send_error(413, "Workspace is too large to save")
            return
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except ValueError:
            self.send_error(400, "Workspace must be JSON")
            return
        with DATA_LOCK:
            _, current = read_data()
            expected = self.headers.get("If-Match")
            # "*" means "only if nothing is saved yet"; a stale tag means another
            # tab or window has saved since this one last read.
            if expected != ("*" if current is None else current):
                self.respond(409, json.dumps({"etag": current}).encode(),
                             headers=(("ETag", current or ""),))
                return
            etag = write_data(body)
        self.respond(200, json.dumps({"etag": etag}).encode(),
                     headers=(("ETag", etag),))

    def do_GET(self):
        if not self.allowed_host():
            return
        if self.path.split("?", 1)[0] == "/data":
            body, etag = read_data()
            if body is None:
                self.respond(404, b'{"error":"no workspace saved yet"}')
            else:
                self.respond(200, body, headers=(("ETag", etag),))
            return
        if self.path.split("?", 1)[0] == "/health":
            body = b"conta-local-v3"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def translate_path(self, path):
        name = path.split("?", 1)[0].lstrip("/") or "index.html"
        return str(ROOT / (name if name in PUBLIC_FILES else "__not_public__"))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    global PORT, URL, ALLOWED_HOSTS, DATA_FILE, HISTORY_DIR
    parser = argparse.ArgumentParser(description="Launch Conta locally")
    parser.add_argument("--no-browser", action="store_true", help="Start without opening a browser")
    parser.add_argument("--port", type=int, default=PORT, help="Serve on a different port")
    parser.add_argument("--data", type=Path, help="Use a different workspace file (for tests)")
    args = parser.parse_args()
    PORT = args.port
    URL = f"http://localhost:{PORT}"
    ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
    if args.data:
        DATA_FILE = args.data.resolve()
        HISTORY_DIR = DATA_FILE.parent / "history"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(AppHandler, directory=str(ROOT)))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        try:
            with urllib.request.urlopen(URL, timeout=2) as response:
                is_conta = b'<title>Conta' in response.read(20000)
        except OSError:
            is_conta = False
        if not is_conta:
            parser.exit(1, f"Port {PORT} is in use by another application. Stop it before launching Conta.\n")
        print(f"Conta is already running at {URL}", flush=True)
        if not args.no_browser:
            webbrowser.open(URL)
        return
    print(f"Conta is running at {URL}\nKeep this terminal open. Press Ctrl+C to stop.\nUse this same URL and browser profile to keep your saved data.", flush=True)
    if not args.no_browser:
        timer = threading.Timer(0.3, webbrowser.open, args=(URL,))
        timer.daemon = True
        timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nConta stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
