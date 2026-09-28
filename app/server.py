"""MD Flow Viewer - yerel HTTP backend (server.js'in Python karşılığı).

Yalnızca 127.0.0.1 dinler. Tüm dosya erişimi, açılan ilk belgenin klasörüne
(çalışma kökü) hapsedilir; dışarısı 403 döner. Uçlar server.js ile aynı sözleşme.
"""
from __future__ import annotations

import json
import mimetypes
import os
import sys
import time

from flask import Flask, Response, request, send_file, send_from_directory


def resource_dir(name: str) -> str:
    """PyInstaller ile paketlendiğinde gömülü kaynak klasörünü bulur."""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, name)
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), name)


PUBLIC_DIR = resource_dir("public")


def settings_path() -> str:
    """Ayar dosyası yolu. Port her açılışta değiştiği için localStorage kalıcı
    değil; ayarlar bu dosyada tutulur (kullanıcı bazlı, tüm örnekler paylaşır)."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        # Linux/macOS: XDG temel dizini (~/.config/MDFlowViewer/settings.json)
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, "MDFlowViewer")
    return os.path.join(d, "settings.json")


def load_settings_file() -> dict:
    try:
        with open(settings_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get_last_dir() -> str:
    """Dosya seçme penceresinin açılacağı klasör (en son açılan dosyanın yeri)."""
    d = load_settings_file().get("lastDir")
    return d if isinstance(d, str) and os.path.isdir(d) else ""


def remember_last_dir(file_path: str) -> None:
    """Açılan dosyanın klasörünü ayarlara yazar (değiştiyse)."""
    directory = os.path.dirname(os.path.abspath(file_path))
    if not os.path.isdir(directory):
        return
    settings = load_settings_file()
    if settings.get("lastDir") == directory:
        return
    settings["lastDir"] = directory
    try:
        save_settings_file(settings)
    except OSError:
        pass  # ayar yazılamazsa akışı bozmaya değmez


RECENT_LIMIT = 10

# Son açılanlar: dosyalar ve klasörler ayrı listelerde, en yenisi başta.
_RECENT_KEYS = {"file": "recentFiles", "folder": "recentFolders"}


def _recent_key(kind: str) -> str:
    try:
        return _RECENT_KEYS[kind]
    except KeyError:
        raise ValueError(f"bilinmeyen tür: {kind}") from None


def get_recent(kind: str) -> list[str]:
    """Son açılan dosya/klasör listesi. Diskte artık olmayan yollar elenir."""
    key = _recent_key(kind)
    exists = os.path.isfile if kind == "file" else os.path.isdir
    out: list[str] = []
    seen: set[str] = set()
    for item in load_settings_file().get(key, []) or []:
        if not isinstance(item, str) or not exists(item):
            continue
        low = os.path.normcase(item)
        if low in seen:
            continue
        seen.add(low)
        out.append(item)
        if len(out) >= RECENT_LIMIT:
            break
    return out


def remember_recent(kind: str, path: str) -> None:
    """Yolu listenin başına taşır; liste RECENT_LIMIT ile sınırlıdır."""
    key = _recent_key(kind)
    abs_path = os.path.abspath(path)
    settings = load_settings_file()
    current = [p for p in (settings.get(key) or []) if isinstance(p, str)]
    low = os.path.normcase(abs_path)
    updated = [abs_path] + [p for p in current if os.path.normcase(p) != low]
    settings[key] = updated[:RECENT_LIMIT]
    try:
        save_settings_file(settings)
    except OSError:
        pass  # ayar yazılamazsa akışı bozmaya değmez


def clear_recent(kind: str) -> None:
    settings = load_settings_file()
    settings.pop(_recent_key(kind), None)
    try:
        save_settings_file(settings)
    except OSError:
        pass


def get_vault_path() -> str:
    """Sabitlenmiş gezgin kökü (vault); yoksa veya klasör silinmişse boş."""
    d = load_settings_file().get("vaultPath")
    return d if isinstance(d, str) and os.path.isdir(d) else ""


def set_vault_path(directory: str | None) -> None:
    """Vault'u ayarlara yazar; None veya geçersiz klasör anahtarı siler."""
    settings = load_settings_file()
    if directory and os.path.isdir(directory):
        settings["vaultPath"] = os.path.abspath(directory)
    else:
        settings.pop("vaultPath", None)
    try:
        save_settings_file(settings)
    except OSError:
        pass


def save_settings_file(data: dict) -> None:
    p = settings_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

WELCOME_MD = """# MD Flow Viewer

Hoş geldiniz. Bir `.md` dosyasını **MD Flow Viewer ile Aç** diyerek açın; bu
pencere onu canlı olarak gösterir, düzenlemenize ve kaydetmenize izin verir.

- Sol tarafta otomatik **içindekiler**
- Sağ üstte **Oku / Düzenle**
- **Mermaid** diyagramları ve kod vurgulama
- Dosya diskte değişince **otomatik yenileme**
"""


