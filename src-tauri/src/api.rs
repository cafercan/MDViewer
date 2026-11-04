//! IPC komutlarının gövdeleri. Tauri'ye bağlı değildir; `commands.rs` yalnız
//! bunları çağırır. Dönüş JSON şekilleri 2.x HTTP uçları ve JsApi ile aynıdır.
use mdflow_core::links::DENIED;
use mdflow_core::paths::same_path;
use mdflow_core::settings::{RecentKind, Settings};
use mdflow_core::textfile::{self, ReadError};
use mdflow_core::workspace::{Confined, ExplorerState, Workspace};
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const WELCOME_MD: &str = "# MD Flow Viewer

Hoş geldiniz. Bir `.md` dosyasını **MD Flow Viewer ile Aç** diyerek açın; bu
pencere onu canlı olarak gösterir, düzenlemenize ve kaydetmenize izin verir.

- Sol tarafta otomatik **içindekiler**
- Sağ üstte **Oku / Düzenle**
- **Mermaid** diyagramları ve kod vurgulama
- Dosya diskte değişince **otomatik yenileme**
";

pub struct AppState {
    pub ws: Mutex<Workspace>,
    pub settings: Settings,
    /// Uygulamanın son kaydettiği dosya ve diskteki baytlarının özeti; izleyici
    /// kendi kaydımızı dış değişiklik sanmasın diye.
    pub last_write: Mutex<Option<(PathBuf, u64)>>,
}

impl AppState {
    pub fn new(settings: Settings) -> AppState {
        AppState { ws: Mutex::new(Workspace::default()), settings, last_write: Mutex::new(None) }
    }

    pub fn ws(&self) -> MutexGuard<'_, Workspace> {
        self.ws.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Köklerin kopyası: uzun disk işleri (klasör tarama, görsel okuma)
    /// sırasında kilit tutulmasın, diğer komutlar beklemesin.
    pub fn snapshot(&self) -> Workspace {
        self.ws().clone()
    }
}

pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut h = std::hash::DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

fn denied() -> Value {
    json!({"success": false, "error": DENIED})
}

// --- belge ------------------------------------------------------------------

/// Belge içeriği. Dosya yoksa gömülü karşılama metni (diske yazma yok).
/// Bir istek çalışma kökünü belirleyemez: kök yalnız kullanıcının açtığı belgeyle kurulur.
pub fn content(st: &AppState, file: Option<&str>) -> Value {
    let Some(file) = file.filter(|f| !f.is_empty()) else {
        return json!({"success": true, "name": "Hoş geldiniz.md", "path": "", "content": WELCOME_MD});
    };
    let Confined::Ok(abs) = st.ws().resolve_confined(file) else {
        return denied();
    };
    let shown = abs.to_string_lossy().into_owned();
    if !abs.exists() {
        return json!({"success": false, "error": format!("Dosya bulunamadı: {shown}")});
    }
    match textfile::read_doc(&abs) {
        Ok(text) => {
            st.settings.remember_last_dir(&abs);
            let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            json!({"success": true, "name": name, "path": shown, "content": text})
        }
        Err(ReadError::NotUtf8) => json!({"success": false, "error": format!("Dosya UTF-8 değil: {shown}")}),
        Err(ReadError::Io(e)) => json!({"success": false, "error": e.to_string()}),
    }
}

pub fn save(st: &AppState, path: &str, content: &str) -> Value {
    if path.is_empty() {
        return json!({"success": false, "error": "Eksik dosya yolu veya içerik."});
    }
    let Confined::Ok(abs) = st.ws().resolve_confined(path) else {
        return denied();
    };
    match textfile::write_doc(&abs, content) {
        Ok(written) => {
            // Diskten yeniden okumak yerine yazılan baytlar: arada gelen bir dış
            // değişiklik "kendi kaydımız" sanılıp bastırılmasın.
            *st.last_write.lock().unwrap_or_else(|e| e.into_inner()) = Some((abs, hash_bytes(&written)));
            json!({"success": true, "message": "Dosya başarıyla kaydedildi."})
        }
        Err(e) => json!({"success": false, "error": e.to_string()}),
    }
}

