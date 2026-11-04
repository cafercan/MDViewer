//! Belge okuma/yazma. Arayüz metni her zaman `\n` satır sonlu ve BOM'suz
//! görür; diske yazarken dosyanın mevcut biçimi (CRLF/LF, BOM) korunur.
//! Yazma atomiktir: geçici dosya + yeniden adlandırma.
use std::io;
use std::path::Path;

const BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TextFormat {
    pub crlf: bool,
    pub bom: bool,
}

impl TextFormat {
    /// Yeni dosya: Windows'ta CRLF (2.x'in fiili davranışı), diğerlerinde LF; BOM yok.
    pub fn platform_default() -> TextFormat {
        TextFormat { crlf: cfg!(windows), bom: false }
    }
}

/// BOM = `EF BB BF` öneki; `crlf` = ilk `\n`'den önce `\r` var mı; `\n` yoksa platform varsayılanı.
pub fn detect(bytes: &[u8]) -> TextFormat {
    let bom = bytes.starts_with(BOM);
    let crlf = match bytes.iter().position(|&b| b == b'\n') {
        Some(i) => i > 0 && bytes[i - 1] == b'\r',
        None => TextFormat::platform_default().crlf,
    };
    TextFormat { crlf, bom }
}

#[derive(Debug)]
pub enum ReadError {
    NotUtf8,
    Io(io::Error),
}

/// BOM atılır, `\r\n` ve tek başına `\r` → `\n` (Python universal newlines).
pub fn read_doc(path: &Path) -> Result<String, ReadError> {
    let bytes = std::fs::read(path).map_err(ReadError::Io)?;
    let body = bytes.strip_prefix(BOM).unwrap_or(&bytes);
    let text = std::str::from_utf8(body).map_err(|_| ReadError::NotUtf8)?;
    Ok(text.replace("\r\n", "\n").replace('\r', "\n"))
}

/// Mevcut dosyanın biçimini (yoksa platform varsayılanı) uygulayıp yazar ve
/// diske yazılan baytları döndürür. Sembolik bağ ise hedefine yazılır.
pub fn write_doc(path: &Path, text: &str) -> io::Result<Vec<u8>> {
    let is_link = std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink());
    let resolved = if is_link { std::fs::canonicalize(path)? } else { path.to_path_buf() };
    let path = resolved.as_path();
    let format = match std::fs::read(path) {
        Ok(existing) => detect(&existing),
        Err(e) if e.kind() == io::ErrorKind::NotFound => TextFormat::platform_default(),
        Err(e) => return Err(e),
    };
    let mut out = Vec::with_capacity(text.len() + 16);
    if format.bom {
        out.extend_from_slice(BOM);
    }
    if format.crlf {
        // Arayüzden gelen metin `\n`'li; olası `\r\n` iki kez çevrilmesin.
        out.extend_from_slice(text.replace("\r\n", "\n").replace('\n', "\r\n").as_bytes());
    } else {
        out.extend_from_slice(text.as_bytes());
    }
    save_bytes(path, &out)?;
    Ok(out)
}

/// Kayıt stratejisi: mümkünse atomik (geçici dosya + yeniden adlandırma; yarım
/// dosya kalmaz), dosyanın kimliğini değiştireceği durumlarda yerinde yazma.
fn save_bytes(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let existing = std::fs::metadata(path).ok();
    if existing.is_some() {
        // Yazma izni denemesi (içeriğe dokunmaz): salt okunur öznitelik, başka
        // kullanıcının dosyası, kilitli dosya burada yakalanır.
        if let Err(e) = std::fs::OpenOptions::new().write(true).open(path) {
            if e.kind() == io::ErrorKind::PermissionDenied {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Dosya salt okunur ya da yazma izni yok."));
            }
            return Err(e);
        }
    }
    if existing.as_ref().is_some_and(must_write_in_place) {
        return write_in_place(path, bytes);
    }
    match atomic_write(path, bytes, existing.as_ref()) {
        Ok(true) => Ok(()),
        // Geçici dosya kurulamadı (klasöre yazılamıyor) ya da sahiplik korunamazdı
        Ok(false) => write_in_place(path, bytes),
        Err(e) => Err(e),
    }
}

/// Yeniden adlandırmanın dosyanın kimliğini bozacağı durumlar: birden çok
/// sabit bağ (hard link), Windows'ta gizli/sistem öznitelikleri.
fn must_write_in_place(m: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        m.nlink() > 1
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;
        m.file_attributes() & HIDDEN_OR_SYSTEM != 0
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = m;
        false
    }
}