MD_EXTENSIONS = (".md", ".markdown")


class Workspace:
    """Kök hapsi + gezgin (explorer) durumu.

    İki kök vardır; ikisi de HTTP uçlarından GENİŞLETİLEMEZ:
      - root: belge kökü, açılan ilk dosyanın klasörü (ensure_root / rebase).
      - explorer_root: gezgin kökü. Vault sabitlendiyse vault; değilse belge
        kökünden başlar ve kullanıcı ↑ ile üst klasöre çıkabilir. Yalnızca
        pywebview JsApi üzerinden değişir (kullanıcı niyeti).
    Erişim, bu köklerden herhangi birinin altındaysa serbesttir.
    """

    def __init__(self) -> None:
        self.root: str | None = None
        self.explorer_root: str | None = None
        self.vault: str | None = None

    # --- belge kökü ---------------------------------------------------------

    def ensure_root(self, file_path: str | None) -> None:
        if self.root or not file_path:
            return
        self.root = os.path.dirname(os.path.abspath(file_path))

    def rebase(self, file_path: str) -> str:
        """Belge kökünü verilen dosyanın klasörüne TAŞIR.

        Yalnızca kullanıcının native dosya seçme penceresinde açıkça seçtiği
        dosya için çağrılır (bkz. app/main.py JsApi.open_file). HTTP uçlarından
        tetiklenemez; kök hapsi böylece kullanıcı niyetiyle sınırlı kalır.
        """
        abs_path = os.path.abspath(file_path)
        self.root = os.path.dirname(abs_path)
        return abs_path

    # --- hapis ----------------------------------------------------------------

    def allowed_roots(self) -> list[str]:
        return [r for r in (self.root, self.explorer_root) if r]

    def get_abs(self, file_path: str | None) -> str | None:
        if not file_path:
            return None
        base = self.root or os.getcwd()
        if os.path.isabs(file_path):
            return os.path.abspath(file_path)
        return os.path.abspath(os.path.join(base, file_path))

    def within_root(self, abs_path: str) -> bool:
        roots = self.allowed_roots()
        if not roots:
            return True
        return any(_is_under(abs_path, r) for r in roots)

    def resolve_confined(self, file_path: str | None):
        """abs yol döner; kök dışıysa False; yol yoksa None."""
        abs_path = self.get_abs(file_path)
        if abs_path is None:
            return None
        return abs_path if self.within_root(abs_path) else False

    # --- gezgin ---------------------------------------------------------------

    def set_explorer_root(self, directory: str) -> str:
        abs_dir = os.path.abspath(directory)
        if not os.path.isdir(abs_dir):
            raise NotADirectoryError(abs_dir)
        self.explorer_root = abs_dir
        return abs_dir

    def open_workspace(self, directory: str) -> dict:
        """Klasörü çalışma alanı yapar: hem belge kökü hem gezgin kökü olur.

        Yalnızca kullanıcının native klasör seçme penceresinde ya da son
        açılanlar listesinde seçtiği klasör için çağrılır (bkz. app/main.py
        JsApi.open_folder); HTTP uçlarından tetiklenemez. Vault kilidi açıksa
        kilit bu yeni klasöre taşınır, kapalıysa kilit kurulmaz.
        """
        abs_dir = os.path.abspath(directory)
        if not os.path.isdir(abs_dir):
            raise NotADirectoryError(abs_dir)
        self.root = abs_dir
        self.explorer_root = abs_dir
        if self.vault is not None:
            self.vault = abs_dir
        return self.explorer_state()

    def _effective_explorer_root(self) -> str | None:
        return self.explorer_root or self.root

    def explorer_state(self) -> dict:
        root = self._effective_explorer_root()
        locked = self.vault is not None
        can_up = bool(root) and not locked and os.path.dirname(root) != root
        return {"root": root, "vault": self.vault, "locked": locked, "canUp": can_up}

    def explorer_up(self) -> dict:
        state = self.explorer_state()
        if state["canUp"]:
            self.set_explorer_root(os.path.dirname(state["root"]))
        return self.explorer_state()

    def explorer_enter(self, directory: str) -> dict:
        """Gezgin kökünü alt klasöre indirir (kilit açıkken, izinli kökler içinde)."""
        if self.vault is None:
            abs_dir = os.path.abspath(directory)
            if os.path.isdir(abs_dir) and self.within_root(abs_dir):
                self.explorer_root = abs_dir
        return self.explorer_state()

    def set_vault(self, directory: str | None) -> dict:
        """Vault sabitler (klasör) veya kaldırır (None). Geçersiz klasör yok sayılır."""
        if directory is None:
            self.vault = None
            if self.root:
                self.explorer_root = None  # belge köküne dön; belge yoksa yerinde kal
        elif os.path.isdir(directory):
            self.vault = self.set_explorer_root(directory)
        return self.explorer_state()

    def inspect_path(self, path: str) -> dict:
        """Bağlantı hedefinin türü: file / dir / missing / denied.

        Klasörse "note" alanı klasör notunu verir (README.md, index.md,
        _index.md, <klasör-adı>.md; .markdown da kabul, harf duyarsız).
        """
        if not isinstance(path, str) or not path.strip():
            return {"type": "missing", "path": ""}
        abs_path = os.path.abspath(path.strip().rstrip("\\/") or path.strip())
        if not self.within_root(abs_path):
            return {"type": "denied", "path": abs_path}
        if os.path.isfile(abs_path):
            return {"type": "file", "path": abs_path}
        if os.path.isdir(abs_path):
            return {"type": "dir", "path": abs_path, "note": self._folder_note(abs_path)}
        return {"type": "missing", "path": abs_path}

    def _folder_note(self, directory: str) -> str | None:
        stems = ["readme", "index", "_index", os.path.basename(directory).lower()]
        try:
            names = os.listdir(directory)
        except OSError:
            return None
        by_lower = {n.lower(): n for n in names if os.path.isfile(os.path.join(directory, n))}
        for stem in stems:
            for ext in MD_EXTENSIONS:
                hit = by_lower.get(stem + ext)
                if hit:
                    return os.path.join(directory, hit)
        return None

    def resolve_wikilink(self, target: str, current_file: str | None) -> str | None:
        """[[hedef]] için diskteki dosyayı bulur (Obsidian mantığı).

        Sıra: (1) belgenin klasörüne göre yol, (2) izinli köklere göre yol,
        (3) izinli köklerin altında dosya adıyla arama (büyük/küçük harf
        duyarsız, gizli klasörler atlanır). Uzantı verilmemişse .md/.markdown
        denenir. Kök dışı hiçbir şey dönmez.
        """
        if not isinstance(target, str) or not target.strip():
            return None
        target = target.strip().replace("\\", "/")
        candidates = [target] if target.lower().endswith(MD_EXTENSIONS) else [target + e for e in MD_EXTENSIONS]

        bases = []
        if current_file:
            bases.append(os.path.dirname(os.path.abspath(current_file)))
        bases.extend(r for r in self.allowed_roots() if r not in bases)
        for base in bases:
            for cand in candidates:
                p = os.path.abspath(os.path.join(base, cand))
                if os.path.isfile(p) and self.within_root(p):
                    return p

        wanted = {os.path.basename(c).lower() for c in candidates}
        for root in self.allowed_roots():
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for name in sorted(filenames):
                    if name.lower() in wanted:
                        return os.path.join(dirpath, name)
        return None

    def list_dir(self, directory: str) -> dict:
        """Klasörün gizli olmayan alt klasörleri + md dosyaları (ada göre sıralı).

        Yalnızca izinli köklerin altındaki klasörler listelenir.
        """
        abs_dir = os.path.abspath(directory)
        if not self.within_root(abs_dir):
            return {"success": False, "error": "Erişim reddedildi: çalışma klasörü dışında."}
        try:
            entries = sorted(os.scandir(abs_dir), key=lambda e: e.name.lower())
        except OSError as e:
            return {"success": False, "error": str(e)}
        dirs, files = [], []
        for e in entries:
            if e.name.startswith("."):
                continue
            item = {"name": e.name, "path": e.path}
            try:
                if e.is_dir():
                    dirs.append(item)
                elif e.is_file() and e.name.lower().endswith(MD_EXTENSIONS):
                    files.append(item)
            except OSError:
                continue
        return {"success": True, "path": abs_dir, "dirs": dirs, "files": files}


