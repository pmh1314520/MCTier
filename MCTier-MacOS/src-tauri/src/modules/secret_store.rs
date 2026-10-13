use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use std::sync::Mutex;

pub const LOCAL_PREFIX: &str = "mctier-local-v1:";
pub const INVITE_PREFIX: &str = "mctier-invite-v3:";
const LOCAL_AAD: &[u8] = b"MCTier/local-secret/v1";
const INVITE_AAD: &[u8] = b"MCTier/invite/v3";

fn local_key() -> Result<[u8; 32], String> {
    // Serialize first-use creation so concurrent saves cannot replace the key.
    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);
    let mut cached = KEY.lock().map_err(|_| "Secret store lock failed")?;
    if let Some(key) = *cached {
        return Ok(key);
    }
    let entry = keyring::Entry::new("MCTier", "local-aes256-v1")
        .map_err(|_| "System credential store unavailable")?;
    let key = match entry.get_password() {
        Ok(value) => URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| "Invalid local key")?
            .try_into()
            .map_err(|_| "Invalid local key length")?,
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            entry
                .set_password(&URL_SAFE_NO_PAD.encode(key))
                .map_err(|_| "Cannot save system credential")?;
            key
        }
        Err(_) => return Err("System credential store is locked or unavailable".into()),
    };
    *cached = Some(key);
    Ok(key)
}

fn seal(key: &[u8; 32], value: &str, aad: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid encryption key")?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: value.as_bytes(),
                aad,
            },
        )
        .map_err(|_| "Encryption failed")?;
    Ok([nonce.to_vec(), encrypted].concat())
}

fn open(key: &[u8; 32], value: &[u8], aad: &[u8]) -> Result<String, String> {
    if value.len() < 28 || value.len() > 4096 {
        return Err("Invalid encrypted secret".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Invalid encryption key")?;
    let bytes = cipher
        .decrypt(
            Nonce::from_slice(&value[..12]),
            Payload {
                msg: &value[12..],
                aad,
            },
        )
        .map_err(|_| "Encrypted secret authentication failed")?;
    String::from_utf8(bytes).map_err(|_| "Invalid secret encoding".into())
}

pub fn resolve(value: &str) -> Result<String, String> {
    if value.len() > 4096 {
        return Err("Secret exceeds size limit".into());
    }
    if let Some(encoded) = value.strip_prefix(LOCAL_PREFIX) {
        return open(
            &local_key()?,
            &URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| "Invalid encrypted secret")?,
            LOCAL_AAD,
        );
    }
    if let Some(encoded) = value.strip_prefix(INVITE_PREFIX) {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "Invalid invite")?;
        if bytes.len() < 60 {
            return Err("Invalid invite".into());
        }
        let key: [u8; 32] = bytes[..32].try_into().map_err(|_| "Invalid invite key")?;
        return open(&key, &bytes[32..], INVITE_AAD);
    }
    Ok(value.to_string())
}

#[tauri::command]
pub fn protect_lobby_password(password: String) -> Result<String, String> {
    if password.is_empty() {
        return Ok(password);
    }
    // 已经是本地信封：原样返回。回填最近大厅/收藏时传来的都是信封，重复
    // resolve+re-seal 每次都要读系统凭据库（macOS 上重签名的开发包还会触发
    // 钥匙串授权弹窗），一旦失败就把整条回填流程打断，表现为"每次都要重新
    // 输入密码"。信封在首次创建时已经过了明文策略校验，直接复用是等价的。
    if password.starts_with(LOCAL_PREFIX) {
        return Ok(password);
    }
    let plain = resolve(&password)?;
    crate::modules::lobby_manager::LobbyManager::validate_password(&plain)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "{}{}",
        LOCAL_PREFIX,
        URL_SAFE_NO_PAD.encode(seal(&local_key()?, &plain, LOCAL_AAD)?)
    ))
}

#[tauri::command]
pub fn export_lobby_password(password: String) -> Result<String, String> {
    let plain = resolve(&password)?;
    if plain.is_empty() {
        return Ok(plain);
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    // A portable invitation is a bearer capability: the key travels with the
    // ciphertext. It hides plaintext in the share, not from its recipient.
    let envelope = [key.to_vec(), seal(&key, &plain, INVITE_AAD)?].concat();
    Ok(format!(
        "{}{}",
        INVITE_PREFIX,
        URL_SAFE_NO_PAD.encode(envelope)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authenticated_secrets_reject_tampering_and_wrong_context() {
        let key = [42; 32];
        let mut value = seal(&key, "Test12345", LOCAL_AAD).unwrap();
        assert_eq!(open(&key, &value, LOCAL_AAD).unwrap(), "Test12345");
        assert!(open(&key, &value, INVITE_AAD).is_err());
        value[15] ^= 1;
        assert!(open(&key, &value, LOCAL_AAD).is_err());
    }
    #[test]
    fn invites_round_trip_with_fresh_nonces() {
        let a = export_lobby_password("Test12345".into()).unwrap();
        let b = export_lobby_password("Test12345".into()).unwrap();
        assert_ne!(a, b);
        assert_eq!(resolve(&a).unwrap(), "Test12345");
        assert!(!a.contains("Test12345"));
    }
}
