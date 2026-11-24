//! Eşitleme durumu (`sync.json`, ayar dosyasının yanında). Eşleştirme anahtarları
//! burada durur; arayüze hiçbir zaman verilmez.
use mdflow_core::sync::Files;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub key: String,
    /// Son eşitleme (Unix saniyesi)
    pub last: u64,
}

/// Bu aygıt bilgisayar rolünde: telefonların bağlandığı klasör.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Host {
    pub enabled: bool,
    pub folder: String,
    /// Klasör değişince değişir; telefon eski geçmişini bu klasöre uygulamasın.
    pub folder_id: String,
    pub peers: Vec<Peer>,
}

/// Bu aygıt telefon rolünde: bağlandığı bilgisayar.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Link {
    pub host_id: String,
    pub name: String,
    pub key: String,
    pub addrs: Vec<String>,
    pub folder: String,
    pub auto: bool,
    pub last: u64,
    pub folder_id: String,
    /// Son eşitlemede iki tarafta aynı olan dosyalar.
    pub base: Files,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Data {
    pub device_id: String,
    pub host: Host,
    pub link: Option<Link>,
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    pub fn open(path: PathBuf) -> Store {
        let mut data: Data = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        if data.device_id.is_empty() {
            data.device_id = super::channel::hex(&super::channel::random::<16>());
        }
        Store { path, data }
    }

    pub fn save(&self) -> io::Result<()> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        let tmp = self.path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut opt = std::fs::OpenOptions::new();
        opt.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opt, 0o600);
        let mut f = opt.open(&tmp)?;
        f.write_all(&serde_json::to_vec(&self.data)?)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(tmp, &self.path)
    }
}
