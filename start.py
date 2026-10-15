#!/usr/bin/env python3
"""Launch Conta locally with Python's standard library; Ctrl+C stops the server."""
import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent
PORT = 4173
URL = f"http://localhost:{PORT}"
ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
PUBLIC_FILES = {"index.html", "styles.css", "app.mjs", "core.mjs", "payroll.mjs", "loans.mjs", "planning.mjs", "investments.mjs", "statement.mjs", "stocks.mjs",
                "dm-sans-variable-latin.woff2", "manrope-variable-latin.woff2"}
DATA_FILE = ROOT / "conta-data.json"
HISTORY_DIR = ROOT / "history"
HISTORY_KEEP = 30
MAX_BODY = 20 * 1024 * 1024
MAX_PDF = 10 * 1024 * 1024
MAX_PDF_TEXT = 4 * 1024 * 1024
DATA_LOCK = threading.Lock()
QUOTE_SYMBOL = re.compile(r"^[A-Z0-9.^=-]{1,20}$", re.I)


def market_quote(symbol):
    request = urllib.request.Request(
        f"https://query2.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?range=5d&interval=1d",
        headers={"User-Agent": "Mozilla/5.0 Conta/1.0"})
    with urllib.request.urlopen(request, timeout=8) as response:
        result = json.load(response)["chart"]["result"][0]
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    timestamp = meta.get("regularMarketTime")
    if not isinstance(price, (int, float)) or price < 0 or not timestamp:
        raise ValueError("No current quote")
    return {"price": price, "currency": meta.get("currency"),
            "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()}


# Fundamentals need Yahoo's session cookie plus a crumb; the chart endpoint does not.
YAHOO = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 Conta/1.0"}
CRUMB = {"value": None}
STOCK_CACHE = {}
STOCK_CACHE_SECONDS = 15 * 60
STOCK_LOCK = threading.Lock()


def yahoo_json(url):
    with YAHOO.open(urllib.request.Request(url, headers=YAHOO_HEADERS), timeout=10) as response:
        return json.load(response)


def yahoo_crumb(refresh=False):
    if refresh or not CRUMB["value"]:
        try:
            YAHOO.open(urllib.request.Request("https://fc.yahoo.com", headers=YAHOO_HEADERS), timeout=10).close()
        except urllib.error.HTTPError:
            pass  # the 404 still sets the session cookie
        with YAHOO.open(urllib.request.Request("https://query2.finance.yahoo.com/v1/test/getcrumb", headers=YAHOO_HEADERS), timeout=10) as response:
            CRUMB["value"] = response.read().decode()
    return CRUMB["value"]


def unwrap_raw(value):
    """Yahoo wraps numbers as {"raw": 1.5, "fmt": "1.50"}; keep only the raw values."""
    if isinstance(value, dict):
        return value.get("raw") if "raw" in value else {key: unwrap_raw(item) for key, item in value.items() if key != "maxAge"}
    if isinstance(value, list):
        return [unwrap_raw(item) for item in value]
    return value


def shape_stock(chart, summary):
    """Daily series from the chart response plus optional unwrapped fundamentals."""
    result = chart["chart"]["result"][0]
    meta, quote = result["meta"], result["indicators"]["quote"][0]
    adjusted = result["indicators"].get("adjclose", [{}])[0].get("adjclose") or quote["close"]
    # Mixing adjusted and raw closes in one series invents moves; use raw throughout when any adjusted is missing.
    if any(adj is None for adj, close in zip(adjusted, quote["close"]) if close is not None):
        adjusted = quote["close"]
    period = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    live_bar = bool(period.get("end")) and time.time() < period["end"] and result["timestamp"][-1] >= period.get("start", 0)
    offset = meta.get("gmtoffset", 0)
    rows = [(datetime.fromtimestamp(stamp + offset, timezone.utc).date().isoformat(), close, adj, high, low, volume, open_)
            for stamp, close, adj, high, low, volume, open_ in zip(result["timestamp"], quote["close"], adjusted, quote["high"], quote["low"], quote["volume"], quote.get("open") or quote["close"])
            if close is not None]
    if not rows:
        raise ValueError("No price history")
    price = meta.get("regularMarketPrice")
    if not isinstance(price, (int, float)):
        raise ValueError("No current quote")
    fundamentals = unwrap_raw(summary["quoteSummary"]["result"][0]) if summary else None
    return {"symbol": meta["symbol"], "name": meta.get("longName") or meta.get("shortName") or meta["symbol"], "currency": meta.get("currency"),
            "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"), "type": meta.get("instrumentType"), "price": price,
            "previousClose": meta.get("chartPreviousClose") if len(rows) < 2 else rows[-2][1],
            "updated": datetime.fromtimestamp(meta["regularMarketTime"] + offset, timezone.utc).date().isoformat() if meta.get("regularMarketTime") else rows[-1][0],
            "dates": [r[0] for r in rows], "closes": [r[1] for r in rows], "adjusted": [r[1] if r[2] is None else r[2] for r in rows],
            "highs": [r[1] if r[3] is None else r[3] for r in rows], "lows": [r[1] if r[4] is None else r[4] for r in rows], "volumes": [r[5] or 0 for r in rows],
            "opens": [r[1] if r[6] is None else r[6] for r in rows], "liveBar": live_bar, "fundamentals": fundamentals}


