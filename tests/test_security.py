"""Yerel sunucunun erişim denetimi: başka siteler ve DNS rebinding."""
import os

import pytest

from server import SESSION_COOKIE, Workspace, create_app

TOKEN = "deneme-anahtari"


@pytest.fixture
def doc(tmp_path):
    p = tmp_path / "not.md"
    p.write_text("# gizli\n", encoding="utf-8")
    return p


@pytest.fixture
def client(doc):
    ws = Workspace()
    ws.ensure_root(str(doc))
    return create_app(ws, TOKEN).test_client()


def _login(client):
    r = client.get("/", query_string={"t": TOKEN})
    assert r.status_code == 200
    assert SESSION_COOKIE in r.headers.get("Set-Cookie", "")
    assert "SameSite=Strict" in r.headers["Set-Cookie"]
    assert "HttpOnly" in r.headers["Set-Cookie"]


def test_api_requires_session(client, doc):
    r = client.get("/api/content", query_string={"file": str(doc)})
    assert r.status_code == 403


def test_wrong_token_sets_no_session(client, doc):
    r = client.get("/", query_string={"t": "yanlis"})
    assert SESSION_COOKIE not in r.headers.get("Set-Cookie", "")
    assert client.get("/api/content", query_string={"file": str(doc)}).status_code == 403


def test_session_allows_api(client, doc):
    _login(client)
    r = client.get("/api/content", query_string={"file": str(doc)})
    assert r.status_code == 200
    assert r.get_json()["content"] == "# gizli\n"


def test_save_requires_session(client, doc):
    r = client.post("/api/save", json={"path": str(doc), "content": "ele geçirildi"})
    assert r.status_code == 403
    assert doc.read_text(encoding="utf-8") == "# gizli\n"


def test_foreign_host_is_rejected(client, doc):
    _login(client)
    r = client.get("/api/content", query_string={"file": str(doc)}, headers={"Host": "saldirgan.example:5000"})
    assert r.status_code == 403
    assert client.get("/", headers={"Host": "saldirgan.example"}).status_code == 403


def test_health_stays_open(client):
    # main.py açılışta sunucunun hazır olduğunu çerezsiz sorar
    assert client.get("/api/health").status_code == 200


def test_http_request_cannot_set_root(tmp_path):
    secret = tmp_path / "secret.md"
    secret.write_text("x", encoding="utf-8")
    client = create_app(Workspace()).test_client()
    r = client.get("/api/content", query_string={"file": str(secret)})
    assert r.status_code == 403


def test_no_roots_allows_nothing(tmp_path):
    assert not Workspace().within_root(os.path.join(str(tmp_path), "a.md"))