def _is_under(abs_path: str, root: str) -> bool:
    try:
        rel = os.path.relpath(abs_path, root)
    except ValueError:
        # Farklı sürücü (Windows) -> kesinlikle kök dışı.
        return False
    return rel == os.curdir or (not rel.startswith(os.pardir) and not os.path.isabs(rel))


def _json(payload: dict, status: int = 200) -> Response:
    return Response(json.dumps(payload, ensure_ascii=False), status=status,
                    mimetype="application/json")


def _forbidden() -> Response:
    return _json({"success": False, "error": "Erişim reddedildi: çalışma klasörü dışında."}, 403)


def create_app(workspace: Workspace | None = None) -> Flask:
    app = Flask(__name__)
    # Kabuk (app/main.py) aynı Workspace'i paylaşır: native dosya seçiciyle
    # başka klasördeki bir belge açıldığında kökü o klasöre taşıyabilsin.
    ws = workspace if workspace is not None else Workspace()

    @app.after_request
    def _no_store(resp: Response) -> Response:
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/health")
    def health():
        return _json({"success": True, "app": "MD Flow Viewer"})

    @app.post("/api/shutdown")
    def shutdown():
        # pywebview penceresi kapanınca süreç zaten biter; bu uç sadece istemcinin
        # pagehide beacon'ına 405 yerine sessiz 204 döner (no-op).
        return Response(status=204)

    @app.get("/api/settings")
    def get_settings():
        return _json({"success": True, "settings": load_settings_file()})

    @app.post("/api/settings")
    def set_settings():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return _json({"success": False, "error": "Geçersiz ayar verisi."}, 400)
        try:
            # Birleştir, ezme: arayüz yalnızca kendi bildiği anahtarları gönderir
            # (tema, autosave, satır no). lastDir gibi kabuk tarafı anahtarlar
            # tam yazımda kaybolurdu.
            settings = load_settings_file()
            settings.update(body)
            save_settings_file(settings)
            return _json({"success": True})
        except OSError as e:
            return _json({"success": False, "error": str(e)}, 500)

    @app.get("/api/content")
    def content():
        file_path = request.args.get("file")
        ws.ensure_root(file_path)
        if not file_path:
            # Dosya verilmediyse gömülü karşılama içeriğini göster (diske yazma yok).
            return _json({"success": True, "name": "Hoş geldiniz.md", "path": "", "content": WELCOME_MD})
        abs_path = ws.resolve_confined(file_path)
        if abs_path is False:
            return _forbidden()
        if not os.path.exists(abs_path):
            return _json({"success": False, "error": "Dosya bulunamadı: " + abs_path}, 404)
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                data = f.read()
            remember_last_dir(abs_path)
            return _json({"success": True, "name": os.path.basename(abs_path),
                          "path": abs_path, "content": data})
        except OSError as e:
            return _json({"success": False, "error": str(e)}, 500)

    @app.get("/api/asset")
    def asset():
        asset_path = request.args.get("file")
        if not asset_path:
            return _json({"success": False, "error": "Varlık yolu belirtilmedi."}, 400)
        abs_path = ws.resolve_confined(asset_path)
        if abs_path is False:
            return _forbidden()
        if not os.path.isfile(abs_path):
            return _json({"success": False, "error": "Varlık bulunamadı: " + str(abs_path)}, 404)
        ctype = mimetypes.guess_type(abs_path)[0] or "application/octet-stream"
        return send_file(abs_path, mimetype=ctype)

    @app.post("/api/save")
    def save():
        body = request.get_json(silent=True) or {}
        file_path = body.get("path")
        data = body.get("content")
        if not file_path or data is None:
            return _json({"success": False, "error": "Eksik dosya yolu veya içerik."}, 400)
        abs_path = ws.resolve_confined(file_path)
        if abs_path is False:
            return _forbidden()
        try:
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(data)
            return _json({"success": True, "message": "Dosya başarıyla kaydedildi."})
        except OSError as e:
            return _json({"success": False, "error": str(e)}, 500)

    @app.get("/api/watch")
    def watch():
        file_path = request.args.get("file")
        if not file_path:
            return _json({"error": "İzlenecek dosya belirtilmedi."}, 400)
        ws.ensure_root(file_path)
        abs_path = ws.resolve_confined(file_path)
        if abs_path is False:
            return _forbidden()
        if not os.path.exists(abs_path):
            return _json({"error": "İzlenecek dosya bulunamadı."}, 404)

        def stream():
            try:
                last = os.path.getmtime(abs_path)
            except OSError:
                last = 0
            yield "\n"
            while True:
                time.sleep(0.4)
                try:
                    cur = os.path.getmtime(abs_path)
                except OSError:
                    continue
                if cur != last:
                    last = cur
                    payload = json.dumps({"file": abs_path})
                    yield f"event: change\ndata: {payload}\n\n"

        return Response(stream(), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

    @app.get("/")
    def index():
        return send_from_directory(PUBLIC_DIR, "index.html")

    @app.get("/<path:req_path>")
    def static_files(req_path: str):
        full = os.path.join(PUBLIC_DIR, req_path)
        if os.path.isfile(full):
            return send_from_directory(PUBLIC_DIR, req_path)
        # Uzantılı istek gerçekten yoksa 404 (index.html dönmek görselleri bozar).
        if os.path.splitext(req_path)[1]:
            return Response("Bulunamadı: /" + req_path, status=404, mimetype="text/plain")
        return send_from_directory(PUBLIC_DIR, "index.html")

    return app
