#!/usr/bin/env python3
"""Launch Conta locally with Python's standard library; Ctrl+C stops the server."""
import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://localhost:4173"
ALLOWED_HOSTS = {"localhost:4173", "127.0.0.1:4173"}
PUBLIC_FILES = {"index.html", "styles.css", "app.mjs", "core.mjs", "payroll.mjs", "loans.mjs", "planning.mjs", "investments.mjs",
                "dm-sans-variable-latin.woff2", "manrope-variable-latin.woff2"}


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

    def do_GET(self):
        if not self.allowed_host():
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
    parser = argparse.ArgumentParser(description="Launch Conta at http://localhost:4173")
    parser.add_argument("--no-browser", action="store_true", help="Start without opening a browser")
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 4173), partial(AppHandler, directory=str(ROOT)))
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        try:
            with urllib.request.urlopen(URL, timeout=2) as response:
                is_conta = b'<title>Conta' in response.read(20000)
        except OSError:
            is_conta = False
        if not is_conta:
            parser.exit(1, "Port 4173 is in use by another application. Stop it before launching Conta.\n")
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
