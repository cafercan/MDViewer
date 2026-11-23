//! Güncelleme kararı (ağ ve kurulum yok): son sürümün SHA256SUMS.txt dosyasından
//! bu kuruluma uyan paketi seçer. Release iş akışı bu dosyayı bütün paketlerden
//! sonra yükler; paketi henüz listelenmemiş sürüm "güncelleme yok" sayılır.

/// Uygulamanın nasıl kurulduğu: hangi paketle güncelleneceğini belirler.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackageKind {
    Windows,
    MacArm64,
    Deb,
    Rpm,
    Pacman,
    Android,
}

impl PackageKind {
    /// Paketin release'teki adı (release.yml'deki yükleme adlarıyla aynı).
    pub fn asset_name(self, v: &str) -> String {
        match self {
            PackageKind::Windows => format!("MDViewer-v{v}.exe"),
            PackageKind::MacArm64 => format!("MDViewer-v{v}-macos-arm64.dmg"),
            PackageKind::Deb => format!("mdflowviewer_{v}_amd64.deb"),
            PackageKind::Rpm => format!("mdflowviewer-{v}-1.x86_64.rpm"),
            PackageKind::Pacman => format!("mdflowviewer-bin-{v}-1-x86_64.pkg.tar.zst"),
            PackageKind::Android => format!("MDViewer-v{v}-android.apk"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
    pub version: String,
    pub name: String,
    pub sha256: String,
}

/// `3.1.0` → (3, 1, 0). Yalnız üç sayılı sürümler (ön sürüm takısı yok).
pub fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let mut it = v.split('.');
    let mut part = || {
        let p = it.next()?;
        (!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())).then(|| p.parse().ok())?
    };
    let out = (part()?, part()?, part()?);
    it.next().is_none().then_some(out)
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    matches!((parse_version(candidate), parse_version(current)), (Some(a), Some(b)) if a > b)
}

/// SHA256SUMS.txt satırları: `<64 onaltılık>  <ad>`; bozuk satırlar atlanır.
fn parse_sums(text: &str) -> impl Iterator<Item = (&str, &str)> {
    text.lines().filter_map(|line| {
        let (sum, name) = line.trim().split_once(char::is_whitespace)?;
        let name = name.trim_start().trim_start_matches('*');
        (sum.len() == 64 && sum.bytes().all(|b| b.is_ascii_hexdigit())).then_some((sum, name))
    })
}

/// Bu kurulum türünün paketi listedeyse döner (sürüm, paketin adından okunur).
pub fn find_asset(sums: &str, kind: PackageKind) -> Option<Asset> {
    let pattern = kind.asset_name("\0");
    let (prefix, suffix) = pattern.split_once('\0')?;
    parse_sums(sums).find_map(|(sum, name)| {
        let v = name.strip_prefix(prefix)?.strip_suffix(suffix)?;
        parse_version(v)?;
        Some(Asset { version: v.to_string(), name: name.to_string(), sha256: sum.to_ascii_lowercase() })
    })
}

/// Listedeki en yüksek sürüm: kendi paketi olmayan kurulumlarda (kaynaktan
/// derleme, AUR) yalnız haber vermek için.
pub fn latest_version(sums: &str) -> Option<String> {
    use PackageKind::*;
    [Windows, MacArm64, Deb, Rpm, Pacman, Android]
        .into_iter()
        .filter_map(|k| find_asset(sums, k))
        .map(|a| a.version)
        .max_by_key(|v| parse_version(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sums() -> String {
        let h = "a".repeat(64);
        format!(
            "{h}  MDViewer-v3.2.0-macos-arm64.dmg\n{h}  MDViewer-v3.2.0.exe\n{h}  mdflowviewer-3.2.0-1.x86_64.rpm\n\
             {h}  mdflowviewer-bin-3.2.0-1-x86_64.pkg.tar.zst\n{h} *mdflowviewer_3.2.0_amd64.deb\n"
        )
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(is_newer("3.10.0", "3.9.9"));
        assert!(!is_newer("3.1.0", "3.1.0"));
        assert!(!is_newer("3.0.9", "3.1.0"));
        for bad in ["3.1", "3.1.0.1", "v3.1.0", "3.1.0-rc1", "3..0", "+3.1.0", ""] {
            assert!(!is_newer(bad, "1.0.0"), "{bad}");
        }
    }

    #[test]
    fn finds_the_package_of_each_kind() {
        use PackageKind::*;
        for kind in [Windows, MacArm64, Deb, Rpm, Pacman] {
            let a = find_asset(&sums(), kind).unwrap();
            assert_eq!(a.version, "3.2.0");
            assert_eq!(a.name, kind.asset_name("3.2.0"));
        }
        assert_eq!(find_asset(&sums(), Android), None);
    }

    #[test]
    fn broken_or_hostile_lines_are_ignored() {
        let h = "b".repeat(64);
        assert_eq!(find_asset("kısa  MDViewer-v3.2.0.exe", PackageKind::Windows), None);
        assert_eq!(find_asset(&format!("{h}  MDViewer-v../../3.2.0.exe"), PackageKind::Windows), None);
        assert_eq!(find_asset("", PackageKind::Windows), None);
        assert_eq!(find_asset("<html>Not Found</html>", PackageKind::Windows), None);
    }

    #[test]
    fn latest_version_without_own_package() {
        assert_eq!(latest_version(&sums()).as_deref(), Some("3.2.0"));
        assert_eq!(latest_version(""), None);
    }
}
