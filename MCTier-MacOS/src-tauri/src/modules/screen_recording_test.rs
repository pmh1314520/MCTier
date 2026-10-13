//! Isolated actual WebView2 UI test; never linked into the app.
use std::{
    borrow::Cow,
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
type Report = Arc<Mutex<Option<serde_json::Value>>>;
#[tauri::command]
fn recording_check_report(
    app: tauri::AppHandle,
    result: tauri::State<'_, Report>,
    report: serde_json::Value,
) {
    *result.lock().unwrap() = Some(report);
    app.exit(0);
}
struct Assets(HashMap<String, Vec<u8>>);
impl tauri::Assets<tauri::Wry> for Assets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        self.0
            .get(key.as_ref().trim_start_matches('/'))
            .map(|v| Cow::Borrowed(v.as_slice()))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(
            self.0
                .iter()
                .map(|(k, v)| (Cow::Borrowed(k.as_str()), Cow::Borrowed(v.as_slice()))),
        )
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
#[tauri::command]
fn recording_check_create(extension: String) -> Result<Option<super::RecordingOutput>, String> {
    // Native file pickers return absolute paths without parent traversal components.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join(".artifacts/recording-check");
    super::create_at(dir.join(format!("test-{}.{}", uuid::Uuid::new_v4(), extension))).map(Some)
}
#[test]
#[ignore = "Actual Windows screen/audio capture and WebView2 recording; build fixture first"]
fn real_screen_recording() {
    run_fixture("recording-check", &["index.html", "check.js", "worklet.js"]);
}

#[test]
#[ignore = "Actual isolated WebView2 UI; build ux fixture first"]
fn real_startup_and_recording_ui() {
    run_fixture("ux-ui", &["index.html", "check.js", "check.css"]);
}

fn run_fixture(folder: &str, files: &[&str]) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.artifacts").join(folder);
    let assets = files.iter().copied()
        .map(|name| {
            (
                name.into(),
                std::fs::read(dir.join(name)).expect("build UI fixture first"),
            )
        })
        .collect();
    let profile = tempfile::tempdir().unwrap();
    let profile_path = profile.path().to_path_buf();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().build.dev_url = None;
    context.set_assets(Box::new(Assets(assets)));
    let report: Report = Default::default();
    let result = report.clone();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(result)
        .invoke_handler(tauri::generate_handler![
            recording_check_report,
            recording_check_create,
            super::recording_write,
            super::recording_finish,
            crate::modules::tauri_commands::open_file_location,
            crate::modules::native_microphone::recording_system_audio_start,
            crate::modules::native_microphone::native_microphone_supported,
            crate::modules::native_microphone::native_microphone_start,
            crate::modules::native_microphone::native_microphone_read,
            crate::modules::native_microphone::native_microphone_stop,
            crate::modules::native_microphone::report_audio_diagnostic,
            crate::modules::native_capture::native_capture_sources,
            crate::modules::native_capture::native_capture_start,
            crate::modules::native_capture::native_capture_frame,
            crate::modules::native_capture::native_capture_stop,
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("MCTier recording verification")
            .inner_size(640.0, 480.0)
            .visible(true)
            .data_directory(profile_path.clone())
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(120));
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .expect("build fixture");
    app.run_return(|_, _| {});
    crate::modules::native_capture::stop_all();
    crate::modules::native_microphone::stop_all();
    let report = report.lock().unwrap().clone().expect("UI test timed out");
    println!("RECORDING_REPORT={report}");
    assert_eq!(report["ok"], true, "{report}");
}
