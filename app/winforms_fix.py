"""pywebview'in Windows (WinForms) arka ucu için kapanma düzeltmesi.

pywebview 6.2.1'de pencerenin FormClosed işleyicisi (BrowserForm.on_close) aynı
pencere için ikinci kez çalışırsa `del BrowserView.instances[uid]` satırı
KeyError ('master') atar. Hata .NET tarafında yakalanmadığı için Windows bir
"işlenmemiş özel durum" penceresi açar; süreç o pencerede takılı kalır, dosyaları
kilitli kalır ve kurulum/güncelleme yarıda kesilir. İşleyiciyi bir kez
çalışacak hale getiriyoruz: ikinci çağrının yapacağı bir iş zaten yok.
"""
from __future__ import annotations

import functools
import sys

_MARK = "_mdflow_close_once"


def make_close_idempotent(form_cls) -> None:
    """`form_cls.on_close`'u pencere başına yalnızca bir kez çalışır hale getirir."""
    original = form_cls.on_close
    if getattr(original, _MARK, False):
        return

    @functools.wraps(original)
    def on_close(self, *args):
        if getattr(self, "_mdflow_closed", False):
            return None
        self._mdflow_closed = True
        return original(self, *args)

    setattr(on_close, _MARK, True)
    form_cls.on_close = on_close


def apply() -> None:
    """Yalnızca Windows'ta; pencere oluşturulmadan (webview.start) önce çağrılmalı."""
    if sys.platform != "win32":
        return
    from webview.platforms import winforms

    make_close_idempotent(winforms.BrowserView.BrowserForm)
