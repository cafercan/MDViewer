//! `#[tauri::command]` sarmalayıcıları: yalnız `api` gövdelerini çağırır.
//! Adlar 2.x JsApi metotlarıyla aynı; JS'ten parametreler camelCase gelir.
use crate::api::{self, AppState};
use mdflow_core::workspace::ExplorerState;
use serde_json::Value;
use std::path::{Path, PathBuf};
use crate::watch::{FileWatcher, WatchState};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

// --- belge ------------------------------------------------------------------

#[tauri::command]
pub fn content(state: State<'_, AppState>, file: Option<String>) -> Value {
    api::content(&state, file.as_deref())
}

#[tauri::command]
pub fn save(state: State<'_, AppState>, path: String, content: String) -> Value {
    api::save(&state, &path, &content)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Value {
    api::get_settings(&state)
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, patch: Value) -> Value {
    api::set_settings(&state, patch)
}

// --- dosya / klasör açma ---------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Dosya seçme penceresi son kullanılan klasörde açılır; seçilen dosyanın
/// klasörü yeni belge kökü olur. İptal → None. Diyalog ana iş parçacığını
/// kilitlemesin diye komut async.
#[tauri::command]
pub async fn open_file(app: AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Tüm dosyalar", &["*"]);
    if let Some(dir) = state.settings.last_dir() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(w) = main_window(&app) {
        dialog = dialog.set_parent(&w);
    }
    let picked: PathBuf = dialog.blocking_pick_file()?.into_path().ok()?;
    api::open_file_path(&state, &picked.to_string_lossy())
}

#[tauri::command]
pub fn open_file_path(state: State<'_, AppState>, path: String) -> Option<String> {
    api::open_file_path(&state, &path)
}

/// Klasör seçme penceresi; seçilen klasör çalışma alanı olur.
#[tauri::command]
pub async fn open_folder(app: AppHandle) -> Option<Value> {
    let state = app.state::<AppState>();
    let start = state
        .settings
        .get_recent(mdflow_core::settings::RecentKind::Folder)
        .into_iter()
        .next()
        .map(PathBuf::from)
        .or_else(|| state.settings.last_dir());
    let mut dialog = app.dialog().file();
    if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
    }
    if let Some(w) = main_window(&app) {
        dialog = dialog.set_parent(&w);
    }
    let picked: PathBuf = dialog.blocking_pick_folder()?.into_path().ok()?;
    api::open_folder_path(&state, &picked.to_string_lossy())
}

#[tauri::command]
pub fn open_folder_path(state: State<'_, AppState>, path: String) -> Option<Value> {
    api::open_folder_path(&state, &path)
}

#[tauri::command]
pub fn recent_list(state: State<'_, AppState>) -> Value {
    api::recent_list(&state)
}

#[tauri::command]
pub fn clear_recent_list(state: State<'_, AppState>, kind: String) -> Value {
    api::clear_recent_list(&state, &kind)
}

// --- gezgin --------------------------------------------------------------------

#[tauri::command]
pub fn explorer_state(state: State<'_, AppState>) -> ExplorerState {
    api::explorer_state(&state)
}

#[tauri::command]
pub fn list_dir(state: State<'_, AppState>, path: String) -> Value {
    api::list_dir(&state, &path)
}

#[tauri::command]
pub fn explorer_up(state: State<'_, AppState>) -> ExplorerState {
    api::explorer_up(&state)
}

#[tauri::command]
pub fn explorer_enter(state: State<'_, AppState>, path: String) -> ExplorerState {
    api::explorer_enter(&state, &path)
}

#[tauri::command]
pub fn set_vault(state: State<'_, AppState>, path: Option<String>) -> ExplorerState {
    api::set_vault(&state, path.as_deref())
}

#[tauri::command]
pub fn resolve_wikilink(state: State<'_, AppState>, target: String, current_file: Option<String>) -> Option<String> {
    api::resolve_wikilink(&state, &target, current_file.as_deref())
}

#[tauri::command]
pub fn inspect_path(state: State<'_, AppState>, path: String) -> Value {
    api::inspect_path(&state, &path)
}

// --- yazdırma / dışarıda açma -------------------------------------------------------

/// Linux (WebKitGTK): `window.print()` sessizce yok sayıldığı için yazdırma
/// diyaloğu buradan açılır. Diğer platformlarda false → arayüz `window.print()`.
#[tauri::command]
pub fn print_page(window: WebviewWindow) -> bool {
    #[cfg(target_os = "linux")]
    {
        window.print().is_ok()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        false
    }
}

#[tauri::command]
pub fn open_external(url: String) -> bool {
    api::open_external(&url, &|u| opener::open_browser(u).is_ok())
}

fn system_open(p: &Path) -> std::io::Result<()> {
    opener::open(p).map_err(std::io::Error::other)
}

/// Yerel dosyayı (md dışı) varsayılan uygulamasında açar; kök dışı reddedilir.
#[tauri::command]
pub fn open_path(state: State<'_, AppState>, path: String) -> bool {
    api::open_confined(&state, &path, false, &system_open)
}

/// Klasörü sistemin dosya yöneticisinde açar (Ctrl+tık); kök dışı reddedilir.
#[tauri::command]
pub fn open_in_file_manager(state: State<'_, AppState>, path: String) -> bool {
    api::open_confined(&state, &path, true, &system_open)
}

// --- canlı yenileme ------------------------------------------------------------------

/// Belgeyi izlemeye başlar; değişimde `file-changed` olayı (`{"file": yol}`).
/// Önceki izleyicinin yerini alır.
#[tauri::command]
pub fn watch_file(app: AppHandle, state: State<'_, AppState>, watch: State<'_, WatchState>, path: String) -> Value {
    let abs = match api::watch_target(&state, &path) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let own = app.clone();
    let emit = app.clone();
    let started = FileWatcher::start(
        abs,
        move |p, h| api::is_own_write(&own.state::<AppState>(), p, h),
        move |p| {
            let _ = emit.emit("file-changed", serde_json::json!({"file": p.to_string_lossy()}));
        },
    );
    let mut slot = watch.0.lock().unwrap_or_else(|e| e.into_inner());
    match started {
        Ok(w) => {
            *slot = Some(w);
            serde_json::json!({"success": true})
        }
        Err(e) => {
            *slot = None;
            serde_json::json!({"success": false, "error": e.to_string()})
        }
    }
}

#[tauri::command]
pub fn unwatch_file(watch: State<'_, WatchState>) {
    *watch.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
}
