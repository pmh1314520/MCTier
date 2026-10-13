//! Daily Quark support after sign-in. Session cookies never cross IPC; no retries of a save POST.
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{FixedOffset, Utc};
use rand::RngCore;
use reqwest::{cookie::CookieStore, header::HeaderValue, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const SHARE: &str = "aee110172d26";
const MAX_STATE_BYTES: usize = 4 * 1024 * 1024;
const ORIGINS: [&str; 3] = [
    "https://pan.quark.cn/",
    "https://drive-pc.quark.cn/",
    "https://drive-h.quark.cn/",
];
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
static STOP: AtomicBool = AtomicBool::new(false);
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    cookies: String,
    account: String,
    name: String,
    enabled: bool,
    dismissed: bool,
    attempts: BTreeMap<String, String>,
    contributions: BTreeMap<String, BTreeMap<String, Contribution>>,
    result: String,
    background_registered: bool,
    background_error: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Contribution {
    // Snapshot the reference price. Future rate changes must not reprice past records.
    pc_cents: u32,
    mobile_cents: u32,
    rules_version: String,
}
impl Contribution {
    fn current() -> Self {
        Self {
            pc_cents: 22,
            mobile_cents: 47,
            rules_version: "2026-09-01".into(),
        }
    }
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportStats {
    success_days: usize,
    pc_reference_cents: u64,
    mobile_reference_cents: u64,
    first_day: Option<String>,
    last_day: Option<String>,
    today_attempted: bool,
}
impl Saved {
    fn needs_attempt(&self, day: &str) -> bool {
        !self.account.is_empty()
            && !self
                .attempts
                .get(&self.account)
                .is_some_and(|value| value == day)
            && !self
                .contributions
                .get(&self.account)
                .is_some_and(|days| days.contains_key(day))
    }
    fn logged_out(&mut self) -> Self {
        Self {
            attempts: std::mem::take(&mut self.attempts),
            contributions: std::mem::take(&mut self.contributions),
            dismissed: self.dismissed,
            // Preserve scheduling status until removal is confirmed.
            background_registered: self.background_registered,
            background_error: self.background_error.clone(),
            result: "已退出本设备登录；转存文件和本机统计保留，重登原账号可查看".into(),
            ..Self::default()
        }
    }
    fn stats(&self, today: &str) -> SupportStats {
        let mut stats = SupportStats::default();
        if self.account.is_empty() {
            return stats;
        }
        stats.today_attempted = self.attempts.get(&self.account).is_some_and(|d| d == today);
        if let Some(days) = self.contributions.get(&self.account) {
            stats.success_days = days.len();
            stats.first_day = days.keys().next().cloned();
            stats.last_day = days.keys().next_back().cloned();
            stats.pc_reference_cents = days.values().map(|d| u64::from(d.pc_cents)).sum();
            stats.mobile_reference_cents = days.values().map(|d| u64::from(d.mobile_cents)).sum();
        }
        stats
    }
    fn record_success(&mut self, day: &str) {
        if !self.account.is_empty() {
            self.contributions
                .entry(self.account.clone())
                .or_default()
                .entry(day.into())
                .or_insert_with(Contribution::current);
        }
    }
}
fn beijing_day() -> String {
    Utc::now()
        .with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap())
        .format("%Y-%m-%d")
        .to_string()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    logged_in: bool,
    name: String,
    enabled: bool,
    dismissed: bool,
    result: String,
    background_supported: bool,
    background_registered: bool,
    background_error: String,
    qr_url: Option<String>,
    login_id: Option<String>,
    login_method: Option<&'static str>,
    expires_in: u64,
    stats: SupportStats,
}
#[derive(Clone, Copy, PartialEq)]
enum LoginMethod {
    Qr,
    Mobile,
}
impl LoginMethod {
    fn name(self) -> &'static str {
        match self {
            Self::Qr => "qr",
            Self::Mobile => "mobile",
        }
    }
    fn ttl(self) -> u64 {
        match self {
            Self::Qr => 120,
            Self::Mobile => 600,
        }
    }
}
struct Login {
    method: LoginMethod,
    token: String,
    id: String,
    started: Instant,
}
struct Service {
    saved: Saved,
    jar: Arc<SessionCookies>,
    client: Client,
    login: Option<Login>,
    background_checked: Option<Instant>,
    #[cfg(test)]
    io: Option<std::sync::Mutex<TestIo>>,
}
#[derive(Default)]
struct SessionCookies(RwLock<cookie_store::CookieStore>);
impl CookieStore for SessionCookies {
    fn set_cookies(&self, headers: &mut dyn Iterator<Item = &HeaderValue>, url: &Url) {
        if let Ok(mut store) = self.0.write() {
            for header in headers {
                if let Ok(raw) = header.to_str() {
                    let _ = store.parse(raw, url);
                }
            }
        }
    }
    fn cookies(&self, url: &Url) -> Option<HeaderValue> {
        let store = self.0.read().ok()?;
        let header = store
            .get_request_values(url)
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        if header.is_empty() {
            None
        } else {
            HeaderValue::from_str(&header).ok()
        }
    }
}
impl SessionCookies {
    fn restore(serialized: &str) -> Result<Self, String> {
        let store = if serialized.is_empty() {
            cookie_store::CookieStore::default()
        } else {
            cookie_store::serde::json::load(serialized.as_bytes())
                .map_err(|_| "夸克会话数据无效，请重新登录")?
        };
        Ok(Self(RwLock::new(store)))
    }
    fn snapshot(&self) -> Result<String, String> {
        let store = self.0.read().map_err(|_| "无法读取夸克会话")?;
        // Preserve domain/path/absolute expiry and session cookies. Never renew Max-Age on restart.
        serde_json::to_string(&store.iter_unexpired().collect::<Vec<_>>())
            .map_err(|_| "无法保存夸克会话".into())
    }
}
#[cfg(test)]
#[derive(Default)]
struct TestIo {
    responses: std::collections::VecDeque<Value>,
    requests: Vec<String>,
    persisted: Vec<Saved>,
    fail_persist: bool,
    persist_to_disk: bool,
}
fn state() -> &'static Mutex<Option<Service>> {
    static STATE: OnceLock<Mutex<Option<Service>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}
