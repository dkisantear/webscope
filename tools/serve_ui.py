"""Serve ui/ from the laptop with caching turned off, so every refresh shows your latest edits.
Run from the repo root:  python tools/serve_ui.py   (optional: a port, default 8000)

Live data without reflashing the ESP32: join the WebScope Wi-Fi, then open
http://localhost:8000/?esp=192.168.4.1"""
import functools
import http.server
import sys
from pathlib import Path

UI = Path(__file__).resolve().parent.parent / "ui"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(NoCacheHandler, directory=str(UI))
print(f"WebScope UI: http://localhost:{PORT}   (live board: http://localhost:{PORT}/?esp=192.168.4.1)")
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
