//! MD Flow Viewer — uygulama (Tauri 2). Masaüstünde `main.rs`, Android'de
//! `MainActivity` bu kitaplıktaki `run()` fonksiyonunu çağırır.
mod api;
mod asset;
mod commands;
mod drop;
#[cfg(any(mobile, test))]
mod mobile;
mod nav;
mod startup;
mod sync;
mod update;
mod watch;

use tauri::{Emitter, Manager};

/// Paketlenmiş uygulamanın CI denemesi (`--selftest`): pencere açmadan
/// arayüz dosyaları ikiliye gömülmüş mü bakar.
#[cfg(desktop)]
fn selftest(context: &tauri::Context<tauri::Wry>) -> i32 {
    let ok = context.assets().get(&"index.html".into()).is_some();
    println!("selftest: arayüz={}", if ok { "tamam" } else { "YOK" });
    if ok {
        0
    } else {
        1
    }
}

#[cfg(desktop)]
fn home_dir() -> std::path::PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
}

/// Masaüstü açılışı: komut satırındaki belge, ayar dosyası, pencere konumu,
/// sürükle-bırak.
#[cfg(desktop)]
fn platform(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let file = startup::file_arg(std::env::args());
    let state = api::AppState::new(mdflow_core::settings::Settings::default_location());
    startup::prepare(&state, file.as_deref(), &home_dir());
    let initial = startup::InitialFile::new(file.map(|p| p.to_string_lossy().into_owned()));

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_window_event(drop::on_window_event)
        .manage(state)
        .manage(initial)
        .manage(startup::NotesDir(None))
}

/// Android açılışı: yollar ancak uygulama kurulunca bilinir (bkz. mobile.rs).
#[cfg(mobile)]
fn platform(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.setup(|app| mobile::setup(app))
}

/// Eşitleme durumu ayar dosyasının yanında durur; açık bırakıldıysa dinleme başlar.
fn start_sync(app: &tauri::AppHandle) {
    let settings = app.state::<api::AppState>().settings.path().to_path_buf();
    let handle = app.clone();
    let state = sync::SyncState::new(settings.with_file_name("sync.json"), sync::PORT, move |kind| {
        let _ = handle.emit("sync-event", serde_json::json!({"kind": kind}));
    });
    app.manage(state.clone());
    std::thread::spawn(move || state.resume());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(desktop)]
    if std::env::args().skip(1).any(|a| a == "--selftest") {
        std::process::exit(selftest(&context));
    }

    // GNOME/KDE pencereyi .desktop girişiyle eşleştirsin (StartupWMClass).
    #[cfg(target_os = "linux")]
    gtk::glib::set_prgname(Some("mdflowviewer"));

    let builder = tauri::Builder::default()
        .plugin(nav::plugin())
        // Görsel okuma arayüz iş parçacığını bekletmesin: ayrı iş parçacığında yanıtla
        .register_asynchronous_uri_scheme_protocol("mdasset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let ws = app.state::<api::AppState>().snapshot();
                responder.respond(asset::handle(&ws, &request));
            });
        })
        .manage(watch::WatchState::default())
        .manage(update::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            commands::content,
            commands::save,
            commands::get_settings,
            commands::set_settings,
            commands::open_file,
            commands::open_file_path,
            commands::open_folder,
            commands::open_folder_path,
            commands::recent_list,
            commands::clear_recent_list,
            commands::explorer_state,
            commands::list_dir,
            commands::explorer_up,
            commands::explorer_enter,
            commands::set_vault,
            commands::resolve_wikilink,
            commands::inspect_path,
            commands::list_notes,
            commands::create_note,
            commands::print_page,
            commands::open_external,
            commands::open_path,
            commands::open_in_file_manager,
            commands::watch_file,
            commands::unwatch_file,
            commands::initial_file,
            commands::notes_dir,
            commands::search_notes,
            commands::backlinks,
            commands::rename_note,
            commands::trash_note,
            commands::create_folder,
            commands::rename_folder,
            commands::trash_folder,
            commands::move_entry,
            commands::update_info,
            commands::update_check,
            commands::update_download,
            commands::update_install,
            commands::sync_status,
            commands::sync_host,
            commands::sync_pick_folder,
            commands::sync_pair_start,
            commands::sync_pair_stop,
            commands::sync_remove_peer,
            commands::sync_discover,
            commands::sync_pair,
            commands::sync_set_link,
            commands::sync_unlink,
            commands::sync_now,
            commands::sync_busy,
        ]);

    let app = platform(builder).build(context).expect("MD Flow Viewer başlatılamadı");
    #[cfg(desktop)]
    start_sync(app.handle());

    app.run(|_app, _event| {
        // macOS Finder "Birlikte Aç" dosyayı argüman değil olay olarak verir.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                commands::deliver_opened_file(_app, path);
            }
        }
    });
}