fn key() -> Result<Vec<u8>, String> {
    #[cfg(test)]
    let test_key = std::env::var("MCTIER_TEST_QUARK_KEY").ok();
    #[cfg(test)]
    let entry_name = test_key.as_deref().unwrap_or("quark-support-v1");
    #[cfg(not(test))]
    let entry_name = "quark-support-v1";
    let entry = keyring::Entry::new("MCTier", entry_name).map_err(|_| "系统凭据库不可用")?;
    match entry.get_password() {
        Ok(encoded) => STANDARD.decode(encoded).map_err(|_| "凭据密钥损坏".into()),
        Err(keyring::Error::NoEntry) => {
            let mut key = vec![0; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            entry
                .set_password(&STANDARD.encode(&key))
                .map_err(|_| "无法保存凭据密钥")?;
            Ok(key)
        }
        Err(_) => Err("系统凭据库已锁定，请稍后重试".into()),
    }
}
fn cipher() -> Result<Aes256Gcm, String> {
    Aes256Gcm::new_from_slice(&key()?).map_err(|_| "凭据密钥无效".into())
}
fn path() -> Result<std::path::PathBuf, String> {
    #[cfg(test)]
    {
        if let Some(path) = std::env::var_os("MCTIER_TEST_QUARK_STATE") {
            return Ok(path.into());
        }
        // Unit tests must not inherit a real user's logout marker or touch their
        // encrypted login. Tests requiring real persistence supply an isolated path.
        static TEST_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();
        return Ok(TEST_PATH
            .get_or_init(|| {
                std::env::temp_dir()
                    .join(format!("mctier-quark-unit-{}", uuid::Uuid::new_v4()))
                    .join("quark-test.bin")
            })
            .clone());
    }
    #[cfg(not(test))]
    {
        Ok(super::app_paths::data_root()
            .map_err(|_| "无法访问应用数据目录")?
            .join("quark-support.bin"))
    }
}
fn read() -> Result<Saved, String> {
    let path = path()?;
    let bytes = match std::fs::read(path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
        Err(_) => return Err("无法读取夸克登录数据".into()),
    };
    if bytes.len() < 28 || bytes.len() > MAX_STATE_BYTES {
        return Err("夸克登录数据损坏".into());
    }
    let plain = cipher()?
        .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
        .map_err(|_| "无法解密夸克登录数据")?;
    serde_json::from_slice(&plain).map_err(|_| "夸克登录数据格式无效".into())
}
fn account_id(info: &Value, cookie_header: Option<&str>) -> Option<String> {
    for field in ["qid", "uid"] {
        let id = match &info[field] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        if !id.trim().is_empty() && id != "0" {
            return Some(id);
        }
    }
    // The official web client reads __uid; account/info may contain only profile fields.
    cookie_header?.split(';').find_map(|pair| {
        let (name, value) = pair.trim().split_once('=')?;
        (name == "__uid" && !value.is_empty() && value != "0").then(|| value.to_owned())
    })
}
fn drive_url(route: &str) -> String {
    let host = if route.starts_with("share/") {
        "drive-h"
    } else {
        "drive-pc"
    };
    format!("https://{host}.quark.cn/1/clouddrive/{route}")
}
impl Service {
    fn new(saved: Saved) -> Result<Self, String> {
        let jar = Arc::new(SessionCookies::restore(&saved.cookies)?);
        let client = Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(UA)
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "无法初始化夸克连接")?;
        Ok(Self {
            saved,
            jar,
            client,
            login: None,
            background_checked: None,
            #[cfg(test)]
            io: None,
        })
    }
    /// Call only while holding the cross-process state lock. Keep an unfinished
    /// login's temporary cookie jar, but never overwrite newer on-disk account data.
    fn refresh(&mut self, saved: Saved) -> Result<(), String> {
        if self.saved.account != saved.account || self.saved.cookies != saved.cookies {
            let checked = self.background_checked;
            *self = Self::new(saved)?;
            self.background_checked = checked;
        } else {
            self.saved = saved;
        }
        Ok(())
    }
    fn persist(&mut self) -> Result<(), String> {
        #[cfg(test)]
        if let Some(io) = &self.io {
            let mut io = io.lock().unwrap();
            if io.fail_persist {
                return Err("test storage unavailable".into());
            }
            io.persisted.push(self.saved.clone());
            if !io.persist_to_disk {
                return Ok(());
            }
        }
        self.saved.cookies.clear();
        if !self.saved.account.is_empty() {
            self.saved.cookies = self.jar.snapshot()?;
        }
        let plain = serde_json::to_vec(&self.saved).map_err(|_| "无法保存夸克设置")?;
        if plain.len() > MAX_STATE_BYTES - 28 {
            return Err("本机夸克记录过大，未提交新操作".into());
        }
        let mut nonce = [0; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let encrypted = cipher()?
            .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
            .map_err(|_| "无法加密夸克登录数据")?;
        let path = path()?;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建夸克数据目录")?;
        let temporary = path.with_extension("pending");
        use std::io::Write;
        let mut file = std::fs::File::create(&temporary).map_err(|_| "无法写入夸克登录数据")?;
        file.write_all(&[nonce.to_vec(), encrypted].concat())
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法写入夸克登录数据")?;
        drop(file);
        std::fs::rename(temporary, path).map_err(|_| "无法保存夸克登录数据".into())
    }
    fn view(&self) -> View {
        let valid = self.login.as_ref();
        View {
            logged_in: !self.saved.account.is_empty(),
            name: self.saved.name.clone(),
            enabled: !self.saved.account.is_empty(),
            dismissed: self.saved.dismissed,
            result: self.saved.result.clone(),
            background_supported: cfg!(windows),
            background_registered: self.saved.background_registered,
            background_error: self.saved.background_error.clone(),
            qr_url: valid.filter(|l| l.method == LoginMethod::Qr).map(|l| {
                format!(
                    "https://su.quark.cn/4_eMHBJ?token={}&client_id=532&ssb=weblogin&uc_param_str=",
                    urlencoding::encode(&l.token)
                )
            }),
            login_id: valid.map(|l| l.id.clone()),
            login_method: valid.map(|l| l.method.name()),
            expires_in: valid.map_or(0, |l| {
                l.method.ttl().saturating_sub(l.started.elapsed().as_secs())
            }),
            stats: self.saved.stats(&beijing_day()),
        }
    }
    async fn request(
        &self,
        url: &str,
        params: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        #[cfg(test)]
        if let Some(io) = &self.io {
            let mut io = io.lock().unwrap();
            if url.ends_with("sharepage/save") {
                assert!(
                    !io.persisted.is_empty(),
                    "must persist daily reservation before cloud write"
                );
            }
            io.requests.push(url.to_owned());
            return io
                .responses
                .pop_front()
                .ok_or_else(|| "test network disconnected".into());
        }
        let req = if let Some(body) = body {
            self.client.post(url).json(&body)
        } else {
            self.client.get(url)
        };
        let response = req
            .query(params)
            .header("Referer", "https://pan.quark.cn/")
            .send()
            .await
            .map_err(|_| "夸克网络请求失败，请检查网络后重试")?;
        if url == "https://pan.quark.cn/account/info"
            && response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            return Ok(json!({"success":false}));
        }
        if !response.status().is_success() {
            return Err(format!(
                "夸克请求未完成（HTTP {}），请稍后重试",
                response.status().as_u16()
            ));
        }
        // Never expose response headers, signed URLs, cookies or service tickets in errors.
        response
            .json()
            .await
            .map_err(|_| "夸克接口返回了未知格式，已停止操作".into())
    }
    async fn drive(
        &self,
        route: &str,
        params: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut query = vec![("pr", "ucpro"), ("fr", "pc")];
        query.extend_from_slice(params);
        let data = self.request(&drive_url(route), &query, body).await?;
        if data["code"].as_i64() != Some(0) || data["status"].as_i64() != Some(200) {
            return Err(format!(
                "夸克未接受操作（代码 {}），请检查登录、网盘空间或在夸克官方客户端完成验证",
                data["code"].as_i64().unwrap_or(-1)
            ));
        }
        Ok(data)
    }
    async fn begin(&mut self) -> Result<(), String> {
        let data = self
            .request(
                "https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin",
                &[("client_id", "532"), ("v", "1.2")],
                None,
            )
            .await?;
        if data["status"].as_i64() != Some(2000000) {
            return Err("夸克登录二维码暂不可用，请稍后重试".into());
        }
        let token = data["data"]["members"]["token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("夸克未返回登录二维码")?;
        self.login = Some(Login {
            method: LoginMethod::Qr,
            token: token.into(),
            id: uuid::Uuid::new_v4().to_string(),
            started: Instant::now(),
        });
        Ok(())
    }
    async fn poll(&mut self, id: Option<&str>) -> Result<(), String> {
        let Some(login) = &self.login else {
            return Ok(());
        };
        if login.method != LoginMethod::Qr || Some(login.id.as_str()) != id {
            return Ok(());
        }
        if login.started.elapsed().as_secs() >= 120 {
            return self.begin().await;
        }
        let token = login.token.clone();
        let data = self
            .request(
                "https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken",
                &[("client_id", "532"), ("v", "1.2"), ("token", &token)],
                None,
            )
            .await?;
        match data["status"].as_i64() {
            Some(50004001) => return Ok(()), // Not confirmed by the account owner yet.
            Some(50004002) => return self.begin().await,
            Some(2000000) => (),
            _ => {
                self.login = None;
                return Err("夸克登录验证未完成，请重新登录或使用官方客户端完成验证".into());
            }
        }
        let st = data["data"]["members"]["service_ticket"]
            .as_str()
            .ok_or("夸克未返回登录凭据")?;
        self.complete_login(st).await
    }
    fn begin_mobile(&mut self) -> Result<(), String> {
        if !self.saved.account.is_empty() {
            return Err("请先退出当前夸克账号".into());
        }
        self.login = Some(Login {
            method: LoginMethod::Mobile,
            token: String::new(),
            id: uuid::Uuid::new_v4().to_string(),
            started: Instant::now(),
        });
        Ok(())
    }
    async fn complete_mobile(
        &mut self,
        id: Option<&str>,
        ticket: Option<&str>,
    ) -> Result<(), String> {
        let valid = self.login.as_ref().is_some_and(|l| {
            l.method == LoginMethod::Mobile
                && Some(l.id.as_str()) == id
                && l.started.elapsed().as_secs() < l.method.ttl()
        });
        if !valid || !self.saved.account.is_empty() {
            return Err("手机号登录已取消或过期，请重新打开登录页面".into());
        }
        let ticket = ticket
            .filter(|s| s.len() == 32 && s.bytes().all(|b| b.is_ascii_alphanumeric()))
            .ok_or("夸克登录返回无效，请重新登录")?;
        self.complete_login(ticket).await
    }
    async fn complete_login(&mut self, st: &str) -> Result<(), String> {
        let account = self
            .request("https://pan.quark.cn/account/info", &[("st", st)], None)
            .await?;
        if account["success"].as_bool() != Some(true) {
            return Err("夸克未确认登录成功，请重新登录".into());
        }
        let info = &account["data"];
        let header = self.jar.cookies(&Url::parse(ORIGINS[0]).unwrap());
        let uid = account_id(info, header.as_ref().and_then(|h| h.to_str().ok()))
            .ok_or("无法确认夸克账号，未保存登录信息")?;
        self.saved.account = uid;
        self.saved.name = info["nickname"]
            .as_str()
            .or_else(|| info["nick_name"].as_str())
            .unwrap_or("夸克用户")
            .chars()
            .take(64)
            .collect();
        self.saved.enabled = true;
        self.saved.result = "登录成功；已开启每日自动转存".into();
        self.login = None;
        if let Err(e) = self.persist() {
            self.saved.account.clear();
            self.saved.name.clear();
            self.saved.cookies.clear();
            self.saved.result = "登录凭据保存失败，请重新登录".into();
            return Err(e);
        }
        Ok(())
    }
    // Read-only account check: transport/format failures must not erase a valid login.
    async fn verify_session(&mut self) -> Result<bool, String> {
        if self.saved.account.is_empty() {
            return Ok(false);
        }
        let account = self
            .request("https://pan.quark.cn/account/info", &[], None)
            .await?;
        let success = account["success"]
            .as_bool()
            .ok_or("无法确认登录状态，请稍后重试")?;
        let header = self.jar.cookies(&Url::parse(ORIGINS[0]).unwrap());
        let uid = if success {
            Some(
                account_id(
                    &account["data"],
                    header.as_ref().and_then(|h| h.to_str().ok()),
                )
                .ok_or("无法确认登录状态，请稍后重试")?,
            )
        } else {
            None
        };
        if uid.as_deref() == Some(self.saved.account.as_str()) {
            return Ok(true);
        }
        // Verification gates transfers; only explicit logout removes saved credentials.
        self.saved.result = "登录已失效或账号发生变化，请退出后重新登录".into();
        Ok(false)
    }
    async fn daily(&mut self, day: &str) -> Result<(), String> {
        if self.saved.account.is_empty() || stop_requested() {
            return Ok(());
        }
        if !self.saved.needs_attempt(day) {
            return Ok(());
        }
        let started_on = beijing_day();
        if !self.verify_session().await? {
            return Err("登录已失效或账号发生变化，请重新登录".into());
        }
        let result = self.save_share(day, &started_on).await;
        if result.is_err() && matches!(self.verify_session().await, Ok(false)) {
            return Err("登录已失效或账号发生变化，请重新登录".into());
        }
        if result.is_ok() {
            self.saved.record_success(day);
        }
        self.saved.result = match &result {
            Ok(()) => format!("{day}：转存成功（不代表计佣成功）"),
            Err(e)
                if self
                    .saved
                    .attempts
                    .get(&self.saved.account)
                    .is_some_and(|d| d == day) =>
            {
                format!("{day}：{e}；今日不重复提交")
            }
            Err(e) => format!("{day}：{e}；将自动重试"),
        };
        if self.persist().is_err() {
            self.saved
                .result
                .push_str("；本机记录保存失败，重启后可能丢失本次统计");
        }
        result
    }
    async fn save_share(&mut self, day: &str, started_on: &str) -> Result<(), String> {
        let token = self
            .drive(
                "share/sharepage/token",
                &[],
                Some(json!({"pwd_id": SHARE,"passcode":""})),
            )
            .await?;
        let stoken = token["data"]["stoken"].as_str().ok_or("分享已失效")?;
        let mut fids = Vec::new();
        let mut tokens = Vec::new();
        for page in 1..=20 {
            if stop_requested() {
                return Err("已取消转存".into());
            }
            let page = page.to_string();
            let result = self
                .drive(
                    "share/sharepage/detail",
                    &[
                        ("pwd_id", SHARE),
                        ("stoken", stoken),
                        ("pdir_fid", "0"),
                        ("_page", &page),
                        ("_size", "100"),
                        ("_fetch_total", "1"),
                    ],
                    None,
                )
                .await?;
            let files = result["data"]["list"]
                .as_array()
                .ok_or("分享文件列表无效")?;
            for file in files {
                fids.push(file["fid"].as_str().ok_or("分享文件 ID 缺失")?.to_string());
                tokens.push(
                    file["share_fid_token"]
                        .as_str()
                        .ok_or("分享文件授权缺失")?
                        .to_string(),
                );
            }
            if files.len() < 100 {
                break;
            }
            if page == "20" {
                return Err("分享内容过多，已停止本次转存".into());
            }
        }
        if fids.is_empty() {
            return Err("分享中没有可转存的文件".into());
        }
        if stop_requested() {
            return Err("已取消转存".into());
        }
        if beijing_day() != started_on {
            return Err("准备期间已跨日，将按新日期自动转存".into());
        }
        // Reserve only after preparation succeeds, immediately before the cloud write.
        // Roll back in memory on storage failure so the next automatic check can recover.
        let previous = self
            .saved
            .attempts
            .insert(self.saved.account.clone(), day.into());
        self.saved.result = format!("{day}：正在自动转存");
        if self.persist().is_err() {
            if let Some(previous) = previous {
                self.saved
                    .attempts
                    .insert(self.saved.account.clone(), previous);
            } else {
                self.saved.attempts.remove(&self.saved.account);
            }
            return Err("无法保存今日执行记录，未提交转存".into());
        }
        let result = self.drive("share/sharepage/save", &[], Some(json!({"pwd_id":SHARE,"stoken":stoken,"fid_list":fids,"fid_token_list":tokens,"pdir_fid":"0","to_pdir_fid":"0","scene":"link"}))).await?;
        let task = result["data"]["task_id"]
            .as_str()
            .ok_or("转存已提交，但未返回任务编号；请在夸克中确认")?;
        for retry in 0..15 {
            if stop_requested() {
                return Err("已停止等待，已提交的转存任务请在夸克中确认".into());
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
            let index = retry.to_string();
            let result = self
                .drive("task", &[("task_id", task), ("retry_index", &index)], None)
                .await?;
            match result["data"]["status"].as_i64() {
                Some(2) => return Ok(()),
                Some(3) | Some(4) => return Err("夸克转存任务失败，请检查空间或分享状态".into()),
                _ => (),
            }
        }
        Err("转存已提交但完成状态未确认，请在夸克中查看".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn successful_dates_are_unique_account_scoped_and_keep_rate_snapshots() {
        let mut saved = Saved {
            account: "alice".into(),
            ..Saved::default()
        };
        saved.record_success("2026-10-01");
        saved.record_success("2026-10-03");
        saved.record_success("2026-10-01");
        let stats = saved.stats("2026-10-03");
        assert_eq!(stats.success_days, 2);
        assert_eq!(stats.pc_reference_cents, 44);
        assert_eq!(stats.mobile_reference_cents, 94);
        assert_eq!(stats.first_day.as_deref(), Some("2026-10-01"));
        assert_eq!(stats.last_day.as_deref(), Some("2026-10-03"));
        saved
            .contributions
            .get_mut("alice")
            .unwrap()
            .get_mut("2026-10-01")
            .unwrap()
            .pc_cents = 30;
        saved.record_success("2026-10-01"); // Existing snapshot cannot be repriced by a later retry/rate change.
        assert_eq!(saved.stats("2026-10-03").pc_reference_cents, 52);
        saved.account = "bob".into();
        assert_eq!(saved.stats("2026-10-03").success_days, 0);
        saved.record_success("2026-10-03");
        assert_eq!(saved.stats("2026-10-03").pc_reference_cents, 22);
        let mut reloaded: Saved =
            serde_json::from_slice(&serde_json::to_vec(&saved.logged_out()).unwrap()).unwrap();
        assert_eq!(reloaded.stats("2026-10-03").success_days, 0);
        reloaded.account = "alice".into();
        assert_eq!(reloaded.stats("2026-10-03").success_days, 2);
        assert_eq!(reloaded.stats("2026-10-03").pc_reference_cents, 52);
    }
    #[test]
    fn legacy_attempts_or_result_text_are_never_invented_as_support_income() {
        let mut s = service(vec![]);
        s.saved.attempts.insert("alice".into(), "2026-10-01".into());
        s.saved.result = "2026-10-01：转存成功（不代表计佣成功）".into();
        assert!(s.io.as_ref().unwrap().lock().unwrap().requests.is_empty());
        let stats = s.saved.stats("2026-10-01");
        assert!(stats.today_attempted);
        assert_eq!(stats.success_days, 0);
        assert_eq!(stats.pc_reference_cents, 0);
        assert!(!s.saved.stats("2026-10-02").today_attempted);
    }
    #[test]
    fn session_cookie_restart_preserves_scope_expiry_and_rotation() {
        let jar = SessionCookies::default();
        let pan = Url::parse("https://pan.quark.cn/").unwrap();
        let drive = Url::parse("https://drive-h.quark.cn/1/clouddrive/task").unwrap();
        let initial = [
            HeaderValue::from_static("__uid=alice; Domain=quark.cn; Path=/; Secure; Max-Age=3600"),
            HeaderValue::from_static("host=only; Path=/account; Secure"),
            HeaderValue::from_static("expired=old; Path=/; Max-Age=0"),
        ];
        jar.set_cookies(&mut initial.iter(), &pan);
        let disk = jar.snapshot().unwrap();
        let restored = SessionCookies::restore(&disk).unwrap();
        let before: Vec<Value> = serde_json::from_str(&disk).unwrap();
        let after: Vec<Value> = serde_json::from_str(&restored.snapshot().unwrap()).unwrap();
        for cookie in before {
            assert!(after.contains(&cookie));
        } // Absolute expiry must not be extended.
        assert_eq!(restored.cookies(&drive).unwrap(), "__uid=alice");
        assert!(!restored
            .cookies(&pan)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("host="));
        assert!(restored
            .cookies(&Url::parse("https://pan.quark.cn/account/info").unwrap())
            .unwrap()
            .to_str()
            .unwrap()
            .contains("host=only"));
        assert!(restored
            .cookies(&Url::parse("https://example.com/").unwrap())
            .is_none());
        assert!(restored
            .cookies(&Url::parse("http://pan.quark.cn/").unwrap())
            .is_none());
        let rotated = [HeaderValue::from_static(
            "__uid=bob; Domain=quark.cn; Path=/; Secure; Max-Age=3600",
        )];
        restored.set_cookies(&mut rotated.iter(), &drive);
        assert_eq!(restored.cookies(&pan).unwrap(), "__uid=bob"); // No stale host-only duplicate.
    }
    fn service(responses: Vec<Value>) -> Service {
        let mut s = Service::new(Saved {
            account: "alice".into(),
            enabled: true,
            ..Saved::default()
        })
        .unwrap();
        s.io = Some(std::sync::Mutex::new(TestIo {
            responses: responses.into(),
            ..TestIo::default()
        }));
        s
    }
    fn profile() -> Value {
        json!({"success":true,"data":{"uid":"alice"}})
    }
    fn share_responses() -> Vec<Value> {
        vec![
            profile(),
            json!({"code":0,"status":200,"data":{"stoken":"test-token"}}),
            json!({"code":0,"status":200,"data":{"list":[{"fid":"one","share_fid_token":"test-auth"}]}}),
        ]
    }
    #[test]
    fn disk_refresh_preserves_pending_login_but_discards_revoked_credentials() {
        let mut s = Service::new(Saved::default()).unwrap();
        s.begin_mobile().unwrap();
        let pending = s.login.as_ref().unwrap().id.clone();
        let mut disk = Saved {
            dismissed: true,
            ..Saved::default()
        };
        s.refresh(disk.clone()).unwrap();
        assert_eq!(s.login.as_ref().unwrap().id, pending);
        disk.account = "alice".into();
        disk.background_registered = true;
        disk.record_success("2026-10-01");
        s.refresh(disk.clone()).unwrap();
        assert!(s.login.is_none());
        let pan = Url::parse(ORIGINS[0]).unwrap();
        s.jar.set_cookies(
            &mut [HeaderValue::from_static("session=private; Path=/; Secure")].iter(),
            &pan,
        );
        disk = disk.logged_out();
        s.refresh(disk).unwrap();
        assert!(s.saved.account.is_empty());
        assert!(s.jar.cookies(&pan).is_none());
        assert!(s.saved.background_registered); // Must still remove the existing task.
        assert_eq!(s.saved.contributions["alice"].len(), 1);
    }

    #[tokio::test]
    async fn daily_child_process() {
        use std::io::Write;
        let Some(root) = std::env::var_os("MCTIER_TEST_QUARK_DAILY") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let _lock = super::super::quark_background::wait_for_lock(&root.join("state.lock"))
            .await
            .unwrap();
        let mut responses = share_responses();
        responses.push(json!({"code":0,"status":200,"data":{"task_id":"one"}}));
        responses.push(json!({"code":0,"status":200,"data":{"status":2}}));
        let mut s = service(responses);
        let disk: Saved =
            serde_json::from_slice(&std::fs::read(root.join("state.json")).unwrap()).unwrap();
        // Same account/cookies: preserve mocked transport while importing the newer ledger.
        s.refresh(disk).unwrap();
        s.daily("2026-10-01").await.unwrap();
        std::fs::write(
            root.join("state.json"),
            serde_json::to_vec(&s.saved).unwrap(),
        )
        .unwrap();
        let submissions =
            s.io.as_ref()
                .unwrap()
                .lock()
                .unwrap()
                .requests
                .iter()
                .filter(|url| url.ends_with("sharepage/save"))
                .count();
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("requests"))
            .unwrap();
        for _ in 0..submissions {
            log.write_all(b"save\n").unwrap();
        }
    }

    #[test]
    fn competing_processes_read_latest_ledger_and_submit_once() {
        let temp = tempfile::tempdir().unwrap();
        let saved = Saved {
            account: "alice".into(),
            ..Saved::default()
        };
        std::fs::write(
            temp.path().join("state.json"),
            serde_json::to_vec(&saved).unwrap(),
        )
        .unwrap();
        let launch = || {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "modules::quark_support::tests::daily_child_process",
                ])
                .env("MCTIER_TEST_QUARK_DAILY", temp.path())
                .spawn()
                .unwrap()
        };
        let mut gui = launch();
        let mut worker = launch();
        assert!(gui.wait().unwrap().success());
        assert!(worker.wait().unwrap().success());
        assert!(launch().wait().unwrap().success()); // A fresh scheduled process on the same day.
        assert_eq!(
            std::fs::read_to_string(temp.path().join("requests")).unwrap(),
            "save\n"
        );
        let disk: Saved =
            serde_json::from_slice(&std::fs::read(temp.path().join("state.json")).unwrap())
                .unwrap();
        assert_eq!(disk.stats("2026-10-01").success_days, 1);
    }

    /// Invoked only by scripts/test-quark-background.ps1 with a unique file and vault key.
    /// Real encrypted disk/vault I/O runs under Task Scheduler; only cloud responses are mocked.
    #[tokio::test]
    #[ignore]
    async fn scheduled_storage_probe() {
        let mode = std::env::var("MCTIER_TEST_QUARK_PROBE").unwrap();
        let state_path = path().unwrap();
        let key_name = std::env::var("MCTIER_TEST_QUARK_KEY").unwrap();
        assert!(key_name.starts_with("quark-test-"));
        assert!(state_path.file_name().unwrap() == "quark-test.bin");
        if mode == "cleanup" {
            let _ = keyring::Entry::new("MCTier", &key_name)
                .unwrap()
                .delete_credential();
            return;
        }
        let _lock =
            super::super::quark_background::wait_for_lock(&state_path.with_extension("lock"))
                .await
                .unwrap();
        if mode == "seed" {
            let mut s = Service::new(Saved {
                account: "alice".into(),
                enabled: true,
                ..Saved::default()
            })
            .unwrap();
            s.jar.set_cookies(
                &mut [HeaderValue::from_static(
                    "__uid=alice; Domain=quark.cn; Path=/; Secure; Max-Age=3600",
                )]
                .iter(),
                &Url::parse(ORIGINS[0]).unwrap(),
            );
            // Simulate a pre-background-service release writing its original envelope.
            // New scheduling fields are absent, but the same vault key must still decrypt it.
            let legacy = json!({
                "account":"alice", "name":"Legacy account", "enabled":false,
                "cookies":s.jar.snapshot().unwrap(), "attempts":{}, "contributions":{},
                "dismissed":true, "result":"legacy session"
            });
            let mut nonce = [0u8; 12];
            rand::rngs::OsRng.fill_bytes(&mut nonce);
            let encrypted = cipher().unwrap().encrypt(Nonce::from_slice(&nonce), serde_json::to_vec(&legacy).unwrap().as_slice()).unwrap();
            std::fs::write(&state_path, [nonce.to_vec(), encrypted].concat()).unwrap();
            assert!(
                !String::from_utf8_lossy(&std::fs::read(&state_path).unwrap()).contains("alice")
            );
            return;
        }
        let mut s = Service::new(read().unwrap()).unwrap();
        if mode == "verify" {
            assert_eq!(s.saved.stats(&beijing_day()).success_days, 1);
            assert!(s.saved.stats(&beijing_day()).today_attempted);
            return;
        }
        if mode == "logout" {
            request_stop().unwrap();
            finish_pending_logout(&mut s).unwrap();
            assert!(read().unwrap().account.is_empty());
            return;
        }
        if mode == "verify_logout" {
            assert!(s.saved.account.is_empty());
            assert!(s.saved.cookies.is_empty());
            assert_eq!(s.saved.contributions["alice"].len(), 1);
            return;
        }
        assert_eq!(mode, "worker");
        let was_logged_in = !s.saved.account.is_empty();
        if was_logged_in {
            assert_eq!(
                s.jar.cookies(&Url::parse(ORIGINS[0]).unwrap()).unwrap(),
                "__uid=alice"
            );
        }
        let mut responses = share_responses();
        responses.push(json!({"code":0,"status":200,"data":{"task_id":"test-task"}}));
        responses.push(json!({"code":0,"status":200,"data":{"status":2}}));
        s.io = Some(std::sync::Mutex::new(TestIo {
            responses: responses.into(),
            persist_to_disk: true,
            ..TestIo::default()
        }));
        run_daily(&mut s).await;
        let count =
            s.io.as_ref()
                .unwrap()
                .lock()
                .unwrap()
                .requests
                .iter()
                .filter(|url| url.ends_with("sharepage/save"))
                .count();
        use std::io::Write;
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(state_path.with_extension("submissions"))
            .unwrap();
        for _ in 0..count {
            log.write_all(b"save\n").unwrap();
        }
        if was_logged_in {
            assert_eq!(read().unwrap().stats(&beijing_day()).success_days, 1);
        }
    }
    #[tokio::test]
    async fn confirmed_qr_login_enables_automation_without_exposing_credentials() {
        let mut s = service(vec![
            json!({"status":2000000,"data":{"members":{"service_ticket":"private-ticket"}}}),
            profile(),
        ]);
        s.saved.account.clear();
        s.saved.enabled = false;
        s.login = Some(Login {
            method: LoginMethod::Qr,
            token: "private-token".into(),
            id: "current".into(),
            started: Instant::now(),
        });
        s.poll(Some("current")).await.unwrap();
        assert_eq!(s.saved.account, "alice");
        assert!(s.saved.enabled);
        assert!(s.login.is_none());
        assert_eq!(s.io.as_ref().unwrap().lock().unwrap().persisted.len(), 1);
        let ui = serde_json::to_string(&s.view()).unwrap();
        assert!(!ui.contains("private-ticket"));
        assert!(!ui.contains("private-token"));
        assert!(!ui.contains("cookies"));
    }
    #[tokio::test]
    async fn mobile_login_exchanges_ticket_and_reuses_encrypted_session_flow() {
        let mut s = service(vec![profile()]);
        s.saved.account.clear();
        s.begin_mobile().unwrap();
        let id = s.login.as_ref().unwrap().id.clone();
        assert_eq!(s.view().login_method, Some("mobile"));
        assert!(s.view().qr_url.is_none());
        s.poll(Some(&id)).await.unwrap(); // Mobile sessions never poll the QR endpoint.
        assert!(s.io.as_ref().unwrap().lock().unwrap().requests.is_empty());
        let ticket = "a".repeat(32);
        s.complete_mobile(Some(&id), Some(&ticket)).await.unwrap();
        assert!(s.view().logged_in && s.view().enabled);
        assert!(s.login.is_none());
        let io = s.io.as_ref().unwrap().lock().unwrap();
        assert_eq!(io.requests, vec!["https://pan.quark.cn/account/info"]);
        assert_eq!(io.persisted.len(), 1);
        assert!(!serde_json::to_string(&io.persisted[0])
            .unwrap()
            .contains(&ticket));
        assert!(!serde_json::to_string(&s.view()).unwrap().contains(&ticket));
        drop(io);
        assert!(s.complete_mobile(Some(&id), Some(&ticket)).await.is_err());
    }
    #[tokio::test]
    async fn mobile_login_rejects_stale_cancelled_expired_and_wrong_method_callbacks() {
        let mut s = service(vec![]);
        s.saved.account.clear();
        s.begin_mobile().unwrap();
        let old_id = s.login.as_ref().unwrap().id.clone();
        s.begin_mobile().unwrap();
        let id = s.login.as_ref().unwrap().id.clone();
        let ticket = "a".repeat(32);
        assert!(s
            .complete_mobile(Some(&old_id), Some(&ticket))
            .await
            .is_err());
        assert!(s.complete_mobile(Some(&id), Some("1234")).await.is_err());
        s.login.as_mut().unwrap().started = Instant::now() - Duration::from_secs(601);
        assert!(s.complete_mobile(Some(&id), Some(&ticket)).await.is_err());
        s.login.as_mut().unwrap().started = Instant::now();
        s.login.as_mut().unwrap().method = LoginMethod::Qr;
        assert!(s.complete_mobile(Some(&id), Some(&ticket)).await.is_err());
        s.login = None;
        assert!(s.complete_mobile(Some(&id), Some(&ticket)).await.is_err());
        assert!(s.io.as_ref().unwrap().lock().unwrap().requests.is_empty());
    }
    #[tokio::test]
    async fn mobile_login_does_not_enable_automation_when_account_or_storage_fails() {
        for storage_failure in [false, true] {
            let response = if storage_failure {
                profile()
            } else {
                json!({"success":false})
            };
            let mut s = service(vec![response]);
            s.saved.account.clear();
            s.begin_mobile().unwrap();
            let id = s.login.as_ref().unwrap().id.clone();
            s.io.as_ref().unwrap().lock().unwrap().fail_persist = storage_failure;
            assert!(s
                .complete_mobile(Some(&id), Some(&"a".repeat(32)))
                .await
                .is_err());
            assert!(!s.view().logged_in && !s.view().enabled);
            assert_eq!(s.view().stats.success_days, 0);
        }
    }
    #[tokio::test]
    async fn save_success_requires_completed_task() {
        let mut responses = share_responses();
        responses.push(json!({"code":0,"status":200,"data":{"task_id":"task-one"}}));
        responses.push(json!({"code":0,"status":200,"data":{"status":2}}));
        let mut s = service(responses);
        s.daily(&beijing_day()).await.unwrap();
        assert!(s.saved.result.contains("转存成功"));
        assert_eq!(s.view().stats.success_days, 1);
        assert_eq!(s.view().stats.pc_reference_cents, 22);
        let io = s.io.as_ref().unwrap().lock().unwrap();
        assert_eq!(
            io.requests.last().unwrap(),
            "https://drive-pc.quark.cn/1/clouddrive/task"
        );
    }
    #[tokio::test]
    async fn logged_out_accounts_do_not_transfer() {
        let mut s = service(vec![]);
        s.saved.account.clear();
        s.daily(&beijing_day()).await.unwrap();
        assert!(s.io.as_ref().unwrap().lock().unwrap().requests.is_empty());
    }
    #[tokio::test]
    async fn uncertain_save_is_not_retried_after_restart() {
        let mut s = service(share_responses());
        assert!(s.daily(&beijing_day()).await.is_err()); // Save request loses its response.
        assert_eq!(s.view().stats.success_days, 0);
        let io = s.io.as_ref().unwrap().lock().unwrap();
        assert_eq!(
            io.requests
                .iter()
                .filter(|u| u.ends_with("sharepage/save"))
                .count(),
            1
        );
        assert!(io
            .requests
            .iter()
            .any(|u| u.starts_with("https://drive-h.quark.cn/")));
        let disk = serde_json::to_vec(io.persisted.last().unwrap()).unwrap();
        drop(io);
        let mut restarted = service(vec![]);
        restarted.saved = serde_json::from_slice(&disk).unwrap();
        restarted.daily(&beijing_day()).await.unwrap();
        assert!(restarted
            .io
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .requests
            .is_empty());
    }
    #[tokio::test]
    async fn storage_failure_prevents_save() {
        let mut s = service(share_responses());
        s.io.as_ref().unwrap().lock().unwrap().fail_persist = true;
        assert!(s.daily(&beijing_day()).await.is_err());
        let io = s.io.as_ref().unwrap().lock().unwrap();
        assert!(!io.requests.iter().any(|u| u.ends_with("sharepage/save")));
        assert!(!s.saved.attempts.contains_key("alice"));
    }
    #[tokio::test]
    async fn automatic_checks_save_once_per_day_and_resume_after_restart() {
        fn completed() -> Vec<Value> {
            let mut responses = share_responses();
            responses.push(json!({"code":0,"status":200,"data":{"task_id":"task-one"}}));
            responses.push(json!({"code":0,"status":200,"data":{"status":2}}));
            responses
        }
        let mut s = service(completed());
        s.saved.enabled = false; // Migrate previously manual accounts without a second opt-in.
        s.daily("2026-10-01").await.unwrap();
        s.daily("2026-10-01").await.unwrap();
        let disk = serde_json::to_vec(&s.saved).unwrap();
        let mut restarted = service(completed());
        restarted.saved = serde_json::from_slice(&disk).unwrap();
        restarted.daily("2026-10-01").await.unwrap();
        assert!(restarted
            .io
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .requests
            .is_empty());
        restarted.daily("2026-10-02").await.unwrap();
        restarted.daily("2026-10-02").await.unwrap();
        assert_eq!(restarted.saved.stats("2026-10-02").success_days, 2);
        assert_eq!(
            restarted
                .io
                .as_ref()
                .unwrap()
                .lock()
                .unwrap()
                .requests
                .iter()
                .filter(|u| u.ends_with("sharepage/save"))
                .count(),
            1
        );
    }
    #[tokio::test]
    async fn preparation_failure_can_recover_automatically_without_consuming_today() {
        let mut s = service(vec![profile()]);
        assert!(s.daily("2026-10-01").await.is_err());
        assert!(!s.saved.attempts.contains_key("alice"));
        let mut responses = share_responses();
        responses.push(json!({"code":0,"status":200,"data":{"task_id":"task-one"}}));
        responses.push(json!({"code":0,"status":200,"data":{"status":2}}));
        s.io.as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .responses
            .extend(responses);
        s.daily("2026-10-01").await.unwrap();
        assert_eq!(s.saved.stats("2026-10-01").success_days, 1);
    }
    #[tokio::test]
    async fn changed_or_expired_account_blocks_transfer_without_erasing_credentials() {
        for profile in [
            json!({"success":false}),
            json!({"success":true,"data":{"uid":"bob"}}),
        ] {
            let mut s = service(vec![profile]);
            assert!(s.daily(&beijing_day()).await.is_err());
            assert!(s.saved.enabled);
            assert_eq!(s.saved.account, "alice");
            assert!(s.io.as_ref().unwrap().lock().unwrap().persisted.is_empty());
            assert_eq!(s.io.as_ref().unwrap().lock().unwrap().requests.len(), 1);
        }
    }
    #[tokio::test]
    async fn verification_is_read_only_and_keeps_login_on_network_or_format_errors() {
        for responses in [
            vec![],
            vec![json!({})],
            vec![json!({"success":true,"data":{}})],
        ] {
            let mut s = service(responses);
            assert!(s.verify_session().await.is_err());
            assert!(s.view().logged_in);
            assert!(s
                .io
                .as_ref()
                .unwrap()
                .lock()
                .unwrap()
                .requests
                .iter()
                .all(|u| u.ends_with("account/info")));
        }
        let mut s = service(vec![profile()]);
        assert!(s.verify_session().await.unwrap());
        assert_eq!(s.io.as_ref().unwrap().lock().unwrap().requests.len(), 1);
    }
    #[tokio::test]
    async fn revoked_session_preserves_credentials_and_history_until_explicit_logout() {
        let mut s = service(vec![json!({"success":false})]);
        s.saved.record_success("2026-10-01");
        s.saved.attempts.insert("alice".into(), beijing_day());
        assert!(!s.verify_session().await.unwrap());
        assert!(s.view().logged_in);
        assert_eq!(s.saved.account, "alice");
        assert!(s.saved.contributions.contains_key("alice"));
        assert!(s.saved.attempts.contains_key("alice"));
        assert!(s.io.as_ref().unwrap().lock().unwrap().persisted.is_empty());
        assert_eq!(s.io.as_ref().unwrap().lock().unwrap().requests.len(), 1);
    }
    #[tokio::test]
    async fn expired_qr_recovers_after_network_failure_and_old_poll_is_ignored() {
        let mut s = service(vec![]);
        s.login = Some(Login {
            method: LoginMethod::Qr,
            token: "old-token".into(),
            id: "old-id".into(),
            started: Instant::now() - Duration::from_secs(121),
        });
        s.poll(Some("other-id")).await.unwrap();
        assert!(s.io.as_ref().unwrap().lock().unwrap().requests.is_empty());
        assert!(s.poll(Some("old-id")).await.is_err());
        assert_eq!(s.view().login_id.as_deref(), Some("old-id"));
        assert_eq!(s.view().expires_in, 0);
        s.io.as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .responses
            .push_back(json!({"status":2000000,"data":{"members":{"token":"new-token"}}}));
        s.poll(Some("old-id")).await.unwrap();
        assert_ne!(s.view().login_id.as_deref(), Some("old-id"));
        assert!(s.view().expires_in > 0);
    }
    #[test]
    fn profile_ids_support_official_cookie_fallback_without_using_session_secrets() {
        assert_eq!(
            account_id(&json!({"uid":123}), None).as_deref(),
            Some("123")
        );
        assert_eq!(
            account_id(
                &json!({"nickname":"user"}),
                Some("__kp=secret; __uid=alice")
            )
            .as_deref(),
            Some("alice")
        );
        assert!(account_id(&json!({}), Some("__kp=secret; __kps=session")).is_none());
        assert!(drive_url("task").starts_with("https://drive-pc.quark.cn/"));
    }
}

fn stop_requested() -> bool {
    STOP.load(Ordering::Acquire) || path().map_or(true, |p| p.with_extension("stop").exists())
}

fn request_stop() -> Result<(), String> {
    STOP.store(true, Ordering::Release);
    let stop = path()?.with_extension("stop");
    std::fs::create_dir_all(stop.parent().unwrap()).map_err(|_| "无法停止夸克后台检查")?;
    std::fs::write(stop, []).map_err(|_| "无法通知夸克后台停止，请重试".into())
}

fn clear_stop() -> Result<(), String> {
    match std::fs::remove_file(path()?.with_extension("stop")) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("无法恢复夸克自动转存，请退出后重新登录".into()),
    }
    STOP.store(false, Ordering::Release);
    Ok(())
}