/// İzlenecek dosyayı doğrular (2.x `/api/watch`): belge kökü yoksa bu dosyayla
/// kurulur (komut satırından açılan ilk belge), kök dışı ve olmayan dosya reddedilir.
pub fn watch_target(st: &AppState, file: &str) -> Result<PathBuf, Value> {
    if file.is_empty() {
        return Err(json!({"error": "İzlenecek dosya belirtilmedi."}));
    }
    let mut ws = st.ws();
    ws.ensure_root(Some(file));
    let Confined::Ok(abs) = ws.resolve_confined(file) else {
        return Err(denied());
    };
    if !abs.exists() {
        return Err(json!({"error": "İzlenecek dosya bulunamadı."}));
    }
    Ok(abs)
}

/// İzleyicinin "bu değişiklik bizim kaydımız mı" sorusu.
pub fn is_own_write(st: &AppState, path: &Path, hash: u64) -> bool {
    let last = st.last_write.lock().unwrap_or_else(|e| e.into_inner());
    last.as_ref()
        .is_some_and(|(p, h)| *h == hash && same_path(&p.to_string_lossy(), &path.to_string_lossy()))
}

pub fn get_settings(st: &AppState) -> Value {
    json!({"success": true, "settings": st.settings.load()})
}

/// Birleştirir, ezmez: arayüz yalnız kendi bildiği anahtarları gönderir.
pub fn set_settings(st: &AppState, patch: Value) -> Value {
    let Value::Object(patch) = patch else {
        return json!({"success": false, "error": "Geçersiz ayar verisi."});
    };
    match st.settings.merge(patch) {
        Ok(()) => json!({"success": true}),
        Err(e) => json!({"success": false, "error": e.to_string()}),
    }
}

// --- dosya / klasör açma ---------------------------------------------------------

/// Son açılanlardan ya da diyalogdan seçilen dosya: belge kökü onun klasörüne taşınır.
pub fn open_file_path(st: &AppState, path: &str) -> Option<String> {
    if path.is_empty() || !Path::new(path).is_file() {
        return None;
    }
    let abs = st.ws().rebase(path);
    st.settings.remember_last_dir(&abs);
    st.settings.remember_recent(RecentKind::File, &abs);
    Some(abs.to_string_lossy().into_owned())
}

/// Klasörü çalışma alanı yapar; `{"path", "state"}`.
pub fn open_folder_path(st: &AppState, path: &str) -> Option<Value> {
    if path.is_empty() || !Path::new(path).is_dir() {
        return None;
    }
    let state = st.ws().open_workspace(path).ok()?;
    let abs = state.root.clone().unwrap_or_default();
    if let Some(v) = &state.vault {
        st.settings.set_vault_path(Some(Path::new(v)));
    }
    st.settings.remember_recent(RecentKind::Folder, Path::new(&abs));
    Some(json!({"path": abs, "state": state}))
}

/// Son açılan 10 dosya ve 10 klasör; silinmiş yollar elenmiş halde.
pub fn recent_list(st: &AppState) -> Value {
    json!({
        "files": st.settings.get_recent(RecentKind::File),
        "folders": st.settings.get_recent(RecentKind::Folder),
    })
}

pub fn clear_recent_list(st: &AppState, kind: &str) -> Value {
    if let Some(k) = RecentKind::parse(kind) {
        st.settings.clear_recent(k);
    }
    recent_list(st)
}

// --- gezgin --------------------------------------------------------------------

pub fn explorer_state(st: &AppState) -> ExplorerState {
    st.ws().explorer_state()
}

pub fn list_dir(st: &AppState, path: &str) -> Value {
    st.snapshot().list_dir(path)
}

pub fn explorer_up(st: &AppState) -> ExplorerState {
    st.ws().explorer_up()
}

pub fn explorer_enter(st: &AppState, path: &str) -> ExplorerState {
    st.ws().explorer_enter(path)
}