def stock_report(symbol):
    with STOCK_LOCK:
        cached = STOCK_CACHE.get(symbol)
        if cached and cached[0] > time.monotonic():
            return cached[1]
    chart = yahoo_json(f"https://query2.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?range=2y&interval=1d")
    summary = None
    modules = "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,recommendationTrend"
    for attempt in range(2):  # a stale crumb answers 401 once; fundamentals stay optional
        try:
            crumb = yahoo_crumb(refresh=attempt > 0)
            summary = yahoo_json(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{quote(symbol)}?modules={modules}&crumb={quote(crumb)}")
            break
        except Exception:
            summary = None
    report = shape_stock(chart, summary)
    with STOCK_LOCK:
        STOCK_CACHE[symbol] = (time.monotonic() + STOCK_CACHE_SECONDS, report)
    return report


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


def pdf_to_text(source):
    """Capture at most 4 MB of text and 16 KB of errors from pdftotext."""
    process = subprocess.Popen(["pdftotext", "-layout", "-nopgbrk", "-enc", "UTF-8",
                                str(source), "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    parts = {}
    overflow = threading.Event()

    def read_bounded(name, pipe, limit):
        chunks, remaining = [], limit + 1
        while remaining:
            chunk = pipe.read(min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        parts[name] = b"".join(chunks)
        if remaining == 0 and name == "text":
            overflow.set()
        # Noisy font warnings are not a failure: keep draining so pdftotext never blocks on a full pipe.
        while remaining == 0 and pipe.read(65536):
            pass

    readers = [threading.Thread(target=read_bounded, args=("text", process.stdout, MAX_PDF_TEXT), daemon=True),
               threading.Thread(target=read_bounded, args=("error", process.stderr, 16384), daemon=True)]
    for reader in readers:
        reader.start()
    deadline = time.monotonic() + 15
    while process.poll() is None and not overflow.is_set() and time.monotonic() < deadline:
        time.sleep(.02)
    timed_out = process.poll() is None and not overflow.is_set()
    if process.poll() is None:
        process.kill()
    process.wait()
    for reader in readers:
        reader.join()
    return process.returncode, parts["text"], parts["error"], len(parts["text"]) > MAX_PDF_TEXT, timed_out


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

    def same_origin(self, content_type="application/json"):
        """Only the page itself may write. A cross-site form cannot send PUT with
        a JSON content type, and a cross-origin fetch is stopped by the preflight
        this server never answers; Sec-Fetch-Site closes the gap in older cases."""
        site = self.headers.get("Sec-Fetch-Site")
        origin = self.headers.get("Origin")
        if site is not None and site not in ("same-origin", "none"):
            return False
        if origin is not None and origin not in (f"http://{h}" for h in ALLOWED_HOSTS):
            return False
        return self.headers.get("Content-Type", "").split(";")[0].strip() == content_type

    def do_POST(self):
        if not self.allowed_host():
            return
        if urlsplit(self.path).path != "/pdf-text":
            self.send_error(404, "Not found")
            return
        if not self.same_origin("application/pdf"):
            self.send_error(403, "Conta only accepts PDFs from its own page")
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if length < 1 or length > MAX_PDF:
            self.respond(413, b'{"error":"PDF must be smaller than 10 MB."}')
            return
        self.connection.settimeout(15)
        try:
            body = self.rfile.read(length)
        except TimeoutError:
            self.respond(408, b'{"error":"PDF upload timed out."}')
            return
        if len(body) != length or b"%PDF-" not in body[:1024]:
            self.respond(400, b'{"error":"Choose a valid PDF statement."}')
            return
        if not shutil.which("pdftotext"):
            self.respond(503, b'{"error":"PDF import needs pdftotext (Poppler) installed on this computer."}')
            return
        try:
            with tempfile.TemporaryDirectory(prefix="conta-pdf-") as temp:
                source = Path(temp) / "statement.pdf"
                source.write_bytes(body)
                code, data, errors, oversized, timed_out = pdf_to_text(source)
                if timed_out:
                    self.respond(422, b'{"error":"PDF took too long to read."}')
                    return
                if code or oversized:
                    detail = errors.decode("utf-8", "replace").lower()
                    if "password" in detail or "encrypt" in detail:
                        message = "This PDF is encrypted. Export an unlocked statement."
                    elif oversized:
                        message = "Statement text is too large to import."
                    else:
                        message = "Could not read this PDF statement."
                    self.respond(422, json.dumps({"error": message}).encode())
                    return
        except OSError:
            self.respond(422, b'{"error":"Could not read this PDF statement."}')
            return
        text = data.decode("utf-8", "replace")
        if not text.strip():
            self.respond(422, b'{"error":"No selectable text found. This may be a scanned PDF; export a text-based statement."}')
            return
        self.respond(200, json.dumps({"text": text}).encode())

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
        parsed = urlsplit(self.path)
        if parsed.path in ("/quotes", "/stock"):
            site, origin = self.headers.get("Sec-Fetch-Site"), self.headers.get("Origin")
            if (site is not None and site not in ("same-origin", "none")) or (origin is not None and origin not in (f"http://{h}" for h in ALLOWED_HOSTS)):
                self.send_error(403, "Conta only fetches quotes for its own page")
                return
        if parsed.path == "/stock":
            symbol = parse_qs(parsed.query).get("symbol", [""])[0].strip().upper()
            if not QUOTE_SYMBOL.fullmatch(symbol):
                self.send_error(400, "Choose a valid market ticker")
                return
            try:
                self.respond(200, json.dumps(stock_report(symbol)).encode())
            except Exception:
                self.respond(502, b'{"error":"Market data is unavailable for this ticker right now."}')
            return
        if parsed.path == "/quotes":
            symbols = [value.strip().upper() for value in parse_qs(parsed.query).get("symbols", [""])[0].split(",") if value.strip()]
            if not symbols or len(symbols) > 25 or any(not QUOTE_SYMBOL.fullmatch(symbol) for symbol in symbols):
                self.send_error(400, "Choose up to 25 valid market tickers")
                return
            quotes, errors = {}, {}
            for symbol in dict.fromkeys(symbols):
                try:
                    quotes[symbol] = market_quote(symbol)
                except Exception:
                    errors[symbol] = "Quote unavailable"
            self.respond(200, json.dumps({"quotes": quotes, "errors": errors}).encode())
            return
        if parsed.path == "/data":
            body, etag = read_data()
            if body is None:
                self.respond(404, b'{"error":"no workspace saved yet"}')
            else:
                self.respond(200, body, headers=(("ETag", etag),))
            return
        if parsed.path == "/health":
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
    print(f"Conta is running at {URL}\nKeep this terminal open. Press Ctrl+C to stop.\nWorkspace: {DATA_FILE}", flush=True)
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
