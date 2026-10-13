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
fn quark_check_report(
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
#[test]
#[ignore = "Real isolated WebView2: run node scripts/build-quark-webview-check.mjs first"]
fn quark_startup_invitation_interactions() {
    run_fixture(false);
}

#[test]
#[ignore = "Requires the local remote-video bridge and Android instrumentation"]
fn remote_android_video() {
    run_fixture(true);
}

fn run_fixture(remote: bool) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(if remote { "../.artifacts/remote-video-check" } else { "../.artifacts/quark-ui-check" });
    let assets = ["index.html", "check.js", "check.css"]
        .into_iter()
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
            quark_check_report,
            super::native_capture::native_capture_sources,
            super::native_capture::native_capture_start,
            super::native_capture::native_capture_frame,
            super::native_capture::native_capture_stop,
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Quark UI test")
            .inner_size(360.0, 740.0)
            .visible(false)
            .data_directory(profile_path.clone())
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(if remote { 180 } else { 25 }));
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .expect("build fixture");
    app.run_return(|_, _| {});
    if remote { super::native_capture::stop_all(); }
    let report = report.lock().unwrap().clone().expect("UI test timed out");
    println!("QUARK_UI_REPORT={report}");
    assert_eq!(report["ok"], true, "{report}");
}
