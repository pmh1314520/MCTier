//! Native microphone and screen capture do not require browser media permissions.
//! Deny accidental browser permission requests instead of showing browser chrome.
pub fn trusted(uri: &str) -> bool {
    let Ok(url) = tauri::Url::parse(uri) else {
        return false;
    };
    url.username().is_empty()
        && url.password().is_none()
        && ((url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("localhost")
                && url.port() == Some(1420))
            || (cfg!(not(windows))
                && url.scheme() == "tauri"
                && url.host_str() == Some("localhost")))
}
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|view| {
            use webview2_com::{
                Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler,
                ScreenCaptureStartingEventHandler,
            };
            use windows_core_webview::Interface;
            let result = (|| -> windows_core_webview::Result<()> {
                unsafe {
                    let core = view.controller().CoreWebView2()?;
                    let mut token = 0;
                    core.add_PermissionRequested(
                        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                            if let Some(args) = args {
                                let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                                args.PermissionKind(&mut kind)?;
                                log::info!("[AudioPipeline] browser permission denied: kind={}", kind.0);
                                if let Ok(args3) =
                                    args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()
                                {
                                    args3.SetSavesInProfile(false)?;
                                }
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    if let Ok(capture) = core.cast::<ICoreWebView2_27>() {
                        capture.add_ScreenCaptureStarting(
                            &ScreenCaptureStartingEventHandler::create(Box::new(|_, args| {
                                if let Some(args) = args {
                                    args.SetCancel(true)?;
                                }
                                Ok(())
                            })),
                            &mut token,
                        )?;
                    }
                    Ok(())
                }
            })();
            if let Err(error) = result {
                log::error!("安装浏览器媒体权限拦截失败: {error}");
            }
        })
        .map_err(|e| e.to_string())
}

/// Disable browser chrome for every app WebView, including auxiliary windows.
#[cfg(windows)]
pub fn configure_browser_ui(webview: &tauri::Webview) {
    let _ = webview.with_webview(|view| {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows_core_webview::Interface;
        let result = (|| -> windows_core_webview::Result<()> {
            unsafe {
                let settings = view.controller().CoreWebView2()?.Settings()?;
                settings.SetAreDefaultScriptDialogsEnabled(false)?;
                settings.SetAreDefaultContextMenusEnabled(false)?;
                settings.SetIsStatusBarEnabled(false)?;
                settings.SetIsBuiltInErrorPageEnabled(false)?;
                if let Ok(v3) = settings.cast::<ICoreWebView2Settings3>() {
                    v3.SetAreBrowserAcceleratorKeysEnabled(false)?;
                }
                if let Ok(v4) = settings.cast::<ICoreWebView2Settings4>() {
                    v4.SetIsPasswordAutosaveEnabled(false)?;
                    v4.SetIsGeneralAutofillEnabled(false)?;
                }
                Ok(())
            }
        })();
        if let Err(error) = result {
            log::warn!("配置 WebView 应用界面失败: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn microphone_access_is_scoped_to_application_origin() {
        assert!(super::trusted("http://tauri.localhost/"));
        for uri in [
            "https://example.com",
            "http://tauri.localhost.evil/",
            "http://user@tauri.localhost/",
            "http://tauri.localhost:88/",
            "file:///index.html",
            "data:text/html,hello",
        ] {
            assert!(!super::trusted(uri));
        }
    }
}