fn finish_pending_logout(service: &mut Service) -> Result<(), String> {
    // A GUI killed after requesting logout must not leave reusable credentials behind.
    if stop_requested() && !service.saved.account.is_empty() {
        *service = Service::new(service.saved.logged_out())?;
        service.persist()?;
    }
    Ok(())
}

// All disk access, cookie rotation, reservations and scheduler changes are serialized
// across the GUI and worker. Never use a cached Service without refreshing under this lock.
fn refresh_state(guard: &mut Option<Service>) -> Result<(), String> {
    let saved = read()?;
    if let Some(service) = guard {
        service.refresh(saved)
    } else {
        *guard = Some(Service::new(saved)?);
        Ok(())
    }
}

async fn reconcile_background(service: &mut Service, force: bool) {
    if !cfg!(windows) {
        return;
    }
    let enabled = !service.saved.account.is_empty() && !stop_requested();
    if !force {
        if let Some(last) = service.background_checked {
            if service.saved.background_registered == enabled
                && service.saved.background_error.is_empty()
            {
                return; // Register once per GUI launch/login; no periodic scheduler RPCs.
            }
            if !service.saved.background_error.is_empty()
                && last.elapsed() < Duration::from_secs(15 * 60)
            {
                return;
            }
        }
    }
    // Failed configuration is retried with backoff. No login is lost.
    let old = (
        service.saved.background_registered,
        service.saved.background_error.clone(),
    );
    match super::quark_background::configure(enabled).await {
        Ok(()) => {
            service.saved.background_registered = enabled;
            service.saved.background_error.clear();
        }
        Err(error) => {
            service.saved.background_registered = false;
            service.saved.background_error = error;
        }
    }
    service.background_checked = Some(Instant::now());
    if old
        != (
            service.saved.background_registered,
            service.saved.background_error.clone(),
        )
    {
        if service.persist().is_err() {
            service.saved.background_error = "后台配置结果无法保存，请检查本机存储".into();
        }
    }
}

