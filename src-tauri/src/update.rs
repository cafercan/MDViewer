//! Kendi kendini güncelleme. Son sürüm GitHub Releases'ten sorulur, bu kuruluma
//! uyan paket indirilir, SHA-256 özeti doğrulanır ve sistemin kendi kurulum
//! yoluyla kurulur:
//!   Windows : Inno Setup (sessiz; kurulum uygulamayı yeniden açar)
//!   macOS   : .dmg içindeki .app, çalışanın yerine konur
//!   Linux   : pkexec ile apt / dnf / zypper / pacman
//!   Android : APK'yı MainActivity sistem kurulumuna verir
//! Paketi olmayan kurulum (kaynaktan derleme, AUR `mdflowviewer`) yalnız haber alır.
//!
//! Arayüz hiçbir adres ya da yol veremez: adres sabittir, kurulan dosya burada
//! doğrulanan dosyadır.
use mdflow_core::update::{self, Asset, PackageKind};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const RELEASES: &str = "https://github.com/cafercan/MDViewer/releases";
const SUMS_LIMIT: u64 = 64 * 1024;
const PACKAGE_LIMIT: u64 = 300 * 1024 * 1024;

#[derive(Default)]
pub struct UpdateState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    /// Son denetimde bulunan paket.
    asset: Option<Asset>,
    /// İndirilip doğrulanmış paket.
    ready: Option<(Asset, PathBuf)>,
    /// İndirme ya da kurulum sürüyor (ikincisi başlamasın).
    busy: bool,
}

impl UpdateState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Aynı anda tek indirme/kurulum; iş bitince (hata dahil) işaret kalkar.
struct Busy<'a>(&'a UpdateState);

impl<'a> Busy<'a> {
    fn take(st: &'a UpdateState) -> Result<Busy<'a>, String> {
        let mut g = st.lock();
        if g.busy {
            return Err("Güncelleme zaten sürüyor.".into());
        }
        g.busy = true;
        drop(g);
        Ok(Busy(st))
    }
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.lock().busy = false;
    }
}

/// Geliştirme sırasında denemek için; yayın derlemesinde yok sayılır.
fn debug_env(name: &str) -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var(name).ok().filter(|v| !v.is_empty())
    } else {
        None
    }
}

fn releases_base() -> String {
    debug_env("MDFLOW_UPDATE_BASE").unwrap_or_else(|| RELEASES.into())
}

fn current_version() -> String {
    debug_env("MDFLOW_UPDATE_VERSION").unwrap_or_else(|| env!("CARGO_PKG_VERSION").into())
}

// --- kurulum türü -----------------------------------------------------------

#[cfg(target_os = "linux")]
fn detect() -> Option<PackageKind> {
    use std::process::Command;
    if let Some(k) = debug_env("MDFLOW_UPDATE_KIND") {
        return match k.as_str() {
            "deb" => Some(PackageKind::Deb),
            "rpm" => Some(PackageKind::Rpm),
            "pacman" => Some(PackageKind::Pacman),
            _ => None,
        };
    }
    // Paketler yalnız x86_64; ikiliyi hangi paket yöneticisi kurduysa o günceller.
    if !cfg!(target_arch = "x86_64") || installed_exe()? != Path::new("/usr/bin/mdflowviewer") {
        return None;
    }
    let owner = |cmd: &str, args: &[&str]| -> Option<String> {
        let out = Command::new(cmd).args(args).arg("/usr/bin/mdflowviewer").output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    if owner("pacman", &["-Qqo"]).as_deref() == Some("mdflowviewer-bin") {
        Some(PackageKind::Pacman)
    } else if owner("dpkg-query", &["-S"]).is_some_and(|o| o.starts_with("mdflowviewer:")) {
        Some(PackageKind::Deb)
    } else if owner("rpm", &["-qf", "--qf", "%{NAME}"]).as_deref() == Some("mdflowviewer") {
        Some(PackageKind::Rpm)
    } else {
        None
    }
}

/// Paket güncellenince /proc/self/exe "… (deleted)" olur; takı atılır.
#[cfg(target_os = "linux")]
fn installed_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let s = exe.to_string_lossy();
    Some(PathBuf::from(s.strip_suffix(" (deleted)").unwrap_or(&s)))
}

#[cfg(windows)]
fn detect() -> Option<PackageKind> {
    // Yalnız kurulumla gelen kopya (kaldırıcısı yanında durur).
    let exe = std::env::current_exe().ok()?;
    exe.with_file_name("unins000.exe").is_file().then_some(PackageKind::Windows)
}

