//! Aygıtlar arası eşitlemenin ağdan bağımsız yarısı: klasör dökümü, üç yönlü
//! karşılaştırma (son eşitleme · bu aygıt · karşı aygıt) ve güvenli yazma.
//!
//! Kural: hiçbir içerik kaybolmaz. İki tarafta da değişen notun bizdeki hali
//! "… (çakışma …)" kopyası olur; silinen not `.trash` içine taşınır; silme ile
//! düzenleme çakışırsa düzenleme kazanır.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Eşitlenen uzantılar: notlar ve notlara gömülen dosyalar.
const EXTENSIONS: &[&str] = &["md", "markdown", "txt", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "pdf"];
pub const MAX_FILE: u64 = 25 * 1024 * 1024;
pub const MAX_FILES: usize = 20_000;

pub type Files = BTreeMap<String, String>;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    /// "alt/not.md" → SHA-256
    pub files: Files,
    /// Okunamayan ya da sınırı aşan yollar (klasörse "/" ile biter): "silinmiş"
    /// sanılmasın diye eşitlemenin tamamen dışında tutulur.
    #[serde(default)]
    pub skipped: Vec<String>,
    /// O an düzenlenen notlar: gönderilebilir ama üzerine yazılmaz.
    #[serde(default)]
    pub busy: Vec<String>,
}

pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn has_synced_extension(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(stem, e)| !stem.is_empty() && EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Karşıdan gelen göreli yol güvenilmezdir: kökten çıkamaz, gizli dosyaya ve
/// listede olmayan uzantıya yazamaz.
pub fn valid_rel(rel: &str) -> bool {
    rel.len() <= 1024
        && !rel.chars().any(|c| c.is_control() || c == '\\' || (cfg!(windows) && ":*?\"<>|".contains(c)))
        && rel.split('/').all(|s| {
            !s.is_empty() && s != "." && s != ".." && !is_hidden(s) && !(cfg!(windows) && s.ends_with(['.', ' ']))
        })
        && rel.rsplit('/').next().is_some_and(has_synced_extension)
}

/// Göreli yolu kökün altına yerleştirir; aradaki hiçbir parça sembolik bağ olamaz.
fn locate(root: &Path, rel: &str) -> io::Result<PathBuf> {
    if !valid_rel(rel) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Geçersiz dosya yolu."));
    }
    let mut p = root.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
        if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Sembolik bağın içine yazılmaz."));
        }
    }
    Ok(p)
}

#[derive(Default)]
pub struct HashCache(HashMap<PathBuf, (u64, SystemTime, String)>);

impl HashCache {
    fn get(&mut self, path: &Path, meta: &std::fs::Metadata) -> io::Result<String> {
        let mtime = meta.modified()?;
        if let Some((len, t, h)) = self.0.get(path) {
            if *len == meta.len() && *t == mtime {
                return Ok(h.clone());
            }
        }
        let h = hash(&std::fs::read(path)?);
        // Az önce değişen dosya aynı zaman damgasıyla bir daha değişebilir.
        if mtime.elapsed().is_ok_and(|d| d > Duration::from_secs(3)) {
            self.0.insert(path.to_path_buf(), (meta.len(), mtime, h.clone()));
        } else {
            self.0.remove(path);
        }
        Ok(h)
    }
}