pub fn set_vault(st: &AppState, path: Option<&str>) -> ExplorerState {
    let state = st.ws().set_vault(path);
    st.settings.set_vault_path(state.vault.as_deref().map(Path::new));
    state
}

pub fn resolve_wikilink(st: &AppState, target: &str, current_file: Option<&str>) -> Option<String> {
    st.snapshot().resolve_wikilink(target, current_file)
}

pub fn inspect_path(st: &AppState, path: &str) -> Value {
    st.snapshot().inspect_path(path)
}

// --- dışarıda açma ------------------------------------------------------------

/// Yalnız http(s)/mailto; file:, javascript: … güvenilmeyen belgeden gelebilir.
pub fn open_external(url: &str, browser: &dyn Fn(&str) -> bool) -> bool {
    let url = url.trim();
    if !is_external_url(url) {
        return false;
    }
    browser(url)
}

pub fn is_external_url(url: &str) -> bool {
    let low = url.trim().to_ascii_lowercase();
    ["http://", "https://", "mailto:"].iter().any(|p| low.starts_with(p))
}

/// Kök içindeki var olan dosyayı (`want_dir` false) ya da klasörü (true) sistemde açar.
pub fn open_confined(st: &AppState, path: &str, want_dir: bool, opener: &dyn Fn(&Path) -> io::Result<()>) -> bool {
    if path.is_empty() {
        return false;
    }
    let Confined::Ok(abs) = st.ws().resolve_confined(path) else {
        return false;
    };
    let ok = if want_dir { abs.is_dir() } else { abs.is_file() };
    ok && opener(&abs).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use tempfile::TempDir;

    struct Fx {
        t: TempDir,
        st: AppState,
    }

    impl Fx {
        fn p(&self, rel: &str) -> PathBuf {
            rel.split('/').fold(self.t.path().to_path_buf(), |a, s| a.join(s))
        }
        fn ps(&self, rel: &str) -> String {
            self.p(rel).to_string_lossy().into_owned()
        }
    }

    /// vault/a.md vault/notes.txt vault/sub/c.md outside.md ; belge kökü vault/
    fn fx() -> Fx {
        let t = TempDir::new().unwrap();
        let st = AppState::new(Settings::at(t.path().join("cfg").join("settings.json")));
        let f = Fx { t, st };
        for rel in ["vault/a.md", "vault/sub/c.md", "outside.md"] {
            std::fs::create_dir_all(f.p(rel).parent().unwrap()).unwrap();
            std::fs::write(f.p(rel), "# x\n").unwrap();
        }
        std::fs::write(f.p("vault/notes.txt"), "txt").unwrap();
        f.st.ws().ensure_root(Some(&f.ps("vault/a.md")));
        f
    }

    #[test]
    fn content_without_file_returns_welcome() {
        let f = fx();
        let r = content(&f.st, None);
        assert_eq!(r["success"], true);
        assert_eq!(r["name"], "Hoş geldiniz.md");
        assert_eq!(r["content"], WELCOME_MD);
    }

    #[test]
    fn content_outside_root_is_denied() {
        let f = fx();
        let r = content(&f.st, Some(&f.ps("outside.md")));
        assert_eq!(r["success"], false);
        assert_eq!(r["error"], "Erişim reddedildi: çalışma klasörü dışında.");
    }

    #[test]
    fn content_missing_file_reports_path() {
        let f = fx();
        let r = content(&f.st, Some(&f.ps("vault/yok.md")));
        assert_eq!(r["success"], false);
        assert!(r["error"].as_str().unwrap().starts_with("Dosya bulunamadı: "));
    }

    #[test]
    fn content_non_utf8_returns_error() {
        let f = fx();
        std::fs::write(f.p("vault/bozuk.md"), [0xff, 0xfe, 0x00]).unwrap();
        let r = content(&f.st, Some(&f.ps("vault/bozuk.md")));
        assert_eq!(r["success"], false);
        assert!(r["error"].as_str().unwrap().starts_with("Dosya UTF-8 değil: "));
    }

    #[test]
    fn content_records_last_dir() {
        let f = fx();
        let r = content(&f.st, Some(&f.ps("vault/sub/c.md")));
        assert_eq!(r["success"], true);
        assert_eq!(r["name"], "c.md");
        assert_eq!(r["path"], f.ps("vault/sub/c.md"));
        assert_eq!(r["content"], "# x\n");
        assert_eq!(f.st.settings.last_dir(), Some(f.p("vault/sub")));
    }

    #[test]
    fn api_content_allows_file_inside_explorer_root() {
        let f = fx();
        {
            let mut ws = f.st.ws();
            *ws = Workspace::default();
            ws.ensure_root(Some(&f.ps("vault/sub/c.md")));
            ws.set_explorer_root(&f.ps("vault")).unwrap();
        }
        assert_eq!(content(&f.st, Some(&f.ps("vault/a.md")))["content"], "# x\n");
    }

    #[test]
    fn http_request_cannot_set_root() {
        let f = fx();
        *f.st.ws() = Workspace::default();
        assert_eq!(content(&f.st, Some(&f.ps("vault/a.md")))["success"], false);
    }

    #[test]
    fn save_outside_root_is_denied() {
        let f = fx();
        let r = save(&f.st, &f.ps("outside.md"), "ele geçirildi");
        assert_eq!(r["success"], false);
        assert_eq!(std::fs::read_to_string(f.p("outside.md")).unwrap(), "# x\n");
    }

    #[test]
    fn save_writes_utf8() {
        let f = fx();
        let r = save(&f.st, &f.ps("vault/a.md"), "# Şema ğüş\n");
        assert_eq!(r["success"], true);
        assert_eq!(r["message"], "Dosya başarıyla kaydedildi.");
        assert_eq!(textfile::read_doc(&f.p("vault/a.md")).unwrap(), "# Şema ğüş\n");
    }

    #[test]
    fn save_records_last_write() {
        let f = fx();
        save(&f.st, &f.ps("vault/a.md"), "yeni\n");
        let disk = std::fs::read(f.p("vault/a.md")).unwrap();
        let lw = f.st.last_write.lock().unwrap().clone();
        assert_eq!(lw, Some((f.p("vault/a.md"), hash_bytes(&disk))));
    }

    #[test]
    fn save_empty_path_is_rejected() {
        let f = fx();
        assert_eq!(save(&f.st, "", "x")["error"], "Eksik dosya yolu veya içerik.");
    }

    #[test]
    fn watch_target_sets_root_when_none() {
        let f = fx();
        *f.st.ws() = Workspace::default();
        assert_eq!(watch_target(&f.st, &f.ps("vault/sub/c.md")), Ok(f.p("vault/sub/c.md")));
        assert_eq!(f.st.ws().root, Some(f.p("vault/sub")));
    }

    #[test]
    fn watch_target_rejects_outside_missing_and_empty() {
        let f = fx();
        assert_eq!(watch_target(&f.st, &f.ps("outside.md")).unwrap_err()["error"], DENIED);
        assert_eq!(watch_target(&f.st, &f.ps("vault/yok.md")).unwrap_err()["error"], "İzlenecek dosya bulunamadı.");
        assert_eq!(watch_target(&f.st, "").unwrap_err()["error"], "İzlenecek dosya belirtilmedi.");
    }

    #[test]
    fn is_own_write_matches_last_save_only() {
        let f = fx();
        save(&f.st, &f.ps("vault/a.md"), "yeni\n");
        let h = hash_bytes(&std::fs::read(f.p("vault/a.md")).unwrap());
        assert!(is_own_write(&f.st, &f.p("vault/a.md"), h));
        assert!(!is_own_write(&f.st, &f.p("vault/a.md"), h ^ 1));
        assert!(!is_own_write(&f.st, &f.p("vault/sub/c.md"), h));
    }

    #[test]
    fn set_settings_merges() {
        let f = fx();
        f.st.settings.remember_last_dir(&f.p("vault/a.md"));
        assert_eq!(set_settings(&f.st, json!({"theme": "koyu"}))["success"], true);
        let s = get_settings(&f.st);
        assert_eq!(s["success"], true);
        assert_eq!(s["settings"]["theme"], "koyu");
        assert_eq!(s["settings"]["lastDir"], f.ps("vault"));
    }

    #[test]
    fn set_settings_rejects_non_object() {
        let f = fx();
        assert_eq!(set_settings(&f.st, json!([1]))["error"], "Geçersiz ayar verisi.");
    }

    #[test]
    fn open_external_only_allows_web_schemes() {
        let opened = RefCell::new(Vec::new());
        let browser = |u: &str| {
            opened.borrow_mut().push(u.to_string());
            true
        };
        assert!(open_external("https://example.com/x", &browser));
        assert!(open_external(" mailto:a@b.c ", &browser));
        assert!(open_external("HTTP://example.com", &browser));
        assert!(!open_external("file:///C:/Windows/system.ini", &browser));
        assert!(!open_external("javascript:alert(1)", &browser));
        assert_eq!(*opened.borrow(), ["https://example.com/x", "mailto:a@b.c", "HTTP://example.com"]);
    }

    #[test]
    fn open_path_refuses_outside_roots() {
        let f = fx();
        let opened = RefCell::new(Vec::new());
        let opener = |p: &Path| {
            opened.borrow_mut().push(p.to_path_buf());
            Ok(())
        };
        assert!(open_confined(&f.st, &f.ps("vault/notes.txt"), false, &opener));
        assert!(!open_confined(&f.st, &f.ps("outside.md"), false, &opener));
        assert!(!open_confined(&f.st, &f.ps("vault/yok.txt"), false, &opener));
        assert!(!open_confined(&f.st, &f.ps("vault/sub"), false, &opener));
        assert_eq!(*opened.borrow(), [f.p("vault/notes.txt")]);
    }

    #[test]
    fn open_in_file_manager_allows_dirs_inside_roots() {
        let f = fx();
        let opened = RefCell::new(Vec::new());
        let opener = |p: &Path| {
            opened.borrow_mut().push(p.to_path_buf());
            Ok(())
        };
        assert!(open_confined(&f.st, &f.ps("vault/sub"), true, &opener));
        assert!(!open_confined(&f.st, &f.t.path().to_string_lossy(), true, &opener));
        assert!(!open_confined(&f.st, &f.ps("vault/yok"), true, &opener));
        assert_eq!(*opened.borrow(), [f.p("vault/sub")]);
    }

    #[test]
    fn jsapi_open_folder_path_records_recent() {
        let f = fx();
        let r = open_folder_path(&f.st, &f.ps("vault/sub")).unwrap();
        assert_eq!(r["path"], f.ps("vault/sub"));
        assert_eq!(r["state"]["root"], f.ps("vault/sub"));
        assert_eq!(f.st.settings.get_recent(RecentKind::Folder), [f.ps("vault/sub")]);
        assert!(open_folder_path(&f.st, &f.ps("yok")).is_none());
        assert!(open_folder_path(&f.st, &f.ps("vault/a.md")).is_none());
    }

    #[test]
    fn jsapi_open_file_path_rebases_and_records_recent() {
        let f = fx();
        let target = f.ps("vault/sub/c.md");
        assert_eq!(open_file_path(&f.st, &target), Some(target.clone()));
        assert_eq!(f.st.ws().root, Some(f.p("vault/sub")));
        assert_eq!(recent_list(&f.st)["files"], json!([target]));
        assert!(open_file_path(&f.st, &f.ps("vault/yok.md")).is_none());
        assert_eq!(clear_recent_list(&f.st, "file")["files"], json!([]));
    }

    #[test]
    fn set_vault_persists_setting() {
        let f = fx();
        let st = set_vault(&f.st, Some(&f.ps("vault")));
        assert!(st.locked);
        assert_eq!(f.st.settings.vault_path(), Some(f.p("vault")));
        set_vault(&f.st, None);
        assert_eq!(f.st.settings.vault_path(), None);
    }
}
