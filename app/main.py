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

from server import Workspace, create_app, get_last_dir, remember_last_dir

APP_TITLE = "MD Flow Viewer"

MD_FILE_TYPES = ("Markdown (*.md;*.markdown)", "Tum dosyalar (*.*)")


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
    def __init__(self, port: int, workspace: Workspace) -> None:
        super().__init__(daemon=True)
        self._srv = make_server("127.0.0.1", port, create_app(workspace), threaded=True)

    def run(self) -> None:
        self._srv.serve_forever()

    def shutdown(self) -> None:
        try:
            self._srv.shutdown()
        except Exception:
            pass


class JsApi:
    """Arayüzün (public/app.js) çağırabildiği native köprü.

    Tarayıcıdan native dosya seçme penceresi açılamaz; üst bardaki "Dosya Aç"
    butonu bu API üzerinden pywebview'in kendi diyaloğunu açar.
    """

    def __init__(self, workspace: Workspace) -> None:
        self._ws = workspace
        # DİKKAT: pencere referansı '_' ile başlamalı. pywebview, js_api
        # nesnesinin public üyelerini JS'e aktarmak için gezer; Window nesnesi
        # public olursa window.native.AccessibilityObject... zincirinde sonsuz
        # döngüye girip "maximum recursion depth exceeded" ile köprüyü hiç
        # kurmaz (belirti: window.pywebview.api tanımsız).
        self._window: webview.Window | None = None

    def attach(self, window: webview.Window) -> None:
        self._window = window

    def open_file(self) -> str | None:
        """Dosya seçme penceresini son kullanılan klasörde açar.

        Seçim yapılırsa çalışma kökü o dosyanın klasörüne taşınır (kullanıcı
        açıkça seçti) ve yol arayüze döner; iptal edilirse None.
        """
        if self._window is None:
            return None

        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            directory=get_last_dir(),
            allow_multiple=False,
            file_types=MD_FILE_TYPES,
        )
        if not result:
            return None

        path = os.path.abspath(result[0])
        self._ws.rebase(path)
        remember_last_dir(path)
        return path


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
    workspace = Workspace()
    server = ServerThread(port, workspace)
    server.start()

    if not wait_health(port):
        sys.stderr.write("Sunucu başlatılamadı.\n")
        return 1

    url = f"http://127.0.0.1:{port}/"
    fp = file_arg()
    if fp:
        url += "?file=" + urllib.parse.quote(fp, safe="")

    api = JsApi(workspace)
    api.attach(webview.create_window(APP_TITLE, url=url, js_api=api,
                                     width=1280, height=860,
                                     min_size=(820, 560)))
    # Pencere kapanınca start() döner -> süreç biter (daemon server ölür).
    webview.start()
    server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
