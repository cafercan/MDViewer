#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! MD Flow Viewer — masaüstü giriş noktası (Tauri 2).

/// Paketlenmiş uygulamanın CI denemesi (`--selftest`): pencere açmadan
/// arayüz dosyaları ikiliye gömülmüş mü bakar.
fn selftest(context: &tauri::Context<tauri::Wry>) -> i32 {
    let ok = context.assets().get(&"index.html".into()).is_some();
    println!("selftest: arayüz={}", if ok { "tamam" } else { "YOK" });
    if ok { 0 } else { 1 }
}

fn main() {
    let context = tauri::generate_context!();
    if std::env::args().skip(1).any(|a| a == "--selftest") {
        std::process::exit(selftest(&context));
    }
    tauri::Builder::default()
        .run(context)
        .expect("MD Flow Viewer başlatılamadı");
}
