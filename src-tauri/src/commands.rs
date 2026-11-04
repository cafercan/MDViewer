//! `#[tauri::command]` sarmalayıcıları: yalnız `api` gövdelerini çağırır.
//! Adlar 2.x JsApi metotlarıyla aynı; JS'ten parametreler camelCase gelir.
//!
//! Senkron komutlar arayüz (ana) iş parçacığında koşar; diske dokunan her
//! komut bu yüzden async'tir ve gövdesini `off_main` ile ayrı iş parçacığında
//! çalıştırır (büyük belge, yavaş disk ya da kökün tamamında wikilink araması
//! pencereyi dondurmasın).
use crate::api::{self, AppState};
use crate::startup::InitialFile;
use crate::watch::{FileWatcher, WatchState};
use mdflow_core::workspace::ExplorerState;
use serde_json::Value;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

/// Komut gövdesini engelleyici iş parçacığında çalıştırır.
async fn off_main<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppState) -> T + Send + 'static) -> T {
    match tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>())).await {
        Ok(v) => v,
        Err(e) => std::panic::resume_unwind(Box::new(e.to_string())),
    }
}

// --- belge ------------------------------------------------------------------

#[tauri::command]
pub async fn content(app: AppHandle, file: Option<String>) -> Value {
    off_main(app, move |st| api::content(st, file.as_deref())).await
}

#[tauri::command]
pub async fn save(app: AppHandle, path: String, content: String) -> Value {
    off_main(app, move |st| api::save(st, &path, &content)).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Value {
    off_main(app, api::get_settings).await
}

#[tauri::command]
pub async fn set_settings(app: AppHandle, patch: Value) -> Value {
    off_main(app, move |st| api::set_settings(st, patch)).await
}

// --- dosya / klasör açma ---------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

type Picked = Pin<Box<dyn Future<Output = Option<rfd::FileHandle>> + Send>>;

/// Native dosya/klasör seçici (rfd). Diyalog ana iş parçacığında kurulur
/// (macOS bunu şart koşar), sonucu burada beklenir. tauri-plugin-dialog
/// kullanılmaz: o eklenti window.confirm/alert'i async bir sürümle değiştirir
/// ve arayüzün "kaydedilmemiş değişiklik" soruları sessizce geçilir.
async fn pick(app: &AppHandle, folder: bool, start: Option<PathBuf>) -> Option<PathBuf> {
    let (tx, rx) = std::sync::mpsc::channel::<Picked>();
    let window = main_window(app);
    app.run_on_main_thread(move || {
        let mut d = rfd::AsyncFileDialog::new();
        if !folder {
            d = d.add_filter("Markdown", &["md", "markdown"]).add_filter("Tüm dosyalar", &["*"]);
        }
        if let Some(dir) = start {
            d = d.set_directory(dir);
        }
        if let Some(w) = &window {
            d = d.set_parent(w);
        }
        let fut: Picked = if folder { Box::pin(d.pick_folder()) } else { Box::pin(d.pick_file()) };
        let _ = tx.send(fut);
    })
    .ok()?;
    let fut = tauri::async_runtime::spawn_blocking(move || rx.recv().ok()).await.ok()??;
    fut.await.map(|h| h.path().to_path_buf())
}

/// Dosya seçme penceresi son kullanılan klasörde açılır; seçilen dosyanın
/// klasörü yeni belge kökü olur. İptal → None.
#[tauri::command]
pub async fn open_file(app: AppHandle) -> Option<String> {
    let start = app.state::<AppState>().settings.last_dir();
    let picked = pick(&app, false, start).await?;
    off_main(app, move |st| api::open_file_path(st, &picked.to_string_lossy())).await
}

#[tauri::command]
pub async fn open_file_path(app: AppHandle, path: String) -> Option<String> {
    off_main(app, move |st| api::open_file_path(st, &path)).await
}

/// Klasör seçme penceresi; seçilen klasör çalışma alanı olur.
#[tauri::command]
pub async fn open_folder(app: AppHandle) -> Option<Value> {
    let start = {
        let state = app.state::<AppState>();
        state
            .settings
            .get_recent(mdflow_core::settings::RecentKind::Folder)
            .into_iter()
            .next()
            .map(PathBuf::from)
            .or_else(|| state.settings.last_dir())
    };
    let picked = pick(&app, true, start).await?;
    off_main(app, move |st| api::open_folder_path(st, &picked.to_string_lossy())).await
}

#[tauri::command]
pub async fn open_folder_path(app: AppHandle, path: String) -> Option<Value> {
    off_main(app, move |st| api::open_folder_path(st, &path)).await
}

#[tauri::command]
pub async fn recent_list(app: AppHandle) -> Value {
    off_main(app, api::recent_list).await
}

#[tauri::command]
pub async fn clear_recent_list(app: AppHandle, kind: String) -> Value {
    off_main(app, move |st| api::clear_recent_list(st, &kind)).await
}

// --- gezgin --------------------------------------------------------------------

#[tauri::command]
pub fn explorer_state(state: State<'_, AppState>) -> ExplorerState {
    api::explorer_state(&state)
}

#[tauri::command]
pub async fn list_dir(app: AppHandle, path: String) -> Value {
    off_main(app, move |st| api::list_dir(st, &path)).await
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
pub async fn resolve_wikilink(app: AppHandle, target: String, current_file: Option<String>) -> Option<String> {
    off_main(app, move |st| api::resolve_wikilink(st, &target, current_file.as_deref())).await
}

#[tauri::command]
pub async fn inspect_path(app: AppHandle, path: String) -> Value {
    off_main(app, move |st| api::inspect_path(st, &path)).await
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
pub async fn open_path(app: AppHandle, path: String) -> bool {
    off_main(app, move |st| api::open_confined(st, &path, false, &system_open)).await
}

/// Klasörü sistemin dosya yöneticisinde açar (Ctrl+tık); kök dışı reddedilir.
#[tauri::command]
pub async fn open_in_file_manager(app: AppHandle, path: String) -> bool {
    off_main(app, move |st| api::open_confined(st, &path, true, &system_open)).await
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

// --- açılış belgesi --------------------------------------------------------------------

/// Arayüzün açılışta bir kez sorduğu belge (komut satırı ya da macOS olayı).
#[tauri::command]
pub fn initial_file(initial: State<'_, InitialFile>) -> Option<String> {
    initial.take()
}

/// macOS "Birlikte Aç": arayüz henüz sormadıysa açılış belgesi olur (kök onun
/// klasörü), sorduysa `open-file` olayıyla arayüze iletilir.
#[allow(dead_code)] // yalnız macOS'ta çağrılır
pub fn deliver_opened_file(app: &AppHandle, path: PathBuf) {
    let shown = path.to_string_lossy().into_owned();
    match app.state::<InitialFile>().offer(shown.clone()) {
        None => crate::startup::prepare(&app.state::<AppState>(), Some(&path), &path),
        Some(p) => {
            let _ = app.emit("open-file", serde_json::json!({"path": p}));
        }
    }
}

#[cfg(test)]
mod tests {
    /// tauri-plugin-dialog her pencereye window.confirm/alert'i async invoke
    /// ile değiştiren bir betik enjekte eder: confirm() Promise döner (hep
    /// "doğru"), kaydedilmemiş değişiklik soruları sessizce geçilir. Dosya
    /// diyalogları bu yüzden doğrudan rfd ile açılır.
    #[test]
    fn no_plugin_replaces_window_confirm() {
        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest.contains("tauri-plugin-dialog"), "tauri-plugin-dialog window.confirm'u bozar");
    }
}