fn write_in_place(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().write(true).truncate(true).create(true).open(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

/// Aynı klasörde `.<ad>.mdflow-tmp` → yaz → sync → hedefin üstüne taşı.
/// `Ok(false)`: atomik yol uygun değil (geçici dosya kurulamadı ya da Unix'te
/// sahiplik değişecekti), çağıran yerinde yazar. Her yolda geçici dosya silinir.
fn atomic_write(path: &Path, bytes: &[u8], existing: Option<&std::fs::Metadata>) -> io::Result<bool> {
    use std::io::Write;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Geçersiz dosya yolu."))?;
    let tmp = path.with_file_name(format!(".{}.mdflow-tmp", name.to_string_lossy()));
    let mut f = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(_) => return Ok(false),
    };
    let result = (|| {
        #[cfg(unix)]
        if let Some(m) = existing {
            use std::os::unix::fs::MetadataExt;
            let t = f.metadata()?;
            if t.uid() != m.uid() || t.gid() != m.gid() {
                return Ok(false); // rename dosyanın sahibini değiştirirdi
            }
        }
        f.write_all(bytes)?;
        f.sync_all()?;
        #[cfg(unix)]
        if let Some(m) = existing {
            std::fs::set_permissions(&tmp, m.permissions())?;
        }
        #[cfg(not(unix))]
        let _ = existing;
        std::fs::rename(&tmp, path)?;
        Ok(true)
    })();
    drop(f);
    if !matches!(result, Ok(true)) {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn files_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn read_strips_bom_and_crlf() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"\xEF\xBB\xBFa\r\nb").unwrap();
        assert_eq!(read_doc(&p).unwrap(), "a\nb");
    }

    #[test]
    fn write_preserves_crlf_and_bom() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"\xEF\xBB\xBFa\r\nb").unwrap();
        write_doc(&p, "a\nc").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"\xEF\xBB\xBFa\r\nc");
    }

    #[test]
    fn write_preserves_lf() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"a\nb").unwrap();
        write_doc(&p, "x\ny").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"x\ny");
    }

    #[test]
    fn write_new_file_uses_platform_default() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("yeni.md");
        write_doc(&p, "x\ny").unwrap();
        let expected: &[u8] = if cfg!(windows) { b"x\r\ny" } else { b"x\ny" };
        assert_eq!(std::fs::read(&p).unwrap(), expected);
    }

    #[test]
    fn detect_without_newline_is_platform_default() {
        assert_eq!(detect(b"tek satir"), TextFormat::platform_default());
        assert_eq!(detect(b"\xEF\xBB\xBFa\nb"), TextFormat { crlf: false, bom: true });
    }

    #[test]
    fn read_non_utf8_is_not_utf8_error() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        assert!(matches!(read_doc(&p), Err(ReadError::NotUtf8)));
    }

    #[test]
    fn read_missing_is_io_error() {
        let tmp = TempDir::new().unwrap();
        assert!(matches!(read_doc(&tmp.path().join("yok.md")), Err(ReadError::Io(_))));
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"eski").unwrap();
        write_doc(&p, "yeni").unwrap();
        assert_eq!(files_in(tmp.path()), vec!["a.md".to_string()]);
        assert_eq!(read_doc(&p).unwrap(), "yeni");
    }

    #[test]
    fn write_returns_bytes_on_disk() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"\xEF\xBB\xBFa\r\nb").unwrap();
        let written = write_doc(&p, "x\ny").unwrap();
        assert_eq!(written, std::fs::read(&p).unwrap());
    }

    #[test]
    fn read_converts_lone_cr() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"a\rb\r\nc").unwrap();
        assert_eq!(read_doc(&p).unwrap(), "a\nb\nc");
    }

    /// Sembolik bağ üzerinden kayıt hedef dosyayı günceller, bağ bağ olarak kalır.
    #[test]
    fn save_through_symlink_updates_target() {
        let tmp = TempDir::new().unwrap();
        let real = tmp.path().join("gercek.md");
        let link = tmp.path().join("bag.md");
        std::fs::write(&real, b"eski").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&real, &link).is_err() {
            eprintln!("sembolik bağ oluşturulamadı (Geliştirici modu kapalı); test atlandı");
            return;
        }
        write_doc(&link, "yeni").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&real).unwrap(), b"yeni");
    }

    #[cfg(windows)]
    #[test]
    fn write_keeps_hidden_attribute() {
        use std::os::windows::fs::MetadataExt;
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("gizli.md");
        std::fs::write(&p, b"eski").unwrap();
        let ok = std::process::Command::new("attrib").arg("+h").arg(&p).status().unwrap().success();
        assert!(ok);
        write_doc(&p, "yeni").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"yeni");
        assert_ne!(std::fs::metadata(&p).unwrap().file_attributes() & 0x2, 0, "gizli öznitelik kayboldu");
    }

    #[cfg(unix)]
    #[test]
    fn write_keeps_hard_link() {
        let tmp = TempDir::new().unwrap();
        let a = tmp.path().join("a.md");
        let b = tmp.path().join("b.md");
        std::fs::write(&a, b"eski").unwrap();
        std::fs::hard_link(&a, &b).unwrap();
        write_doc(&a, "yeni").unwrap();
        assert_eq!(std::fs::read(&b).unwrap(), b"yeni");
    }

    #[cfg(unix)]
    #[test]
    fn write_in_readonly_dir_falls_back_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("kilitli");
        std::fs::create_dir(&dir).unwrap();
        let p = dir.join("a.md");
        std::fs::write(&p, b"eski").unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let r = write_doc(&p, "yeni");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        r.unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"yeni");
    }

    #[test]
    fn atomic_write_readonly_target_fails_cleanly() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, b"eski").unwrap();
        let mut perm = std::fs::metadata(&p).unwrap().permissions();
        perm.set_readonly(true);
        std::fs::set_permissions(&p, perm.clone()).unwrap();

        assert!(write_doc(&p, "yeni").is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"eski");
        assert_eq!(files_in(tmp.path()), vec!["a.md".to_string()]);

        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        std::fs::set_permissions(&p, perm).unwrap();
    }
}
