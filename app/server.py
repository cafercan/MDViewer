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

WELCOME_MD = """# MD Flow Viewer

Hoş geldiniz. Bir `.md` dosyasını **MD Flow Viewer ile Aç** diyerek açın; bu
pencere onu canlı olarak gösterir, düzenlemenize ve kaydetmenize izin verir.

- Sol tarafta otomatik **içindekiler**
- Sağ üstte **Oku / Düzenle**
- **Mermaid** diyagramları ve kod vurgulama
- Dosya diskte değişince **otomatik yenileme**
"""


class Workspace:
    """Çalışma kökü + kök hapsi mantığı (server.js ile birebir)."""

    def __init__(self) -> None:
        self.root: str | None = None

    def ensure_root(self, file_path: str | None) -> None:
        if self.root or not file_path:
            return
        self.root = os.path.dirname(os.path.abspath(file_path))

    def get_abs(self, file_path: str | None) -> str | None:
        if not file_path:
            return None
        base = self.root or os.getcwd()
        if os.path.isabs(file_path):
            return os.path.abspath(file_path)
        return os.path.abspath(os.path.join(base, file_path))

    def within_root(self, abs_path: str) -> bool:
        if not self.root:
            return True
        try:
            rel = os.path.relpath(abs_path, self.root)
        except ValueError:
            # Farklı sürücü (Windows) -> kesinlikle kök dışı.
            return False
        return rel == os.curdir or (not rel.startswith(os.pardir) and not os.path.isabs(rel))

    def resolve_confined(self, file_path: str | None):
        """abs yol döner; kök dışıysa False; yol yoksa None."""
        abs_path = self.get_abs(file_path)
        if abs_path is None:
            return None
        return abs_path if self.within_root(abs_path) else False


def _json(payload: dict, status: int = 200) -> Response:
    return Response(json.dumps(payload, ensure_ascii=False), status=status,
                    mimetype="application/json")


def _forbidden() -> Response:
    return _json({"success": False, "error": "Erişim reddedildi: çalışma klasörü dışında."}, 403)


def create_app() -> Flask:
    app = Flask(__name__)
    ws = Workspace()

    @app.after_request
    def _no_store(resp: Response) -> Response:
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/health")
    def health():
        return _json({"success": True, "app": "MD Flow Viewer"})

    @app.get("/api/files")
    def files():
        active = request.args.get("file")
        ws.ensure_root(active)
        target = ws.root or os.getcwd()
        try:
            out = []
            for name in os.listdir(target):
                if name.endswith((".md", ".markdown")):
                    fp = os.path.join(target, name)
                    if os.path.isfile(fp):
                        out.append({
                            "name": name,
                            "path": fp,
                            "relativePath": os.path.relpath(fp, os.getcwd()) if _same_drive(fp) else fp,
                        })
            return _json({"success": True, "files": out})
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

    @app.get("/api/css")
    def css():
        css_path = request.args.get("path")
        if not css_path:
            return _json({"success": False, "error": "CSS yolu belirtilmedi."}, 400)
        abs_path = ws.resolve_confined(css_path)
        if abs_path is False:
            return _forbidden()
        if not os.path.exists(abs_path):
            return _json({"success": False, "error": "CSS dosyası bulunamadı: " + abs_path}, 404)
        try:
            with open(abs_path, "r", encoding="utf-8") as f:
                return _json({"success": True, "css": f.read()})
        except OSError as e:
            return _json({"success": False, "error": str(e)}, 500)

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


def _same_drive(path: str) -> bool:
    try:
        os.path.relpath(path, os.getcwd())
        return True
    except ValueError:
        return False
