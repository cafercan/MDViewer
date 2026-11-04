//! Yol yardımcıları. Karşılaştırmalar sözcükseldir (diske dokunmaz, symlink
//! çözmez): Python `os.path.abspath` / `relpath` davranışının karşılığı.
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// `.` ve `..` bileşenlerini sözcüksel olarak çözer; ayırıcıları platformunkine çevirir.
/// Kökün üstüne çıkan `..` yok sayılır (Python `normpath("/..") == "/"`).
pub fn normalize(p: &Path) -> PathBuf {
    let mut out: Vec<Component> = Vec::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => match out.last() {
                Some(Component::Normal(_)) => {
                    out.pop();
                }
                Some(Component::RootDir) | Some(Component::Prefix(_)) => {}
                _ => out.push(c),
            },
            _ => out.push(c),
        }
    }
    let mut buf = PathBuf::new();
    for c in out {
        buf.push(c.as_os_str());
    }
    buf
}

/// Python `abspath(join(base, p))`: mutlak `p` olduğu gibi (normalleştirilmiş), göreli `p` base'e göre.
pub fn absolutize(base: &Path, p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() {
        normalize(path)
    } else {
        normalize(&base.join(path))
    }
}

/// Karşılaştırma anahtarı: Windows'ta küçük harf, diğerlerinde olduğu gibi.
fn key(c: Component) -> OsString {
    if cfg!(windows) {
        OsString::from(c.as_os_str().to_string_lossy().to_lowercase())
    } else {
        c.as_os_str().to_os_string()
    }
}

/// `path` `root`'un kendisi ya da altında mı? Windows'ta harf duyarsız; farklı sürücü → false.
pub fn is_under(path: &Path, root: &Path) -> bool {
    let path = normalize(path);
    let root = normalize(root);
    let mut p = path.components();
    for r in root.components() {
        match p.next() {
            Some(c) if key(c) == key(r) => {}
            _ => return false,
        }
    }
    true
}

/// Python `normcase` eşitliği: Windows'ta harf ve ayırıcı duyarsız.
pub fn same_path(a: &str, b: &str) -> bool {
    let a = normalize(Path::new(a));
    let b = normalize(Path::new(b));
    a.components().map(key).eq(b.components().map(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_resolves_dotdot() {
        let p = normalize(Path::new("/a/b/../c/./d"));
        assert_eq!(p, PathBuf::from("/a/c/d"));
    }

    #[test]
    fn absolutize_relative_joins_base() {
        let base = std::env::temp_dir();
        assert_eq!(absolutize(&base, "x/../y.md"), base.join("y.md"));
    }

    #[test]
    fn is_under_accepts_root_and_children() {
        let root = std::env::temp_dir().join("kok");
        assert!(is_under(&root, &root));
        assert!(is_under(&root.join("a").join("b.md"), &root));
        assert!(!is_under(&std::env::temp_dir().join("kok2"), &root));
    }

    #[test]
    fn is_under_rejects_dotdot_escape() {
        let root = std::env::temp_dir().join("kok");
        assert!(!is_under(&absolutize(&root, "../gizli.md"), &root));
        assert!(!is_under(&absolutize(&root, "a/../../gizli.md"), &root));
    }

    #[cfg(windows)]
    #[test]
    fn is_under_case_insensitive() {
        assert!(is_under(Path::new(r"C:\Docs\a.md"), Path::new(r"c:\docs")));
    }

    #[cfg(windows)]
    #[test]
    fn is_under_other_drive_false() {
        assert!(!is_under(Path::new(r"D:\x"), Path::new(r"C:\")));
    }

    #[test]
    fn same_path_matches_identical() {
        let p = std::env::temp_dir().join("a.md");
        let s = p.to_string_lossy();
        assert!(same_path(&s, &s));
        assert!(!same_path(&s, &std::env::temp_dir().join("b.md").to_string_lossy()));
    }

    #[cfg(windows)]
    #[test]
    fn same_path_ignores_case_and_separators_on_windows() {
        assert!(same_path(r"C:\Docs\A.md", "c:/docs/a.md"));
    }
}
