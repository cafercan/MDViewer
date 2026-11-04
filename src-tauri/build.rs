/// Uygulamanın kendi IPC komutları. AppManifest'te bildirilir; her biri bir
/// `allow-<komut>` izni alır ve capabilities/default.json yalnız bunları
/// ana pencereye verir. main.rs `generate_handler!` listesiyle aynı olmalı.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build script failed")
}