async fn run_daily(service: &mut Service) {
    if let Err(error) = service.daily(&beijing_day()).await {
        if !service.saved.result.contains(&error) {
            service.saved.result = error;
            let _ = service.persist();
        }
    }
}

async fn automatic_check() {
    let mut guard = state().lock().await;
    let Ok(path) = path() else { return };
    let Ok(Some(_lock)) = super::quark_background::try_lock(&path.with_extension("lock")) else {
        return;
    };
    if refresh_state(&mut guard).is_err() {
        return;
    }
    let service = guard.as_mut().unwrap();
    if finish_pending_logout(service).is_err() {
        return;
    }
    reconcile_background(service, false).await;
    run_daily(service).await;
    if service.saved.account.is_empty()
        && (service.saved.background_registered || !service.saved.background_error.is_empty())
    {
        reconcile_background(service, true).await;
    }
}

/// A scheduled process performs one check and exits. After success there are no
/// repeating processes; Task Scheduler retries failures every 15 minutes.
#[cfg(windows)]
pub(super) async fn background_check() -> Result<(), String> {
    let Some(_lock) = super::quark_background::try_lock(&path()?.with_extension("lock"))? else {
        return Err("另一进程正在检查，稍后重试".into());
    };
    let saved = read()?;
    let day = beijing_day();
    // Most logon checks end here without even constructing an HTTP client.
    if !saved.account.is_empty() && !saved.needs_attempt(&day) && !stop_requested() {
        return Ok(());
    }
    let mut service = Service::new(saved)?;
    finish_pending_logout(&mut service)?;
    if service.saved.account.is_empty() || stop_requested() {
        reconcile_background(&mut service, true).await;
        return Ok(());
    }
    run_daily(&mut service).await;
    if service.saved.account.is_empty() {
        reconcile_background(&mut service, true).await;
    }
    if service.saved.needs_attempt(&day) {
        Err("当天尚未提交，稍后重试".into())
    } else {
        Ok(())
    }
}

