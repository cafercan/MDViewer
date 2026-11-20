#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! MD Flow Viewer — masaüstü giriş noktası. Uygulamanın kendisi `lib.rs`
//! içindedir; Android aynı `run()` fonksiyonunu kitaplık olarak çağırır.
fn main() {
    mdflowviewer_lib::run()
}
