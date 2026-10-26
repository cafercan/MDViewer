import winforms_fix


class FakeForm:
    instances = {}

    def __init__(self, uid):
        self.uid = uid
        FakeForm.instances[uid] = self
        self.calls = 0

    def on_close(self, *_):
        # pywebview'deki gibi: ikinci çağrıda KeyError
        self.calls += 1
        del FakeForm.instances[self.uid]


def test_second_close_is_ignored():
    winforms_fix.make_close_idempotent(FakeForm)
    form = FakeForm("master")
    form.on_close(None, None)
    form.on_close(None, None)
    assert form.calls == 1


def test_patching_twice_does_not_stack():
    winforms_fix.make_close_idempotent(FakeForm)
    patched = FakeForm.on_close
    winforms_fix.make_close_idempotent(FakeForm)
    assert FakeForm.on_close is patched


def test_noop_outside_windows(monkeypatch):
    monkeypatch.setattr(winforms_fix.sys, "platform", "linux")
    winforms_fix.apply()  # webview içe aktarılmadan dönmeli
