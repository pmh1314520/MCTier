//! Isolated integration fixture, never included in the application binary.
use std::{borrow::Cow, collections::HashMap, sync::{Arc, Mutex}, time::Duration};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
type Report = Arc<Mutex<Option<serde_json::Value>>>;
#[tauri::command]
fn audio_check_report(app: tauri::AppHandle, result: tauri::State<'_, Report>, report: serde_json::Value) {
    *result.lock().unwrap() = Some(report); app.exit(0);
}
#[tauri::command]
fn native_microphone_supported() -> bool { true }
#[tauri::command]
async fn audio_check_ice_server() -> Result<Option<String>, String> {
    std::env::var("MCTIER_AUDIO_CHECK_INTERFACE").ok().map(|ip| {
        crate::modules::voice_ice::start_for_ip(ip.parse().map_err(|_| "Invalid test interface")?)
    }).transpose()
}
#[tauri::command]
fn audio_check_outputs() -> Result<serde_json::Value, String> {
    let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let collection = enumerator.get_device_collection(&wasapi::Direction::Render).map_err(|e| e.to_string())?;
    let mut outputs = Vec::new();
    for index in 0..collection.get_nbr_devices().map_err(|e| e.to_string())? {
        let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
        let sessions = device.get_iaudiosessionmanager().and_then(|m| m.get_audiosessionenumerator()).map_err(|e| e.to_string())?;
        let mut active = Vec::new();
        for n in 0..sessions.get_count().map_err(|e| e.to_string())? {
            let session = sessions.get_session(n).map_err(|e| e.to_string())?;
            if session.get_state().ok() == Some(wasapi::SessionState::Active) { active.push(session.get_process_id().unwrap_or_default()); }
        }
        if !active.is_empty() { outputs.push(serde_json::json!({ "name": device.get_friendlyname().unwrap_or_default(), "processes": active })); }
    }
    Ok(serde_json::json!(outputs))
}
#[tauri::command]
async fn native_microphone_start(window: tauri::WebviewWindow, device_id: String, system_processing: bool) -> Result<serde_json::Value, String> {
    if std::env::var_os("MCTIER_AUDIO_CHECK_REAL_MIC").is_some() {
        return crate::modules::native_microphone::native_microphone_start(window, device_id, system_processing).await.and_then(|info| serde_json::to_value(info).map_err(|e| e.to_string()));
    }
    Ok(serde_json::json!({ "id": "test-tone", "deviceId": "test-tone", "sampleRate": 48000 }))
}
#[tauri::command]
async fn native_microphone_read(window: tauri::WebviewWindow, id: String) -> Result<tauri::ipc::Response, String> {
    if id != "test-tone" { return crate::modules::native_microphone::native_microphone_read(window, id).await; }
    tokio::time::sleep(Duration::from_millis(20)).await;
    let bytes = (0..960).flat_map(|sample| (0.1f32 * (sample as f32 * std::f32::consts::TAU * 500.0 / 48000.0).sin()).to_le_bytes()).collect::<Vec<_>>();
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
fn native_microphone_stop(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    if id != "test-tone" { return crate::modules::native_microphone::native_microphone_stop(window, id); }
    Ok(())
}
struct Assets(HashMap<String, Vec<u8>>);
impl tauri::Assets<tauri::Wry> for Assets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> { self.0.get(key.as_ref().trim_start_matches('/')).map(|value| Cow::Borrowed(value.as_slice())) }
    fn iter(&self) -> Box<AssetsIter<'_>> { Box::new(self.0.iter().map(|(key, value)| (Cow::Borrowed(key.as_str()), Cow::Borrowed(value.as_slice())))) }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> { Box::new(std::iter::empty()) }
}
#[test]
#[ignore = "Runs real WebView2 with isolated profile; run build-audio-webview-check.mjs first"]
fn webview_native_bridge_and_bidirectional_audio() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/audio-webview-check");
    let assets = ["index.html", "check.js", "worklet.js"].into_iter().map(|name| (name.to_string(), std::fs::read(dir.join(name)).expect("build the audio WebView fixture"))).collect();
    let profile = tempfile::tempdir().unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.set_assets(Box::new(Assets(assets)));
    let result: Report = Default::default();
    let stored = result.clone();
    let profile_path = std::env::var_os("MCTIER_AUDIO_CHECK_PROFILE")
        .map(std::path::PathBuf::from).unwrap_or_else(|| profile.path().to_path_buf());
    let app = tauri::Builder::default().any_thread().manage(stored)
        .invoke_handler(tauri::generate_handler![audio_check_report, audio_check_outputs, audio_check_ice_server, native_microphone_supported, native_microphone_start, native_microphone_read, native_microphone_stop, crate::modules::native_microphone::report_audio_diagnostic])
        .setup(move |app| {
            let mut window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("MCTier audio integration check").inner_size(360.0, 160.0)
                .data_directory(profile_path.clone()).visible(false);
            if let Ok(args) = std::env::var("MCTIER_AUDIO_CHECK_ARGS") { window = window.additional_browser_args(&args); }
            let window = window.build()?;
            crate::modules::media_permission::install(&window)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || { std::thread::sleep(Duration::from_secs(25)); handle.exit(0); });
            Ok(())
        }).build(context).expect("build isolated WebView2 app");
    app.run_return(|_, _| {});
    crate::modules::voice_ice::stop();
    let report = result.lock().unwrap().clone().expect("WebView2 did not report within 25 seconds");
    println!("AUDIO_WEBVIEW_REPORT={report}");
    assert_eq!(report["ok"], true, "{report}");
}
