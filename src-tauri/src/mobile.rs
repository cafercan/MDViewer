//! Android açılışı. Masaüstünden farkı: komut satırı yoktur, uygulama her
//! açılışta kaldığı nottan devam eder; ilk açılışta uygulamanın kendi
//! (depolama izni istemeyen) not klasörü örnek notlarla kurulur. Dışarıdan
//! "Birlikte aç" ile gelen dosyayı MainActivity arayüze verir.
use crate::api::AppState;
use mdflow_core::paths::is_under;
use mdflow_core::settings::RecentKind;
use std::path::{Path, PathBuf};

pub const WELCOME_NAME: &str = "Hoş geldiniz.md";

const SEED: &[(&str, &str)] = &[
    (WELCOME_NAME, include_str!("../mobile/welcome.md")),
    ("Markdown örnekleri.md", include_str!("../mobile/examples.md")),
    ("Günlük.md", include_str!("../mobile/journal.md")),
];

/// Not klasörünü yalnız ilk açılışta kurar; kullanıcı örnekleri sildiyse
/// geri getirmez.
pub fn seed_notes(dir: &Path) {
    if dir.exists() || std::fs::create_dir_all(dir).is_err() {
        return;
    }
    for (name, text) in SEED {
        let _ = std::fs::write(dir.join(name), text);
    }
}

/// Çalışma alanını kurar ve açılacak notu döndürür: son açılan not, yoksa
/// karşılama notu. Gezgin, not onun altındaysa son açılan klasörde kalır.
pub fn prepare(st: &AppState, notes: &Path) -> Option<PathBuf> {
    let welcome = notes.join(WELCOME_NAME);
    let file = st
        .settings
        .get_recent(RecentKind::File)
        .into_iter()
        .next()
        .map(PathBuf::from)
        .or_else(|| welcome.is_file().then_some(welcome));
    crate::startup::prepare(st, file.as_deref(), notes);

    if st.settings.vault_path().is_none() {
        let folder = st.settings.get_recent(RecentKind::Folder).into_iter().next().map(PathBuf::from);
        if let (Some(f), Some(dir)) = (&file, folder) {
            if is_under(f, &dir) {
                let _ = st.ws().set_explorer_root(&dir.to_string_lossy());
            }
        }
    }
    // Kayıtlı klasöre artık erişilemiyorsa (izin geri alındı) gezgin boş kalmasın.
    if st.ws().explorer_state().root.is_none() {
        let _ = st.ws().set_explorer_root(&notes.to_string_lossy());
    }
    file
}

#[cfg(mobile)]
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let notes = app.path().app_data_dir()?.join("Notlar");
    let settings = mdflow_core::settings::Settings::at(app.path().app_config_dir()?.join("settings.json"));
    seed_notes(&notes);
    let state = AppState::new(settings);
    let file = prepare(&state, &notes);
    app.manage(state);
    app.manage(crate::startup::InitialFile::new(file.map(|p| p.to_string_lossy().into_owned())));
    app.manage(crate::startup::NotesDir(Some(notes)));
    crate::start_sync(app.handle());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mdflow_core::settings::Settings;
    use tempfile::TempDir;

    fn setup() -> (TempDir, AppState, PathBuf) {
        let t = TempDir::new().unwrap();
        let st = AppState::new(Settings::at(t.path().join("cfg").join("settings.json")));
        let notes = t.path().join("Notlar");
        (t, st, notes)
    }

    #[test]
    fn first_run_seeds_notes_and_opens_welcome() {
        let (_t, st, notes) = setup();
        seed_notes(&notes);
        assert_eq!(prepare(&st, &notes), Some(notes.join(WELCOME_NAME)));
        assert_eq!(st.ws().explorer_state().root, Some(notes.to_string_lossy().into_owned()));
        assert!(notes.join("Günlük.md").is_file());
    }

    #[test]
    fn seed_does_not_restore_deleted_examples() {
        let (_t, st, notes) = setup();
        seed_notes(&notes);
        std::fs::remove_file(notes.join(WELCOME_NAME)).unwrap();
        seed_notes(&notes);
        assert!(!notes.join(WELCOME_NAME).exists());
        assert_eq!(prepare(&st, &notes), None);
        assert_eq!(st.ws().explorer_state().root, Some(notes.to_string_lossy().into_owned()));
    }

    #[test]
    fn reopens_last_note_inside_last_folder() {
        let (t, st, notes) = setup();
        seed_notes(&notes);
        let vault = t.path().join("vault");
        let note = vault.join("sub").join("c.md");
        std::fs::create_dir_all(note.parent().unwrap()).unwrap();
        std::fs::write(&note, "# c").unwrap();
        st.settings.remember_recent(RecentKind::Folder, &vault);
        st.settings.remember_recent(RecentKind::File, &note);

        assert_eq!(prepare(&st, &notes), Some(note.clone()));
        assert_eq!(st.ws().root, Some(vault.join("sub")));
        assert_eq!(st.ws().explorer_state().root, Some(vault.to_string_lossy().into_owned()));
    }
}
