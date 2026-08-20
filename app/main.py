"""MD Flow Viewer - masaüstü giriş noktası.

Kendi penceresini açar (pywebview / WebView2). Flask backend'i 127.0.0.1'de
rastgele boş portta daemon thread olarak çalışır. Pencere kapanınca süreç
tamamen biter; arka planda sunucu kalmaz.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request

import webview
from werkzeug.serving import make_server

from server import create_app

APP_TITLE = "MD Flow Viewer"


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def file_arg() -> str | None:
    for a in sys.argv[1:]:
        if not a.startswith("--"):
            return os.path.abspath(a)
    return None


class ServerThread(threading.Thread):
    def __init__(self, port: int) -> None:
        super().__init__(daemon=True)
        self._srv = make_server("127.0.0.1", port, create_app(), threaded=True)

    def run(self) -> None:
        self._srv.serve_forever()

    def shutdown(self) -> None:
        try:
            self._srv.shutdown()
        except Exception:
            pass


def wait_health(port: int, timeout: float = 8.0) -> bool:
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as r:
                if r.status < 500:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


def main() -> int:
    port = free_port()
    server = ServerThread(port)
    server.start()

    if not wait_health(port):
        sys.stderr.write("Sunucu başlatılamadı.\n")
        return 1

    url = f"http://127.0.0.1:{port}/"
    fp = file_arg()
    if fp:
        url += "?file=" + urllib.parse.quote(fp, safe="")

    webview.create_window(APP_TITLE, url=url, width=1280, height=860,
                          min_size=(820, 560))
    # Pencere kapanınca start() döner -> süreç biter (daemon server ölür).
    webview.start()
    server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
