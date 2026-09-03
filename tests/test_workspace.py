"""Workspace kök hapsi ve gezgin (explorer) mantığı."""
import os

import pytest

from server import Workspace, create_app


def _touch(path: str, text: str = "# x\n") -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


@pytest.fixture
def tree(tmp_path):
    """vault/
         a.md  b.markdown  notes.txt  .hidden/  .dot.md
         sub/  c.md
         empty/
       outside.md (vault dışı)"""
    vault = tmp_path / "vault"
    _touch(str(vault / "a.md"))
    _touch(str(vault / "b.markdown"))
    _touch(str(vault / "notes.txt"), "txt")
    _touch(str(vault / ".dot.md"))
    os.makedirs(vault / ".hidden")
    _touch(str(vault / "sub" / "c.md"))
    os.makedirs(vault / "empty")
    _touch(str(tmp_path / "outside.md"))
    return tmp_path


# --- kök hapsi -------------------------------------------------------------

def test_document_root_confines_by_default(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    assert ws.within_root(str(tree / "vault" / "sub" / "c.md"))
    assert not ws.within_root(str(tree / "vault" / "a.md"))


def test_explorer_root_widens_confinement(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    ws.set_explorer_root(str(tree / "vault"))
    assert ws.within_root(str(tree / "vault" / "a.md"))
    assert ws.within_root(str(tree / "vault" / "sub" / "c.md"))
    assert not ws.within_root(str(tree / "outside.md"))


def test_set_explorer_root_rejects_non_directory(tree):
    ws = Workspace()
    with pytest.raises(NotADirectoryError):
        ws.set_explorer_root(str(tree / "vault" / "a.md"))


# --- list_dir ---------------------------------------------------------------

def test_list_dir_returns_visible_dirs_and_md_files_sorted(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    result = ws.list_dir(str(tree / "vault"))
    assert result["success"] is True
    assert [d["name"] for d in result["dirs"]] == ["empty", "sub"]
    assert [f["name"] for f in result["files"]] == ["a.md", "b.markdown"]
    assert result["dirs"][1]["path"] == str(tree / "vault" / "sub")


def test_list_dir_outside_roots_is_refused(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    result = ws.list_dir(str(tree))
    assert result["success"] is False
    assert "error" in result


def test_list_dir_missing_directory_reports_error(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    result = ws.list_dir(str(tree / "vault" / "yok"))
    assert result["success"] is False


# --- explorer state / up / vault -------------------------------------------

def test_explorer_state_defaults_to_document_folder(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    state = ws.explorer_state()
    assert state["root"] == str(tree / "vault" / "sub")
    assert state["locked"] is False
    assert state["canUp"] is True


def test_explorer_up_moves_root_to_parent_when_unlocked(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    state = ws.explorer_up()
    assert state["root"] == str(tree / "vault")
    # belge kökü de erişilebilir kalır
    assert ws.within_root(str(tree / "vault" / "sub" / "c.md"))
    assert ws.within_root(str(tree / "vault" / "a.md"))


def test_explorer_up_stops_at_drive_root():
    ws = Workspace()
    drive_root = os.path.abspath(os.sep)
    ws.set_explorer_root(drive_root)
    state = ws.explorer_state()
    assert state["canUp"] is False
    assert ws.explorer_up()["root"] == drive_root


def test_set_vault_locks_explorer_root(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    state = ws.set_vault(str(tree / "vault"))
    assert state["locked"] is True
    assert state["root"] == str(tree / "vault")
    assert state["canUp"] is False
    # kilitliyken ↑ kökü değiştirmez
    assert ws.explorer_up()["root"] == str(tree / "vault")


def test_clear_vault_returns_to_document_folder(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    ws.set_vault(str(tree / "vault"))
    state = ws.set_vault(None)
    assert state["locked"] is False
    assert state["root"] == str(tree / "vault" / "sub")


def test_set_vault_with_missing_directory_is_ignored(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    state = ws.set_vault(str(tree / "yok"))
    assert state["locked"] is False
    assert state["root"] == str(tree / "vault" / "sub")


# --- /api/content: gezgin kökü içindeki dosya ------------------------------

def test_api_content_allows_file_inside_explorer_root(tree):
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "sub" / "c.md"))
    ws.set_explorer_root(str(tree / "vault"))
    client = create_app(ws).test_client()
    r = client.get("/api/content", query_string={"file": str(tree / "vault" / "a.md")})
    assert r.status_code == 200
    assert r.get_json()["content"] == "# x\n"


# --- vault ayarı kalıcılığı --------------------------------------------------

def test_vault_path_setting_roundtrip(tmp_path, monkeypatch):
    import server
    monkeypatch.setattr(server, "settings_path", lambda: str(tmp_path / "settings.json"))
    assert server.get_vault_path() == ""
    server.set_vault_path(str(tmp_path))
    assert server.get_vault_path() == str(tmp_path)
    server.set_vault_path(None)
    assert server.get_vault_path() == ""


def test_vault_path_setting_ignores_missing_dir(tmp_path, monkeypatch):
    import server
    monkeypatch.setattr(server, "settings_path", lambda: str(tmp_path / "settings.json"))
    server.set_vault_path(str(tmp_path / "yok"))
    assert server.get_vault_path() == ""


def test_clear_vault_without_document_keeps_folder_unlocked(tree):
    ws = Workspace()  # karşılama ekranı: belge yok
    ws.set_vault(str(tree / "vault"))
    state = ws.set_vault(None)
    assert state["locked"] is False
    assert state["root"] == str(tree / "vault")


# --- explorer_enter: alt klasöre in ------------------------------------------

def test_explorer_enter_descends_into_subfolder(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    state = ws.explorer_enter(str(tree / "vault" / "sub"))
    assert state["root"] == str(tree / "vault" / "sub")
    assert state["canUp"] is True


def test_explorer_enter_refuses_folder_outside_roots(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    state = ws.explorer_enter(str(tree))
    assert state["root"] == str(tree / "vault")


def test_explorer_enter_ignored_when_locked(tree):
    ws = Workspace()
    ws.set_vault(str(tree / "vault"))
    state = ws.explorer_enter(str(tree / "vault" / "sub"))
    assert state["root"] == str(tree / "vault")
    assert state["locked"] is True


def test_explorer_enter_ignores_missing_folder(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    state = ws.explorer_enter(str(tree / "vault" / "yok"))
    assert state["root"] == str(tree / "vault")


# --- JsApi: dış bağlantı ve yerel dosya açma -----------------------------------

def _jsapi(tree):
    import main
    ws = Workspace()
    ws.ensure_root(str(tree / "vault" / "a.md"))
    return main.JsApi(ws)


def test_open_external_only_allows_web_schemes(tree, monkeypatch):
    import main
    opened = []
    monkeypatch.setattr(main.webbrowser, "open", lambda url: opened.append(url) or True)
    api = _jsapi(tree)
    assert api.open_external("https://example.com/x") is True
    assert api.open_external("mailto:a@b.c") is True
    assert api.open_external("file:///C:/Windows/system.ini") is False
    assert api.open_external("javascript:alert(1)") is False
    assert opened == ["https://example.com/x", "mailto:a@b.c"]


def test_open_path_refuses_outside_roots(tree, monkeypatch):
    import main
    opened = []
    monkeypatch.setattr(main, "_startfile", lambda p: opened.append(p))
    api = _jsapi(tree)
    assert api.open_path(str(tree / "vault" / "notes.txt")) is True
    assert api.open_path(str(tree / "outside.md")) is False
    assert api.open_path(str(tree / "vault" / "yok.txt")) is False
    assert opened == [str(tree / "vault" / "notes.txt")]


# --- wikilink çözümleme ------------------------------------------------------

def test_resolve_wikilink_prefers_current_folder(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    cur = str(tree / "vault" / "sub" / "c.md")
    _touch(str(tree / "vault" / "sub" / "a.md"))          # aynı adda ikinci a.md
    assert ws.resolve_wikilink("a", cur) == str(tree / "vault" / "sub" / "a.md")


def test_resolve_wikilink_searches_roots_by_basename(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    cur = str(tree / "vault" / "a.md")
    assert ws.resolve_wikilink("c", cur) == str(tree / "vault" / "sub" / "c.md")
    assert ws.resolve_wikilink("C.MD", cur) == str(tree / "vault" / "sub" / "c.md")
    assert ws.resolve_wikilink("b", cur) == str(tree / "vault" / "b.markdown")


def test_resolve_wikilink_with_folder_path(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    cur = str(tree / "vault" / "a.md")
    assert ws.resolve_wikilink("sub/c", cur) == str(tree / "vault" / "sub" / "c.md")


def test_resolve_wikilink_missing_or_outside_returns_none(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    cur = str(tree / "vault" / "a.md")
    assert ws.resolve_wikilink("yok", cur) is None
    assert ws.resolve_wikilink("outside", cur) is None       # kök dışı, aranmaz
    assert ws.resolve_wikilink("", cur) is None


# --- inspect_path: klasör bağlantıları --------------------------------------

def test_inspect_path_reports_file_dir_missing_denied(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    assert ws.inspect_path(str(tree / "vault" / "a.md"))["type"] == "file"
    assert ws.inspect_path(str(tree / "vault" / "empty"))["type"] == "dir"
    assert ws.inspect_path(str(tree / "vault" / "yok"))["type"] == "missing"
    assert ws.inspect_path(str(tree))["type"] == "denied"
    assert ws.inspect_path("")["type"] == "missing"


def test_inspect_path_finds_folder_note_in_priority_order(tree):
    ws = Workspace()
    ws.set_explorer_root(str(tree / "vault"))
    sub = tree / "vault" / "sub"
    assert ws.inspect_path(str(sub))["note"] is None            # yalnız c.md var
    _touch(str(sub / "sub.md"))                                  # <klasör-adı>.md
    assert ws.inspect_path(str(sub))["note"] == str(sub / "sub.md")
    _touch(str(sub / "_index.md"))
    assert ws.inspect_path(str(sub))["note"] == str(sub / "_index.md")
    _touch(str(sub / "index.md"))
    assert ws.inspect_path(str(sub))["note"] == str(sub / "index.md")
    _touch(str(sub / "Readme.MD"))                               # büyük/küçük harf duyarsız
    assert ws.inspect_path(str(sub))["note"] == str(sub / "Readme.MD")
    assert ws.inspect_path(str(sub) + "/")["type"] == "dir"      # sondaki / zararsız


def test_open_in_file_manager_allows_dirs_inside_roots(tree, monkeypatch):
    import main
    opened = []
    monkeypatch.setattr(main, "_startfile", lambda p: opened.append(p))
    api = _jsapi(tree)
    assert api.open_in_file_manager(str(tree / "vault" / "sub")) is True
    assert api.open_in_file_manager(str(tree)) is False              # kök dışı
    assert api.open_in_file_manager(str(tree / "vault" / "yok")) is False
    assert opened == [str(tree / "vault" / "sub")]