#[cfg(target_os = "macos")]
fn detect() -> Option<PackageKind> {
    (cfg!(target_arch = "aarch64") && app_bundle().is_some()).then_some(PackageKind::MacArm64)
}

/// Çalışan `.app`. DMG'nin içinden ya da karantina kopyasından (AppTranslocation)
/// çalışıyorsa yerine konacak bir kurulum yoktur.
#[cfg(target_os = "macos")]
fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))?;
    let s = app.to_string_lossy();
    (!s.starts_with("/Volumes/") && !s.contains("/AppTranslocation/")).then(|| app.to_path_buf())
}

#[cfg(target_os = "android")]
fn detect() -> Option<PackageKind> {
    Some(PackageKind::Android)
}

#[cfg(target_os = "ios")]
fn detect() -> Option<PackageKind> {
    None
}

// --- ağ -------------------------------------------------------------------------

fn get(url: &str, body_timeout: Duration) -> Result<ureq::http::Response<ureq::Body>, String> {
    let config = ureq::Agent::config_builder()
        .https_only(debug_env("MDFLOW_UPDATE_BASE").is_none())
        .user_agent("mdflowviewer")
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(Some(body_timeout))
        .build();
    ureq::Agent::new_with_config(config).get(url).call().map_err(|e| match e {
        ureq::Error::StatusCode(404) => "404".to_string(),
        e => format!("Sunucuya ulaşılamadı: {e}"),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn file_sha256(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match f.read(&mut buf)? {
            0 => return Ok(hex(&h.finalize())),
            n => h.update(&buf[..n]),
        }
    }
}

/// `src`'yi `dest`e yazar; özet tutmazsa dosya bırakılmaz.
fn write_verified(
    src: &mut dyn Read,
    dest: &Path,
    sha256: &str,
    progress: &mut dyn FnMut(u64),
) -> Result<(), String> {
    let part = dest.with_extension("part");
    let result = (|| -> Result<(), String> {
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut h = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut done = 0u64;
        loop {
            let n = src.read(&mut buf).map_err(|e| format!("İndirme yarıda kaldı: {e}"))?;
            if n == 0 {
                break;
            }
            done += n as u64;
            if done > PACKAGE_LIMIT {
                return Err("İndirilen paket beklenenden büyük.".into());
            }
            h.update(&buf[..n]);
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            progress(done);
        }
        out.sync_all().map_err(|e| e.to_string())?;
        drop(out);
        if hex(&h.finalize()) != sha256 {
            return Err("İndirilen paket doğrulanamadı (SHA-256 uyuşmuyor).".into());
        }
        std::fs::rename(&part, dest).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates"))
}

// --- komut gövdeleri (arayüz iş parçacığı dışında çalışır) ------------------------

/// Ağa çıkmadan bilinenler. `auto`: açılışta kendiliğinden denetlensin mi
/// (geliştirme derlemesinde hayır).
pub fn info() -> Value {
    json!({
        "version": current_version(),
        "canInstall": detect().is_some(),
        "auto": !cfg!(debug_assertions) || debug_env("MDFLOW_UPDATE_BASE").is_some(),
        "page": format!("{RELEASES}/latest"),
    })
}

pub fn check(app: &AppHandle) -> Value {
    let fail = |e: String| json!({"success": false, "error": e});
    let current = current_version();
    let url = format!("{}/latest/download/SHA256SUMS.txt", releases_base());
    let sums = match get(&url, Duration::from_secs(30)) {
        Ok(mut r) => match r.body_mut().with_config().limit(SUMS_LIMIT).read_to_string() {
            Ok(t) => t,
            Err(e) => return fail(format!("Sürüm bilgisi okunamadı: {e}")),
        },
        // Yeni release yayınlandı ama paketleri henüz yükleniyor.
        Err(e) if e == "404" => String::new(),
        Err(e) => return fail(e),
    };
    let kind = detect();
    let asset = kind.and_then(|k| update::find_asset(&sums, k)).filter(|a| update::is_newer(&a.version, &current));
    let version = match kind {
        Some(_) => asset.as_ref().map(|a| a.version.clone()),
        None => update::latest_version(&sums).filter(|v| update::is_newer(v, &current)),
    };

    let state = app.state::<UpdateState>();
    let mut g = state.lock();
    // Güncelleme kalmadı: önceki sürümden kalan paket diskte durmasın.
    if asset.is_none() && !g.busy {
        g.ready = None;
        if let Ok(dir) = updates_dir(app) {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    g.asset = asset;
    let ready = matches!((&g.ready, &g.asset), (Some((r, _)), Some(a)) if r == a);
    json!({
        "success": true,
        "current": current,
        "version": version,
        "canInstall": g.asset.is_some(),
        "ready": ready,
        "notes": version.as_ref().map(|v| format!("{RELEASES}/tag/v{v}")),
    })
}

/// Son denetimde bulunan paketi indirir; `update-progress` olayı `{done, total}`.
pub fn download(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<UpdateState>();
    let _busy = Busy::take(&state)?;
    let asset = state.lock().asset.clone().ok_or("İndirilecek güncelleme yok.")?;
    let dir = updates_dir(app)?;
    let dest = dir.join(&asset.name);

    // Önceki açılışta indirilmişse yeniden indirilmez.
    if !file_sha256(&dest).is_ok_and(|s| s == asset.sha256) {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let url = format!("{}/download/v{}/{}", releases_base(), asset.version, asset.name);
        let mut res = get(&url, Duration::from_secs(30 * 60))?;
        let total = res.body().content_length().unwrap_or(0);
        let mut last = 0;
        let mut reader = res.body_mut().as_reader();
        write_verified(&mut reader, &dest, &asset.sha256, &mut |done| {
            if done - last >= 256 * 1024 || done == total {
                last = done;
                let _ = app.emit("update-progress", json!({"done": done, "total": total}));
            }
        })?;
    }
    state.lock().ready = Some((asset.clone(), dest.clone()));
    Ok(json!({"success": true, "version": asset.version, "path": dest.to_string_lossy()}))
}

/// Doğrulanmış paketi kurar ve uygulamayı (açık belgeyle) yeniden başlatır.
/// Android'de yalnız yeniden doğrulanır; kurulumu MainActivity başlatır.
pub fn install(app: &AppHandle, file: Option<&str>) -> Result<Value, String> {
    let state = app.state::<UpdateState>();
    let _busy = Busy::take(&state)?;
    let (asset, path) = state.lock().ready.clone().ok_or("Önce güncelleme indirilmeli.")?;
    // İndirmeyle kurulum arasında dosya değişmiş olmasın.
    if !file_sha256(&path).is_ok_and(|s| s == asset.sha256) {
        state.lock().ready = None;
        return Err("İndirilen paket bozulmuş; güncelleme yeniden indirilecek.".into());
    }
    let file = file.filter(|f| Path::new(f).is_file());
    platform_install(app, &path, file)?;
    Ok(json!({"success": true, "path": path.to_string_lossy()}))
}

#[cfg(target_os = "linux")]
fn platform_install(app: &AppHandle, package: &Path, file: Option<&str>) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let has = |cmd: &str| Path::new("/usr/bin").join(cmd).is_file();
    let kind = detect().ok_or("Bu kurulum kendini güncelleyemiyor.")?;
    let args: &[&str] = match kind {
        PackageKind::Deb => &["apt-get", "install", "-y"],
        PackageKind::Pacman => &["pacman", "-U", "--noconfirm"],
        PackageKind::Rpm if has("dnf") => &["dnf", "install", "-y"],
        PackageKind::Rpm if has("zypper") => &["zypper", "--non-interactive", "install", "--allow-unsigned-rpm"],
        _ => &["rpm", "-U"],
    };
    let out = Command::new("pkexec")
        .args(args)
        .arg(package)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Yönetici izni sorulamadı (pkexec): {e}"))?;
    if !out.status.success() {
        return Err(match out.status.code() {
            Some(126) => "Kurulum için yönetici izni verilmedi.".into(),
            Some(127) => "Yönetici izni alınamadı (polkit çalışmıyor olabilir).".into(),
            _ => {
                let err = String::from_utf8_lossy(&out.stderr);
                let last = err.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("bilinmeyen hata").trim();
                format!("Paket kurulamadı: {last}")
            }
        });
    }
    let mut next = Command::new(installed_exe().ok_or("Uygulama yolu bulunamadı.")?);
    next.args(file).stdin(Stdio::null());
    next.spawn().map_err(|e| format!("Güncellendi; uygulamayı yeniden açın ({e})."))?;
    app.exit(0);
    Ok(())
}

#[cfg(windows)]
fn platform_install(app: &AppHandle, package: &Path, _file: Option<&str>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain([0]).collect::<Vec<u16>>();
    let exe = wide(package.as_os_str());
    // /RELAUNCH=1: kurulum bitince uygulamayı açan kendi anahtarımız (MDFlowViewer.iss)
    let args = wide("/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /RELAUNCH=1".as_ref());
    // SAFETY: işaretçiler çağrı boyunca yaşayan, sıfırla biten tamponlar.
    let code = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            exe.as_ptr(),
            args.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if code <= 32 {
        return Err(format!("Kurulum başlatılamadı (kod {code})."));
    }
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
fn platform_install(app: &AppHandle, package: &Path, file: Option<&str>) -> Result<(), String> {
    use std::process::Command;
    let run = |cmd: &str, args: &[&std::ffi::OsStr]| -> Result<(), String> {
        let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd}: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        Err(format!("{cmd}: {}", String::from_utf8_lossy(&out.stderr).trim()))
    };
    let target = app_bundle().ok_or("Bu kurulum kendini güncelleyemiyor.")?;
    let parent = target.parent().ok_or("Uygulama klasörü bulunamadı.")?;
    let stage = parent.join(".mdflow-update.app");
    let old = parent.join(".mdflow-old.app");
    let mount = package.with_extension("mnt");
    std::fs::create_dir_all(&mount).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&stage);

    run("hdiutil", &["attach".as_ref(), "-nobrowse".as_ref(), "-readonly".as_ref(), "-mountpoint".as_ref(),
        mount.as_os_str(), package.as_os_str()])?;
    let copied = run("ditto", &[mount.join("MD Flow Viewer.app").as_os_str(), stage.as_os_str()])
        .and_then(|_| run("codesign", &["--verify".as_ref(), "--deep".as_ref(), "--strict".as_ref(), stage.as_os_str()]));
    let _ = run("hdiutil", &["detach".as_ref(), "-force".as_ref(), mount.as_os_str()]);
    if let Err(e) = copied {
        let _ = std::fs::remove_dir_all(&stage);
        return Err(format!("Yeni sürüm kopyalanamadı ({e})."));
    }

    let _ = std::fs::remove_dir_all(&old);
    std::fs::rename(&target, &old).map_err(|e| {
        let _ = std::fs::remove_dir_all(&stage);
        format!("Uygulama değiştirilemedi: {e}")
    })?;
    if let Err(e) = std::fs::rename(&stage, &target) {
        let _ = std::fs::rename(&old, &target);
        let _ = std::fs::remove_dir_all(&stage);
        return Err(format!("Uygulama değiştirilemedi: {e}"));
    }
    let _ = std::fs::remove_dir_all(&old);

    let mut next = Command::new("open");
    next.arg("-n").arg(&target);
    if let Some(f) = file {
        next.arg("--args").arg(f);
    }
    next.spawn().map_err(|e| format!("Güncellendi; uygulamayı yeniden açın ({e})."))?;
    app.exit(0);
    Ok(())
}

#[cfg(mobile)]
fn platform_install(_app: &AppHandle, _package: &Path, _file: Option<&str>) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn verified_download_is_kept() {
        let t = TempDir::new().unwrap();
        let dest = t.path().join("p.deb");
        let mut seen = 0;
        write_verified(&mut &b"abc"[..], &dest, ABC, &mut |n| seen = n).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"abc");
        assert_eq!(file_sha256(&dest).unwrap(), ABC);
        assert_eq!(seen, 3);
        assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 1);
    }

    #[test]
    fn tampered_download_leaves_nothing() {
        let t = TempDir::new().unwrap();
        let dest = t.path().join("p.deb");
        assert!(write_verified(&mut &b"abd"[..], &dest, ABC, &mut |_| {}).is_err());
        assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 0);
    }

    #[test]
    fn only_one_job_at_a_time() {
        let st = UpdateState::default();
        let first = Busy::take(&st).unwrap();
        assert!(Busy::take(&st).is_err());
        drop(first);
        assert!(Busy::take(&st).is_ok());
    }

    /// release.yml'deki adlarla `PackageKind::asset_name` ayrışmasın; Cargo ve
    /// tauri.conf.json sürümleri aynı olsun (paket adı tauri.conf.json'dan gelir).
    #[test]
    fn release_names_and_versions_stay_in_sync() {
        let yml = include_str!("../../.github/workflows/release.yml");
        for s in ["MDViewer-v$ver.exe", "mdflowviewer_${TAG#v}_amd64.deb", "mdflowviewer-${TAG#v}-1.x86_64.rpm",
            "mdflowviewer-bin-$VER-1-x86_64.pkg.tar.zst", "MDViewer-${TAG}-macos-arm64.dmg", "MDViewer-${TAG}-android.apk"] {
            assert!(yml.contains(s), "{s}");
        }
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], env!("CARGO_PKG_VERSION"));
    }
}
