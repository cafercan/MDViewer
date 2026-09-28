"""MD Flow Viewer - masaüstü giriş noktası.

Kendi penceresini açar (pywebview: Windows'ta WebView2, Linux'ta WebKitGTK). Flask backend'i 127.0.0.1'de
rastgele boş portta daemon thread olarak çalışır. Pencere kapanınca süreç
tamamen biter; arka planda sunucu kalmaz.
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

import webview
from werkzeug.serving import make_server

from server import (Workspace, clear_recent, create_app, get_last_dir,
                    get_recent, get_vault_path, remember_last_dir,
                    remember_recent, set_vault_path)

APP_TITLE = "MD Flow Viewer"

MD_FILE_TYPES = ("Markdown (*.md;*.markdown)", "Tum dosyalar (*.*)")

# Sistem tarayıcısına devredilebilecek şemalar; gerisi (file:, javascript: ...) reddedilir.
EXTERNAL_URL_RE = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)


def _startfile(path: str) -> None:
    """Dosyayı/klasörü kayıtlı varsayılan uygulamayla açar (testte monkeypatch edilir)."""
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606 - yalnızca kök içindeki, var olan dosya
        return
    # Linux: xdg-open (masaüstü ortamının varsayılanı), macOS: open.
    # Liste argümanı -> kabuk yok; yol tek argüman olarak geçer.
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen([opener, path], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


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
        return self._adopt_file(path)

    def open_file_path(self, path: str) -> str | None:
        """Son açılanlar listesinden seçilen dosyayı açar.

        Diyalogla açmakla aynı sonuç: çalışma kökü dosyanın klasörüne taşınır.
        Dosya silinmişse None döner ve liste bir sonraki okumada onu eler.
        """
        if not isinstance(path, str) or not os.path.isfile(path):
            return None
        return self._adopt_file(os.path.abspath(path))

    def _adopt_file(self, path: str) -> str:
        self._ws.rebase(path)
        remember_last_dir(path)
        remember_recent("file", path)
        return path

    # --- Çalışma alanı (klasör) ----------------------------------------------

    def open_folder(self) -> dict | None:
        """Klasör seçme penceresini açar; seçilen klasör çalışma alanı olur."""
        if self._window is None:
            return None

        recent = get_recent("folder")
        result = self._window.create_file_dialog(
            webview.FileDialog.FOLDER,
            directory=recent[0] if recent else get_last_dir(),
        )
        if not result:
            return None
        # pywebview sürümüne göre tek yol ya da tek elemanlı dizi döner.
        selected = result[0] if isinstance(result, (list, tuple)) else result
        return self.open_folder_path(selected)

    def open_folder_path(self, path: str) -> dict | None:
        """Verilen klasörü çalışma alanı yapar (son açılanlar listesi de buradan)."""
        if not isinstance(path, str) or not os.path.isdir(path):
            return None
        abs_dir = os.path.abspath(path)
        state = self._ws.open_workspace(abs_dir)
        if state["vault"]:
            set_vault_path(state["vault"])
        remember_recent("folder", abs_dir)
        return {"path": abs_dir, "state": state}

    # --- Son açılanlar --------------------------------------------------------

    def recent_list(self) -> dict:
        """Son açılan 10 dosya ve 10 klasör; silinmiş yollar elenmiş halde."""
        return {"files": get_recent("file"), "folders": get_recent("folder")}

    def clear_recent_list(self, kind: str) -> dict:
        if kind in ("file", "folder"):
            clear_recent(kind)
        return self.recent_list()

    # --- Gezgin sekmesi -------------------------------------------------------
    # Klasör gezinme ve vault sabitleme HTTP uçlarında DEĞİL burada: sayfa dışı
    # bir istemci kök hapsini genişletemesin. Dönen sözlükler JSON'a çevrilir.

    def explorer_state(self) -> dict:
        return self._ws.explorer_state()

    def list_dir(self, path: str) -> dict:
        return self._ws.list_dir(path)

    def explorer_up(self) -> dict:
        return self._ws.explorer_up()

    def explorer_enter(self, path: str) -> dict:
        return self._ws.explorer_enter(path)

    def set_vault(self, path: str | None) -> dict:
        state = self._ws.set_vault(path)
        set_vault_path(state["vault"])
        return state

    # --- Yazdırma / PDF --------------------------------------------------------

    def print_page(self) -> bool:
        """Linux (GTK): WebKit'in yazdırma diyaloğunu açar; PDF'e kaydet oradan.

        WebKitGTK'da window.print() sessizce yok sayılır (hata da vermez), bu
        yüzden diyalog WebKit2.PrintOperation ile Python tarafından açılır.
        Diğer platformlarda False döner ve arayüz window.print()'e düşer.
        """
        if self._window is None or not sys.platform.startswith("linux"):
            return False
        try:
            from gi.repository import GLib, WebKit2
            from webview.platforms.gtk import BrowserView
            view = BrowserView.instances[self._window.uid]
        except Exception:
            return False

        def run() -> bool:
            WebKit2.PrintOperation.new(view.webview).run_dialog(view.window)
            return False  # idle_add: tek sefer

        # GTK nesnelerine yalnızca ana döngüden dokunulur; köprü çağrısı ise
        # ayrı thread'de gelir.
        GLib.idle_add(run)
        return True

    # --- Belge içi bağlantılar ------------------------------------------------

    def open_external(self, url: str) -> bool:
        """http(s)/mailto bağlantısını sistem tarayıcısında açar.

        Pencere içinde gezinmek uygulamayı terk ettirirdi; file:/javascript:
        gibi şemalar ise güvenilmeyen bir belgeden gelebileceği için reddedilir.
        """
        if not isinstance(url, str) or not EXTERNAL_URL_RE.match(url.strip()):
            return False
        return bool(webbrowser.open(url.strip()))

    def resolve_wikilink(self, target: str, current_file: str | None) -> str | None:
        return self._ws.resolve_wikilink(target, current_file)

    def inspect_path(self, path: str) -> dict:
        return self._ws.inspect_path(path)

    def open_path(self, path: str) -> bool:
        """Yerel dosyayı (md dışı) varsayılan uygulamasında açar; kök dışı reddedilir."""
        return self._open_confined(path, os.path.isfile)

    def open_in_file_manager(self, path: str) -> bool:
        """Klasörü sistemin dosya yöneticisinde açar (Ctrl+tık); kök dışı reddedilir."""
        return self._open_confined(path, os.path.isdir)

    def _open_confined(self, path: str, predicate) -> bool:
        abs_path = self._ws.resolve_confined(path) if isinstance(path, str) else None
        if not abs_path or not predicate(abs_path):
            return False
        try:
            _startfile(abs_path)
        except OSError:
            return False
        return True


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


def set_linux_app_id() -> None:
    """GNOME/KDE pencereyi .desktop girişiyle eşleştirsin (dock ikonu, gruplama).

    GTK, Wayland app_id / X11 WM_CLASS değerini program adından alır; kaynaktan
    çalışınca bu "main.py" olur. mdflowviewer.desktop'taki StartupWMClass ile
    aynı ada çekiyoruz. GTK yoksa (ör. Qt arka ucu) sessizce geçilir.
    """
    if not sys.platform.startswith("linux"):
        return
    try:
        from gi.repository import GLib
    except Exception:
        return
    GLib.set_prgname("mdflowviewer")
    GLib.set_application_name(APP_TITLE)


def main() -> int:
    set_linux_app_id()
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
        workspace.ensure_root(fp)
        if os.path.isfile(fp):
            remember_recent("file", fp)

    # Gezgin kökü: sabitlenmiş vault varsa o; yoksa belge klasörü (Workspace
    # kendisi düşer). Dosyasız açılışta son kullanılan klasör ya da ev dizini.
    vault = get_vault_path()
    if vault:
        workspace.set_vault(vault)
    elif not fp:
        start_dir = get_last_dir() or os.path.expanduser("~")
        if os.path.isdir(start_dir):
            workspace.set_explorer_root(start_dir)

    api = JsApi(workspace)
    # text_select=True olmadan pywebview sayfaya
    # "body { user-select: none; cursor: default }" enjekte eder; belge metni
    # seçilemez ve Ctrl+C çalışmaz. Kabuk öğelerinin seçilmezliği CSS'te
    # ayrıca yönetiliyor (public/style.css, "METİN SEÇİMİ" bölümü).
    api.attach(webview.create_window(APP_TITLE, url=url, js_api=api,
                                     width=1280, height=860,
                                     min_size=(820, 560),
                                     text_select=True))
    # Pencere kapanınca start() döner -> süreç biter (daemon server ölür).
    webview.start()
    server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
