//! Şifreli kanal. İlk eşleştirmede kısa kod SPAKE2 ile doğrulanır (dinleyen biri
//! kodu çevrimdışı deneyemez); sonraki bağlantılar, eşleştirmede verilen 256
//! bitlik anahtarla Noise NNpsk0 kullanır.
use serde_json::Value;
use snow::{Builder, HandshakeState, TransportState};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const PATTERN: &str = "Noise_NNpsk0_25519_ChaChaPoly_BLAKE2s";
const CHUNK: usize = 60_000;
/// Tek ileti sınırı: en büyük dosya + başlık.
const MAX_MESSAGE: usize = 32 * 1024 * 1024;

pub type Key = [u8; 32];

pub fn bad(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg)
}

fn crypto<E>(_: E) -> io::Error {
    bad("Şifreli bağlantı kurulamadı.")
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("sistem rastgele sayı üretemedi");
    out
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex32(s: &str) -> Option<Key> {
    let mut out = [0u8; 32];
    if s.len() != 64 || !s.is_ascii() {
        return None;
    }
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

pub fn write_frame(s: &mut TcpStream, data: &[u8]) -> io::Result<()> {
    let mut buf = Vec::with_capacity(data.len() + 2);
    buf.extend_from_slice(&u16::try_from(data.len()).map_err(crypto)?.to_be_bytes());
    buf.extend_from_slice(data);
    s.write_all(&buf)
}

pub fn read_frame(s: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 2];
    s.read_exact(&mut len)?;
    let mut data = vec![0u8; usize::from(u16::from_be_bytes(len))];
    s.read_exact(&mut data)?;
    Ok(data)
}

pub struct Channel {
    stream: TcpStream,
    noise: TransportState,
}

impl Channel {
    fn finish(stream: TcpStream, hs: HandshakeState) -> io::Result<Channel> {
        Ok(Channel { stream, noise: hs.into_transport_mode().map_err(crypto)? })
    }

    pub fn connect(mut stream: TcpStream, key: &Key) -> io::Result<Channel> {
        let mut hs = Builder::new(PATTERN.parse().map_err(crypto)?)
            .psk(0, key)
            .and_then(Builder::build_initiator)
            .map_err(crypto)?;
        let mut buf = [0u8; 1024];
        let n = hs.write_message(&[], &mut buf).map_err(crypto)?;
        write_frame(&mut stream, &buf[..n])?;
        hs.read_message(&read_frame(&mut stream)?, &mut buf).map_err(crypto)?;
        Channel::finish(stream, hs)
    }

    pub fn accept(mut stream: TcpStream, key: &Key) -> io::Result<Channel> {
        let mut hs = Builder::new(PATTERN.parse().map_err(crypto)?)
            .psk(0, key)
            .and_then(Builder::build_responder)
            .map_err(crypto)?;
        let mut buf = [0u8; 1024];
        hs.read_message(&read_frame(&mut stream)?, &mut buf).map_err(crypto)?;
        let n = hs.write_message(&[], &mut buf).map_err(crypto)?;
        write_frame(&mut stream, &buf[..n])?;
        Channel::finish(stream, hs)
    }

    pub fn set_timeout(&self, d: Duration) -> io::Result<()> {
        self.stream.set_read_timeout(Some(d))
    }

    pub fn send(&mut self, head: &Value, body: &[u8]) -> io::Result<()> {
        let head = serde_json::to_vec(head)?;
        let mut msg = Vec::with_capacity(8 + head.len() + body.len());
        msg.extend_from_slice(&((4 + head.len() + body.len()) as u32).to_be_bytes());
        msg.extend_from_slice(&(head.len() as u32).to_be_bytes());
        msg.extend_from_slice(&head);
        msg.extend_from_slice(body);
        let mut buf = vec![0u8; CHUNK + 16];
        for part in msg.chunks(CHUNK) {
            let n = self.noise.write_message(part, &mut buf).map_err(crypto)?;
            write_frame(&mut self.stream, &buf[..n])?;
        }
        Ok(())
    }

    pub fn recv(&mut self) -> io::Result<(Value, Vec<u8>)> {
        let mut buf = vec![0u8; 65_535];
        let mut msg: Vec<u8> = Vec::new();
        let total = loop {
            let frame = read_frame(&mut self.stream)?;
            let n = self.noise.read_message(&frame, &mut buf).map_err(crypto)?;
            msg.extend_from_slice(&buf[..n]);
            if msg.len() < 4 {
                return Err(bad("Bozuk ileti."));
            }
            let total = u32::from_be_bytes(msg[..4].try_into().map_err(crypto)?) as usize + 4;
            if total > MAX_MESSAGE || msg.len() > total {
                return Err(bad("İleti çok büyük."));
            }
            if msg.len() == total {
                break total;
            }
        };
        let head_len = msg.get(4..8).ok_or_else(|| bad("Bozuk ileti."))?;
        let end = 8 + u32::from_be_bytes(head_len.try_into().map_err(crypto)?) as usize;
        if end > total {
            return Err(bad("Bozuk ileti."));
        }
        let head = serde_json::from_slice(&msg[8..end])?;
        Ok((head, msg.split_off(end)))
    }
}

fn pake_key(out: Vec<u8>) -> io::Result<Key> {
    out.try_into().map_err(crypto)
}

fn ids() -> (Identity, Identity) {
    (Identity::new(b"mdflow-telefon"), Identity::new(b"mdflow-bilgisayar"))
}

pub fn pair_connect(mut s: TcpStream, code: &str) -> io::Result<Channel> {
    let (a, b) = ids();
    let (state, msg) = Spake2::<Ed25519Group>::start_a(&Password::new(code.as_bytes()), &a, &b);
    write_frame(&mut s, &msg)?;
    let key = pake_key(state.finish(&read_frame(&mut s)?).map_err(crypto)?)?;
    Channel::connect(s, &key)
}

pub fn pair_accept(mut s: TcpStream, code: &str) -> io::Result<Channel> {
    let (a, b) = ids();
    let (state, msg) = Spake2::<Ed25519Group>::start_b(&Password::new(code.as_bytes()), &a, &b);
    let theirs = read_frame(&mut s)?;
    write_frame(&mut s, &msg)?;
    let key = pake_key(state.finish(&theirs).map_err(crypto)?)?;
    Channel::accept(s, &key)
}
