//! Açılış akışı (2.x `app/main.py main()` karşılığı): komut satırındaki
//! belge, vault ve gezgin kökü; macOS'ta Finder'dan gelen dosya.
use crate::api::AppState;
use mdflow_core::paths::absolutize;
use mdflow_core::settings::RecentKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// `--` ile başlamayan ilk argüman (program adı atlanır), mutlak yapılmış.
pub fn file_arg(mut args: impl Iterator<Item = String>) -> Option<PathBuf> {
    let _program = args.next();
    let cwd = std::env::current_dir().unwrap_or_default();
    args.find(|a| !a.starts_with("--")).map(|a| absolutize(&cwd, &a))
}

/// Açılış belgesine göre çalışma alanını kurar: belge varsa kök onun klasörü
/// (dosyaysa son açılanlara eklenir); vault varsa gezgin kökü vault; belge de
/// vault da yoksa son klasör ya da ev dizini.
pub fn prepare(st: &AppState, file: Option<&Path>, home: &Path) {
    if let Some(f) = file {
        st.ws().ensure_root(Some(&f.to_string_lossy()));
        if f.is_file() {
            st.settings.remember_recent(RecentKind::File, f);
        }
    }
    if let Some(vault) = st.settings.vault_path() {
        st.ws().set_vault(Some(&vault.to_string_lossy()));
    } else if file.is_none() {
        let start = st.settings.last_dir().unwrap_or_else(|| home.to_path_buf());
        let _ = st.ws().set_explorer_root(&start.to_string_lossy());
    }
}

/// Arayüzün açılışta bir kez sorduğu belge. Arayüz sorduktan sonra gelen
/// dosyalar (macOS "Birlikte Aç") olay olarak iletilir.
#[derive(Default)]
pub struct InitialFile {
    inner: Mutex<(Option<String>, bool)>,
}

impl InitialFile {
    pub fn new(path: Option<String>) -> InitialFile {
        InitialFile { inner: Mutex::new((path, false)) }
    }

    /// Belgeyi verir ve "arayüz hazır" işaretler.
    pub fn take(&self) -> Option<String> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.1 = true;
        g.0.take()
    }

    /// Arayüz henüz sormadıysa belgeyi saklar ve None döner; sorduysa yolu
    /// geri verir (çağıran olayla iletir).
    pub fn offer(&self, path: String) -> Option<String> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.1 {
            Some(path)
        } else {
            g.0 = Some(path);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mdflow_core::settings::Settings;
    use tempfile::TempDir;

    fn args(v: &[&str]) -> impl Iterator<Item = String> {
        v.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter()
    }

    #[test]
    fn file_arg_skips_flags() {
        let got = file_arg(args(&["exe", "--selftest", "a.md"])).unwrap();
        assert!(got.is_absolute());
        assert_eq!(got.file_name().unwrap(), "a.md");
    }

    #[test]
    fn file_arg_none() {
        assert_eq!(file_arg(args(&["exe", "--x"])), None);
        assert_eq!(file_arg(args(&["exe"])), None);
    }

    fn setup() -> (TempDir, AppState) {
        let t = TempDir::new().unwrap();
        std::fs::create_dir_all(t.path().join("docs").join("sub")).unwrap();
        std::fs::write(t.path().join("docs").join("a.md"), "# a").unwrap();
        let st = AppState::new(Settings::at(t.path().join("settings.json")));
        (t, st)
    }

    #[test]
    fn prepare_with_file_sets_root_and_recent() {
        let (t, st) = setup();
        let f = t.path().join("docs").join("a.md");
        prepare(&st, Some(&f), t.path());
        assert_eq!(st.ws().root, Some(t.path().join("docs")));
        assert_eq!(st.settings.get_recent(RecentKind::File), [f.to_string_lossy().into_owned()]);
    }

    #[test]
    fn prepare_applies_saved_vault() {
        let (t, st) = setup();
        st.settings.set_vault_path(Some(&t.path().join("docs")));
        prepare(&st, Some(&t.path().join("docs").join("a.md")), t.path());
        let s = st.ws().explorer_state();
        assert!(s.locked);
        assert_eq!(s.root, Some(t.path().join("docs").to_string_lossy().into_owned()));
    }

    #[test]
    fn prepare_without_file_uses_last_dir_then_home() {
        let (t, st) = setup();
        prepare(&st, None, t.path());
        assert_eq!(st.ws().explorer_state().root, Some(t.path().to_string_lossy().into_owned()));

        let (t2, st2) = setup();
        st2.settings.remember_last_dir(&t2.path().join("docs").join("sub").join("x.md"));
        prepare(&st2, None, t2.path());
        assert_eq!(st2.ws().explorer_state().root, Some(t2.path().join("docs").join("sub").to_string_lossy().into_owned()));
    }

    #[test]
    fn initial_file_offer_before_and_after_take() {
        let f = InitialFile::new(None);
        assert_eq!(f.offer("a.md".into()), None);
        assert_eq!(f.take(), Some("a.md".into()));
        assert_eq!(f.offer("b.md".into()), Some("b.md".into()));
        assert_eq!(f.take(), None);
    }
}
