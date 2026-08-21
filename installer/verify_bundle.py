"""PyInstaller çıktısının gerçekten dolu olduğunu doğrular.

Neden gerekli: PATH'teki global pyinstaller (flask/pywebview kurulu OLMAYAN bir
ortam) ile derleme yapılırsa PyInstaller hata vermez, sadece iskelet bir bundle
üretir. Belirti kullanıcıda ortaya çıkar: "No module named 'uuid'".

Saf Python modülleri _internal\ altında klasör olarak durmaz; exe içindeki PYZ
arşivindedir. Bu yüzden klasör varlığına değil PYZ içeriğine bakıyoruz.

Kullanım: python installer/verify_bundle.py dist/MDFlowViewer/MDFlowViewer.exe
"""
from __future__ import annotations

import os
import sys
import tempfile

from PyInstaller.archive.readers import CArchiveReader, ZlibArchiveReader

REQUIRED = ("uuid", "flask.app", "werkzeug", "webview", "server")


def pyz_modules(exe: str) -> set[str]:
    blob = CArchiveReader(exe).extract("PYZ.pyz")
    if not isinstance(blob, bytes):
        blob = blob[1]

    tmp = os.path.join(tempfile.gettempdir(), "mdflow_pyz_check.pyz")
    with open(tmp, "wb") as f:
        f.write(blob)
    try:
        return set(ZlibArchiveReader(tmp).toc)
    finally:
        os.remove(tmp)


def main() -> int:
    if len(sys.argv) != 2:
        print("kullanim: verify_bundle.py <exe>")
        return 2

    exe = sys.argv[1]
    mods = pyz_modules(exe)
    missing = [m for m in REQUIRED if m not in mods]

    print(f"PYZ modul sayisi: {len(mods)}")
    if missing:
        print("EKSIK MODUL: " + ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
