/// Uygulamanın kendi IPC komutları. AppManifest'te bildirilir; her biri bir
/// `allow-<komut>` izni alır ve capabilities/default.json yalnız bunları
/// ana pencereye verir. main.rs `generate_handler!` listesiyle aynı olmalı.
const COMMANDS: &[&str] = &[
    "content",
    "save",
    "get_settings",
    "set_settings",
    "open_file",
    "open_file_path",
    "open_folder",
    "open_folder_path",
    "recent_list",
    "clear_recent_list",
    "explorer_state",
    "list_dir",
    "explorer_up",
    "explorer_enter",
    "set_vault",
    "resolve_wikilink",
    "inspect_path",
    "print_page",
    "open_external",
    "open_path",
    "open_in_file_manager",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build script failed")
}
