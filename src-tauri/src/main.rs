#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! MD Flow Viewer — masaüstü giriş noktası (Tauri 2).
mod api;
mod asset;
mod commands;
mod drop;
mod nav;
mod startup;
mod watch;

use std::path::PathBuf;
use tauri::Manager;

/// Paketlenmiş uygulamanın CI denemesi (`--selftest`): pencere açmadan
/// arayüz dosyaları ikiliye gömülmüş mü bakar.
fn selftest(context: &tauri::Context<tauri::Wry>) -> i32 {
    let ok = context.assets().get(&"index.html".into()).is_some();
    println!("selftest: arayüz={}", if ok { "tamam" } else { "YOK" });
    if ok {
        0
    } else {
        1
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn main() {
    let context = tauri::generate_context!();
    if std::env::args().skip(1).any(|a| a == "--selftest") {
        std::process::exit(selftest(&context));
    }

    // GNOME/KDE pencereyi .desktop girişiyle eşleştirsin (StartupWMClass).
    #[cfg(target_os = "linux")]
    gtk::glib::set_prgname(Some("mdflowviewer"));

    let file = startup::file_arg(std::env::args());
    let state = api::AppState::new(mdflow_core::settings::Settings::default_location());
    startup::prepare(&state, file.as_deref(), &home_dir());
    let initial = startup::InitialFile::new(file.map(|p| p.to_string_lossy().into_owned()));

    let app = tauri::Builder::default()
.plugin(nav::plugin())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_window_event(drop::on_window_event)
        // Görsel okuma arayüz iş parçacığını bekletmesin: ayrı iş parçacığında yanıtla
        .register_asynchronous_uri_scheme_protocol("mdasset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let ws = app.state::<api::AppState>().snapshot();
                responder.respond(asset::handle(&ws, &request));
            });
        })
        .manage(watch::WatchState::default())
        .manage(state)
        .manage(initial)
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
            commands::print_page,
            commands::open_external,
            commands::open_path,
            commands::open_in_file_manager,
            commands::watch_file,
            commands::unwatch_file,
            commands::initial_file,
        ])
        .build(context)
        .expect("MD Flow Viewer başlatılamadı");

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
