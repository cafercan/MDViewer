//! Gezinme koruması: webview yalnız uygulamanın kendi sayfasında kalır.
//! Belgedeki bir bağlantı ya da sürüklenen URL pencereyi uzak bir sayfaya
//! götüremez; http(s)/mailto sistem tarayıcısına devredilir.
use tauri::Url;

/// Uygulamanın kendi kökü: `tauri://localhost` (macOS/Linux),
/// `http(s)://tauri.localhost` (Windows/WebView2) ya da `about:blank`.
pub fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        "about" => url.path() == "blank",
        _ => false,
    }
}

/// `on_navigation` kancası: uygulama içi → izin; değilse dış bağlantıyı
/// tarayıcıda açmayı dener ve gezinmeyi reddeder.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("nav-guard")
        .on_navigation(|_webview, url| {
            if is_app_url(url) {
                return true;
            }
            crate::api::open_external(url.as_str(), &|u| opener::open_browser(u).is_ok());
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str) -> bool {
        is_app_url(&Url::parse(s).unwrap())
    }

    #[test]
    fn app_urls_are_allowed() {
        assert!(ok("tauri://localhost/index.html"));
        assert!(ok("http://tauri.localhost/"));
        assert!(ok("https://tauri.localhost/index.html?file=a"));
        assert!(ok("about:blank"));
    }

    #[test]
    fn foreign_urls_are_refused() {
        assert!(!ok("https://evil.example/"));
        assert!(!ok("file:///C:/x.html"));
        assert!(!ok("http://tauri.localhost.evil.example/"));
        assert!(!ok("tauri://evil/"));
        assert!(!ok("http://mdasset.localhost/C%3A%2Fa.png"));
    }
}