/// Klasörün dökümü. Kök okunamazsa hata (boş klasör sanılıp karşıdakiler silinmesin).
pub fn scan(root: &Path, cache: &mut HashCache) -> Result<Manifest, String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Manifest, cache: &mut HashCache, depth: usize) -> Result<(), String> {
        let skip_dir = |out: &mut Manifest| out.skipped.push(prefix.to_string());
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) if prefix.is_empty() => return Err(format!("Eşitleme klasörü okunamadı: {e}")),
            Err(_) => {
                skip_dir(out);
                return Ok(());
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                if prefix.is_empty() {
                    return Err("Eşitleme klasörü okunamadı.".into());
                }
                skip_dir(out);
                continue;
            };
            let Ok(name) = entry.file_name().into_string() else { continue };
            if is_hidden(&name) {
                continue;
            }
            let rel = format!("{prefix}{name}");
            let Ok(kind) = entry.file_type() else {
                out.skipped.push(rel.clone());
                out.skipped.push(rel + "/");
                continue;
            };
            if kind.is_symlink() {
                out.skipped.push(rel.clone());
                out.skipped.push(rel + "/");
            } else if kind.is_dir() {
                if depth < 32 {
                    walk(&entry.path(), &format!("{rel}/"), out, cache, depth + 1)?;
                } else {
                    out.skipped.push(rel + "/");
                }
            } else if valid_rel(&rel) {
                let meta = entry.metadata();
                match meta {
                    Ok(m) if m.len() <= MAX_FILE => match cache.get(&entry.path(), &m) {
                        Ok(h) => {
                            out.files.insert(rel, h);
                        }
                        Err(_) => out.skipped.push(rel),
                    },
                    _ => out.skipped.push(rel),
                }
                if out.files.len() > MAX_FILES {
                    return Err(format!("Klasörde {MAX_FILES} dosyadan fazlası var; daha küçük bir klasör seçin."));
                }
            }
        }
        Ok(())
    }
    let mut out = Manifest::default();
    walk(root, "", &mut out, cache, 0)?;
    Ok(out)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Op {
    // Sıra önemli: yalnız harf büyüklüğü değişen adlarda silme, yazmadan önce gelmeli.
    DeleteLocal,
    DeleteRemote,
    Pull,
    Push,
    Conflict,
}

#[derive(Debug, Default)]
pub struct Plan {
    pub ops: Vec<(Op, String)>,
    /// İki tarafta zaten aynı olan (ya da ikisinde de silinmiş) yolların yeni durumu.
    pub base: Files,
    /// Şimdilik ertelenen (o an düzenlenen) not sayısı.
    pub deferred: usize,
}

impl Plan {
    pub fn deletes(&self) -> usize {
        self.ops.iter().filter(|(o, _)| matches!(o, Op::DeleteLocal | Op::DeleteRemote)).count()
    }

    /// Yanlışlıkla boşaltılmış/başka bir klasör gibi görünen toplu silme.
    pub fn mass_delete(&self, base: &Files, local: &Manifest, remote: &Manifest) -> bool {
        let n = self.deletes();
        n > 0 && (local.files.is_empty() || remote.files.is_empty() || (n >= 5 && n * 2 > base.len()))
    }
}

pub fn plan(base: &Files, local: &Manifest, remote: &Manifest) -> Plan {
    let ignored = |p: &str| {
        [local, remote]
            .iter()
            .flat_map(|m| m.skipped.iter())
            .any(|s| if s.ends_with('/') { p.starts_with(s.as_str()) } else { p == s })
    };
    let all: BTreeSet<&String> = base.keys().chain(local.files.keys()).chain(remote.files.keys()).collect();
    let mut out = Plan::default();
    for p in all {
        let (b, l, r) = (base.get(p), local.files.get(p), remote.files.get(p));
        if ignored(p) || !valid_rel(p) {
            if let Some(b) = b {
                out.base.insert(p.clone(), b.clone());
            }
            continue;
        }
        if l == r {
            if let Some(h) = l {
                out.base.insert(p.clone(), h.clone());
            }
            continue;
        }
        let op = match (l, r) {
            (None, Some(_)) if r == b => Op::DeleteRemote,
            (Some(_), None) if l == b => Op::DeleteLocal,
            (None, _) => Op::Pull,
            (_, None) => Op::Push,
            _ if l == b => Op::Pull,
            _ if r == b => Op::Push,
            _ => Op::Conflict,
        };
        // Taban, işlem başarıyla bitene kadar eski halinde kalır.
        if let Some(b) = b {
            out.base.insert(p.clone(), b.clone());
        }
        let touches_local = matches!(op, Op::Pull | Op::DeleteLocal | Op::Conflict);
        let touches_remote = matches!(op, Op::Push | Op::DeleteRemote | Op::Conflict);
        if (touches_local && local.busy.contains(p)) || (touches_remote && remote.busy.contains(p)) {
            out.deferred += 1;
            continue;
        }
        out.ops.push((op, p.clone()));
    }
    out.ops.sort();
    out
}

/// Çakışan halin kopya adı; içerikten türediği için tekrar denemek yeni kopya doğurmaz.
pub fn conflict_name(rel: &str, device: &str, hash: &str) -> String {
    let device: String = device.chars().filter(|c| c.is_alphanumeric() || " -_".contains(*c)).take(24).collect();
    let device = device.trim();
    let (stem, ext) = rel.rsplit_once('.').unwrap_or((rel, "md"));
    let tag = hash.get(..6).unwrap_or(hash);
    format!("{stem} (çakışma {device}{}{tag}).{ext}", if device.is_empty() { "" } else { " " })
}

