#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! MD Flow Viewer — masaüstü giriş noktası (Tauri 2).
mod api;
mod asset;
mod commands;

/// Paketlenmiş uygulamanın CI denemesi (`--selftest`): pencere açmadan
/// arayüz dosyaları ikiliye gömülmüş mü bakar.
fn selftest(context: &tauri::Context<tauri::Wry>) -> i32 {
    let ok = context.assets().get(&"index.html".into()).is_some();
    println!("selftest: arayüz={}", if ok { "tamam" } else { "YOK" });
    if ok { 0 } else { 1 }
}

use tauri::Manager;

fn main() {
    let context = tauri::generate_context!();
    if std::env::args().skip(1).any(|a| a == "--selftest") {
        std::process::exit(selftest(&context));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("mdasset", |ctx, request| {
            let state = ctx.app_handle().state::<api::AppState>();
            let ws = state.ws();
            asset::handle(&ws, &request)
        })
        .manage(api::AppState::new(mdflow_core::settings::Settings::default_location()))
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
        ])
        .run(context)
        .expect("MD Flow Viewer başlatılamadı");
}