pub fn start() {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    tauri::async_runtime::spawn(async {
        loop {
            automatic_check().await;
            tokio::time::sleep(Duration::from_secs(15 * 60)).await;
        }
    });
}

#[tauri::command]
pub async fn quark_support(
    window: tauri::WebviewWindow,
    action: String,
    login_id: Option<String>,
    service_ticket: Option<String>,
) -> Result<View, String> {
    if window.label() != "main"
        || !super::media_permission::trusted(window.url().map_err(|_| "无效来源")?.as_str())
    {
        return Err("仅 MCTier 主窗口可管理夸克赞助".into());
    }
    if action == "startup_status" {
        // Persistence replaces the whole encrypted file atomically. This read-only
        // initial snapshot must not queue behind the worker's HTTP/scheduler locks.
        return Service::new(read()?).map(|service| service.view());
    }
    if action == "logout" {
        request_stop()?;
    }
    let mut guard = state().lock().await;
    let _lock = super::quark_background::wait_for_lock(&path()?.with_extension("lock")).await?;
    if let Err(error) = refresh_state(&mut guard) {
        match action.as_str() {
            "logout" => {
                let path = path()?;
                if path.exists() {
                    std::fs::remove_file(path).map_err(|_| "无法移除本机登录凭据，请重试")?;
                }
                *guard = Some(Service::new(Saved::default())?);
            }
            _ => return Err(error),
        }
    }
    let s = guard.as_mut().unwrap();
    match action.as_str() {
        "status" => (),
        "daily" => run_daily(s).await,
        "verify" => {
            s.verify_session().await?;
        }
        "login" => s.begin().await?,
        "mobile_login" => s.begin_mobile()?,
        "poll" | "mobile_complete" => {
            let was_logging_in = s.login.is_some();
            if action == "mobile_complete" {
                s.complete_mobile(login_id.as_deref(), service_ticket.as_deref())
                    .await?;
            } else {
                s.poll(login_id.as_deref()).await?;
            }
            if was_logging_in && s.login.is_none() && !s.saved.account.is_empty() {
                clear_stop()?;
                reconcile_background(s, true).await;
                tauri::async_runtime::spawn(automatic_check());
            }
        }
        "cancel" => {
            if s.login
                .as_ref()
                .is_some_and(|l| Some(l.id.as_str()) == login_id.as_deref())
            {
                s.login = None;
            }
        }
        "dismiss" => {
            s.saved.dismissed = true;
            s.persist()?;
        }
        "logout" => {
            let saved = s.saved.logged_out();
            *s = Service::new(saved)?;
            if s.persist().is_err() {
                let path = path()?;
                if path.exists() {
                    std::fs::remove_file(path).map_err(|_| "无法移除本机登录凭据，请重试")?;
                }
                s.saved.result =
                    "已退出登录；本机存储不可用，统计仅暂存于内存，重启后可能丢失".into();
            }
            let pending = path()?.with_extension("pending");
            if pending.exists() {
                std::fs::remove_file(pending).map_err(|_| "无法移除临时登录凭据，请重试")?;
            }
        }
        _ => return Err("未知夸克赞助操作".into()),
    }
    if action == "logout" || action == "verify" || action == "daily" {
        reconcile_background(s, action == "logout").await;
    }
    Ok(s.view())
}