fn current(path: &Path) -> io::Result<Option<String>> {
    match std::fs::read(path) {
        Ok(b) => Ok(Some(hash(&b))),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn changed() -> io::Error {
    io::Error::new(io::ErrorKind::WouldBlock, "Dosya bu sırada değişti; sonraki eşitlemede yeniden denenecek.")
}

/// Dosyayı okur; içerik beklenen özet değilse hata.
pub fn read(root: &Path, rel: &str, expect: &str) -> io::Result<Vec<u8>> {
    let path = locate(root, rel)?;
    if std::fs::metadata(&path)?.len() > MAX_FILE {
        return Err(changed());
    }
    let bytes = std::fs::read(path)?;
    if hash(&bytes) != expect {
        return Err(changed());
    }
    Ok(bytes)
}

/// Dosya hâlâ beklenen haldeyse (`None`: yoksa) atomik olarak yazar.
pub fn write(root: &Path, rel: &str, expect: Option<&str>, bytes: &[u8]) -> io::Result<()> {
    let path = locate(root, rel)?;
    let dir = path.parent().unwrap_or(root);
    if !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::NotFound, "Eşitleme klasörü yok."));
    }
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".mdflow-{}.tmp", &hash(rel.as_bytes())[..16]));
    std::fs::write(&tmp, bytes)?;
    let result = match current(&path) {
        Ok(now) if now.as_deref() == expect => {
            if let Ok(m) = std::fs::metadata(&path) {
                let _ = std::fs::set_permissions(&tmp, m.permissions());
            }
            std::fs::rename(&tmp, &path)
        }
        Ok(_) => Err(changed()),
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Dosya hâlâ beklenen haldeyse klasöründeki `.trash` içine taşır.
pub fn trash(root: &Path, rel: &str, expect: &str) -> io::Result<()> {
    let path = locate(root, rel)?;
    match current(&path)? {
        None => return Ok(()),
        Some(h) if h != expect => return Err(changed()),
        _ => {}
    }
    crate::links::move_to_trash(&path).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(files: &[(&str, &str)]) -> Manifest {
        Manifest { files: f(files), ..Default::default() }
    }
    fn f(files: &[(&str, &str)]) -> Files {
        files.iter().map(|(p, h)| (p.to_string(), h.to_string())).collect()
    }
    fn ops(base: &[(&str, &str)], l: &[(&str, &str)], r: &[(&str, &str)]) -> Vec<(Op, String)> {
        plan(&f(base), &m(l), &m(r)).ops
    }
    fn one(op: Op) -> Vec<(Op, String)> {
        vec![(op, "a.md".into())]
    }

    #[test]
    fn three_way_decisions() {
        let (a, x, y) = (("a.md", "1"), ("a.md", "2"), ("a.md", "3"));
        assert_eq!(ops(&[], &[a], &[a]), []);
        assert_eq!(ops(&[], &[a], &[]), one(Op::Push));
        assert_eq!(ops(&[], &[], &[a]), one(Op::Pull));
        assert_eq!(ops(&[], &[a], &[x]), one(Op::Conflict));
        assert_eq!(ops(&[a], &[x], &[a]), one(Op::Push));
        assert_eq!(ops(&[a], &[a], &[x]), one(Op::Pull));
        assert_eq!(ops(&[a], &[x], &[y]), one(Op::Conflict));
        assert_eq!(ops(&[a], &[x], &[x]), []);
        assert_eq!(ops(&[a], &[], &[a]), one(Op::DeleteRemote));
        assert_eq!(ops(&[a], &[a], &[]), one(Op::DeleteLocal));
        // Silme ile düzenleme çakışırsa düzenleme kazanır
        assert_eq!(ops(&[a], &[x], &[]), one(Op::Push));
        assert_eq!(ops(&[a], &[], &[x]), one(Op::Pull));
        assert_eq!(ops(&[a], &[], &[]), []);
    }

    #[test]
    fn skipped_paths_are_never_deletes() {
        let base = f(&[("a.md", "1"), ("alt/b.md", "1")]);
        let mut l = m(&[]);
        l.skipped = vec!["a.md".into(), "alt/".into()];
        let p = plan(&base, &l, &m(&[("a.md", "1"), ("alt/b.md", "2")]));
        assert_eq!(p.ops, []);
        assert_eq!(p.base, base);
    }

    #[test]
    fn busy_note_can_be_sent_but_not_overwritten() {
        let base = f(&[("a.md", "1")]);
        let mut l = m(&[("a.md", "2")]);
        l.busy = vec!["a.md".into()];
        assert_eq!(plan(&base, &l, &m(&[("a.md", "1")])).ops, one(Op::Push));
        let p = plan(&base, &l, &m(&[("a.md", "3")]));
        assert_eq!((p.ops.len(), p.deferred), (0, 1));
        let mut r = m(&[("a.md", "1")]);
        r.busy = vec!["a.md".into()];
        assert_eq!(plan(&base, &m(&[("a.md", "2")]), &r).ops, []);
    }

    #[test]
    fn mass_delete_is_flagged() {
        let files: Vec<(String, String)> = (0..10).map(|i| (format!("{i}.md"), "1".into())).collect();
        let base: Files = files.iter().cloned().collect();
        let full = Manifest { files: base.clone(), ..Default::default() };
        let some = |n: usize| Manifest { files: files.iter().take(n).cloned().collect(), ..Default::default() };
        let flagged = |l: &Manifest, r: &Manifest| plan(&base, l, r).mass_delete(&base, l, r);
        assert!(flagged(&some(0), &full));
        assert!(flagged(&full, &some(4)));
        assert!(!flagged(&full, &some(6)));
        assert!(!flagged(&full, &full));
    }

    #[test]
    fn hostile_paths_are_rejected() {
        for p in ["../a.md", "/a.md", "a/../../b.md", "a\\b.md", ".gizli/a.md", "a.exe", ".md", "", "a//b.md", "a\n.md", "x/.trash/a.md", "a.sh"] {
            assert!(!valid_rel(p), "{p}");
        }
        assert!(valid_rel("Proje Planı/günlük notu.md"));
        assert!(valid_rel("resim.PNG"));
    }

    #[test]
    fn scan_write_and_trash() {
        let t = tempfile::TempDir::new().unwrap();
        let root = t.path();
        write(root, "alt/a.md", None, b"bir").unwrap();
        assert!(write(root, "alt/a.md", None, b"iki").is_err());
        assert!(write(root, "alt/a.md", Some(&hash(b"x")), b"iki").is_err());
        write(root, "alt/a.md", Some(&hash(b"bir")), b"iki").unwrap();
        std::fs::write(root.join("b.exe"), "x").unwrap();
        std::fs::create_dir(root.join(".gizli")).unwrap();
        std::fs::write(root.join(".gizli/c.md"), "x").unwrap();
        let s = scan(root, &mut HashCache::default()).unwrap();
        assert_eq!(s.files, f(&[("alt/a.md", &hash(b"iki"))]));
        assert!(read(root, "alt/a.md", &hash(b"bir")).is_err());
        assert_eq!(read(root, "alt/a.md", &hash(b"iki")).unwrap(), b"iki");
        assert!(trash(root, "alt/a.md", &hash(b"bir")).is_err());
        trash(root, "alt/a.md", &hash(b"iki")).unwrap();
        assert!(root.join("alt/.trash/a.md").is_file());
        assert!(scan(root, &mut HashCache::default()).unwrap().files.is_empty());
        assert!(scan(&root.join("yok"), &mut HashCache::default()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_not_followed() {
        let t = tempfile::TempDir::new().unwrap();
        let out = tempfile::TempDir::new().unwrap();
        std::fs::write(out.path().join("a.md"), "gizli").unwrap();
        std::os::unix::fs::symlink(out.path(), t.path().join("bag")).unwrap();
        assert!(write(t.path(), "bag/b.md", None, b"x").is_err());
        assert!(read(t.path(), "bag/a.md", &hash(b"gizli")).is_err());
        assert!(scan(t.path(), &mut HashCache::default()).unwrap().files.is_empty());
    }

    #[test]
    fn conflict_copy_names() {
        assert_eq!(conflict_name("a/not.md", "Pixel 7", "abcdef123"), "a/not (çakışma Pixel 7 abcdef).md");
        assert!(valid_rel(&conflict_name("not.md", "../kötü/ad:", "abcdef")));
    }
}
