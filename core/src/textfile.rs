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

/// BOM atılır, `\r\n` → `\n`.
pub fn read_doc(path: &Path) -> Result<String, ReadError> {
    let bytes = std::fs::read(path).map_err(ReadError::Io)?;
    let body = bytes.strip_prefix(BOM).unwrap_or(&bytes);
    let text = std::str::from_utf8(body).map_err(|_| ReadError::NotUtf8)?;
    Ok(text.replace("\r\n", "\n"))
}

/// Mevcut dosyanın biçimini (yoksa platform varsayılanı) uygulayıp atomik yazar.
pub fn write_doc(path: &Path, text: &str) -> io::Result<()> {
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
    atomic_write(path, &out)
}

/// Aynı klasörde `.<ad>.mdflow-tmp` → yaz → sync → hedefin üstüne taşı.
/// Her hata yolunda geçici dosya silinir.
fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let existing = std::fs::metadata(path).ok();
    if existing.as_ref().is_some_and(|m| m.permissions().readonly()) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Dosya salt okunur."));
    }
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Geçersiz dosya yolu."))?;
    let tmp = path.with_file_name(format!(".{}.mdflow-tmp", name.to_string_lossy()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        #[cfg(unix)]
        if let Some(m) = &existing {
            std::fs::set_permissions(&tmp, m.permissions())?;
        }
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
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
