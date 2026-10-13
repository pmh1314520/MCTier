//! macOS 应用菜单栏。
//!
//! Tauri 默认不装应用菜单，于是 Mac 上「关于 / 设置 / 服务 / 隐藏 / 退出」
//! 这一整条标准链路都是空的：`Cmd+,` 打不开设置，编辑菜单缺失让部分输入框的
//! `Cmd+Z` 不生效，菜单栏里也没有「帮助」。这里按 AppKit 惯例补齐。
//!
//! 两处刻意与 Windows 不同：
//!
//! 1. 「设置…」带 `Cmd+,`，并把打开动作交给前端（`open-settings` 事件），
//!    因为设置面板是 WebView 里的浮层而不是独立窗口；
//! 2. 「关于 MCTier」走应用内的 AboutWindow（`Cmd+Q` 之外唯一的原生入口），
//!    同时把版本/版权填进 `PredefinedMenuItem::about` 的元数据，让
//!    菜单项在系统层面也是完整的。

use tauri::menu::AboutMetadata;

#[cfg(target_os = "macos")]
use std::sync::OnceLock;
#[cfg(target_os = "macos")]
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};

/// 「设置…」：`Cmd+,` 是 macOS 上打开偏好设置的固定键位。
pub const ID_SETTINGS: &str = "app-settings";
/// 「关于 MCTier」：交给前端打开已有的 AboutWindow。
pub const ID_ABOUT: &str = "app-about";
/// 「关闭窗口时最小化到菜单栏」：与设置页里的开关共用同一份配置。
pub const ID_CLOSE_TO_MENU_BAR: &str = "app-close-to-menu-bar";
/// 「开机自启动」：菜单栏里直接勾选，省得进设置页找。
pub const ID_AUTO_START: &str = "app-auto-start";

const ID_HELP_WEBSITE: &str = "app-help-website";
const ID_HELP_LOGS: &str = "app-help-logs";

/// 菜单里所有可本地化的文案。
///
/// 抽成结构体是为了让「文案组装」与「装到 AppKit 上」分开：前者可以在无
/// AppHandle 的单元测试里跑，后者只能真机验证。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Labels {
    pub app_menu: String,
    pub about: String,
    pub settings: String,
    pub services: String,
    pub hide: String,
    pub hide_others: String,
    pub show_all: String,
    pub quit: String,
    pub close_to_menu_bar: String,
    pub auto_start: String,
    pub edit: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub window: String,
    pub minimize: String,
    pub zoom: String,
    pub fullscreen: String,
    pub help: String,
    pub website: String,
    pub logs: String,
}

impl Labels {
    /// 英文文案。
    pub fn english() -> Self {
        Self {
            app_menu: "MCTier".into(),
            about: "About MCTier".into(),
            settings: "Settings…".into(),
            services: "Services".into(),
            hide: "Hide MCTier".into(),
            hide_others: "Hide Others".into(),
            show_all: "Show All".into(),
            quit: "Quit MCTier".into(),
            close_to_menu_bar: "Hide to menu bar on close".into(),
            auto_start: "Launch at login".into(),
            edit: "Edit".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            copy: "Copy".into(),
            paste: "Paste".into(),
            select_all: "Select All".into(),
            window: "Window".into(),
            minimize: "Minimize".into(),
            zoom: "Zoom".into(),
            fullscreen: "Enter Full Screen".into(),
            help: "Help".into(),
            website: "MCTier Website".into(),
            logs: "Open Log Folder".into(),
        }
    }

    /// 简体中文文案。键位后缀由系统的 PredefinedMenuItem 提供，这里只写词条。
    pub fn simplified_chinese() -> Self {
        Self {
            app_menu: "MCTier".into(),
            about: "关于 MCTier".into(),
            settings: "设置…".into(),
            services: "服务".into(),
            hide: "隐藏 MCTier".into(),
            hide_others: "隐藏其他".into(),
            show_all: "全部显示".into(),
            quit: "退出 MCTier".into(),
            close_to_menu_bar: "关闭时隐藏到菜单栏".into(),
            auto_start: "开机时启动".into(),
            edit: "编辑".into(),
            undo: "撤销".into(),
            redo: "重做".into(),
            cut: "剪切".into(),
            copy: "拷贝".into(),
            paste: "粘贴".into(),
            select_all: "全选".into(),
            window: "窗口".into(),
            minimize: "最小化".into(),
            zoom: "缩放".into(),
            fullscreen: "进入全屏幕".into(),
            help: "帮助".into(),
            website: "MCTier 官网".into(),
            logs: "打开日志文件夹".into(),
        }
    }

    /// 按界面语言选择文案。语言值沿用应用的 `zh` / `en` 口径。
    pub fn for_language(language: &str) -> Self {
        if language.starts_with("zh") {
            Self::simplified_chinese()
        } else {
            Self::english()
        }
    }
}

/// 需要保持可变状态的菜单项（勾选状态随配置变化）。
#[cfg(target_os = "macos")]
struct StatefulItems {
    close_to_menu_bar: CheckMenuItem<tauri::Wry>,
    auto_start: CheckMenuItem<tauri::Wry>,
}

#[cfg(target_os = "macos")]
static STATEFUL_ITEMS: OnceLock<StatefulItems> = OnceLock::new();

/// 安装应用菜单。只在 macOS 上调用。
#[cfg(target_os = "macos")]
///
/// `language` 决定文案；`close_to_menu_bar` / `auto_start` 是配置里的初始
/// 勾选状态。任一项构造失败都会返回错误，由调用方记日志而不是让启动失败。
pub fn install(
    app: &tauri::AppHandle,
    language: &str,
    close_to_menu_bar: bool,
    auto_start: bool,
) -> tauri::Result<()> {
    let labels = Labels::for_language(language);

    let about = MenuItem::with_id(app, ID_ABOUT, &labels.about, true, None::<&str>)?;
    let settings = MenuItem::with_id(
        app,
        ID_SETTINGS,
        &labels.settings,
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let services = PredefinedMenuItem::services(app, Some(&labels.services))?;
    let hide = PredefinedMenuItem::hide(app, Some(&labels.hide))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some(&labels.hide_others))?;
    let show_all = PredefinedMenuItem::show_all(app, Some(&labels.show_all))?;
    let close_to_menu_bar_item = CheckMenuItem::with_id(
        app,
        ID_CLOSE_TO_MENU_BAR,
        &labels.close_to_menu_bar,
        true,
        close_to_menu_bar,
        None::<&str>,
    )?;
    let auto_start_item = CheckMenuItem::with_id(
        app,
        ID_AUTO_START,
        &labels.auto_start,
        true,
        auto_start,
        None::<&str>,
    )?;
    let quit = PredefinedMenuItem::quit(app, Some(&labels.quit))?;

    let app_menu = SubmenuBuilder::new(app, &labels.app_menu)
        .item(&about)
        .separator()
        .item(&settings)
        .item(&close_to_menu_bar_item)
        .item(&auto_start_item)
        .separator()
        .item(&services)
        .separator()
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .separator()
        .item(&quit)
        .build()?;

    // 编辑菜单不能省：WebView 里的输入框依赖它提供 Cmd+C/V/A，缺了在部分
    // 控件上按了没反应。撤销/重做也走系统实现，交给 WKWebView 自己处理。
    let edit_menu = SubmenuBuilder::new(app, &labels.edit)
        .item(&PredefinedMenuItem::undo(app, Some(&labels.undo))?)
        .item(&PredefinedMenuItem::redo(app, Some(&labels.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(&labels.cut))?)
        .item(&PredefinedMenuItem::copy(app, Some(&labels.copy))?)
        .item(&PredefinedMenuItem::paste(app, Some(&labels.paste))?)
        .item(&PredefinedMenuItem::select_all(app, Some(&labels.select_all))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, &labels.window)
        .item(&PredefinedMenuItem::minimize(app, Some(&labels.minimize))?)
        .item(&PredefinedMenuItem::maximize(app, Some(&labels.zoom))?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some(&labels.fullscreen))?)
        .build()?;

    // 「打开日志文件夹」复用已有的日志命令，排障时不必先进设置页。
    let logs = MenuItem::with_id(app, ID_HELP_LOGS, &labels.logs, true, None::<&str>)?;
    let help_menu = SubmenuBuilder::new(app, &labels.help)
        .item(&MenuItem::with_id(
            app,
            ID_HELP_WEBSITE,
            &labels.website,
            true,
            None::<&str>,
        )?)
        .item(&logs)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;
    app.set_menu(menu)?;

    // 首次安装时记录句柄；应用运行期间菜单只装一次，重复安装是编程错误。
    let _ = STATEFUL_ITEMS.set(StatefulItems {
        close_to_menu_bar: close_to_menu_bar_item,
        auto_start: auto_start_item,
    });

    log::info!("已安装 macOS 应用菜单栏 (language={language})");
    Ok(())
}

/// 同步「关闭时隐藏到菜单栏」的勾选状态。
#[cfg(target_os = "macos")]
pub fn set_close_to_menu_bar_checked(checked: bool) {
    if let Some(items) = STATEFUL_ITEMS.get() {
        if let Err(error) = items.close_to_menu_bar.set_checked(checked) {
            log::warn!("同步菜单栏勾选状态失败: {error}");
        }
    }
}

/// 同步「开机时启动」的勾选状态。
#[cfg(target_os = "macos")]
pub fn set_auto_start_checked(checked: bool) {
    if let Some(items) = STATEFUL_ITEMS.get() {
        if let Err(error) = items.auto_start.set_checked(checked) {
            log::warn!("同步菜单栏勾选状态失败: {error}");
        }
    }
}

/// 平台不支持菜单栏时为空实现，让调用方（lib.rs 的 setup）不必再套一层 cfg。
#[cfg(not(target_os = "macos"))]
pub fn install(
    _app: &tauri::AppHandle,
    _language: &str,
    _close_to_menu_bar: bool,
    _auto_start: bool,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_close_to_menu_bar_checked(_checked: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn set_auto_start_checked(_checked: bool) {}

/// 关于窗口的元数据。版本来自 Cargo 包版本，与应用自身一致。
pub fn about_metadata() -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("MCTier".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        comments: Some("虚拟局域网通用联机工具".to_string()),
        copyright: Some(
            "Copyright © 2024-2026 QingYun Studio_PengMingHang (MCTier Team)".to_string(),
        ),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 各语言文案必须齐全且互不相同，否则菜单会出现空白项或串词。
    #[test]
    fn both_languages_are_complete() {
        for labels in [Labels::english(), Labels::simplified_chinese()] {
            let fields = [
                &labels.app_menu,
                &labels.about,
                &labels.settings,
                &labels.services,
                &labels.hide,
                &labels.hide_others,
                &labels.show_all,
                &labels.quit,
                &labels.close_to_menu_bar,
                &labels.auto_start,
                &labels.edit,
                &labels.undo,
                &labels.redo,
                &labels.cut,
                &labels.copy,
                &labels.paste,
                &labels.select_all,
                &labels.window,
                &labels.minimize,
                &labels.zoom,
                &labels.fullscreen,
                &labels.help,
                &labels.website,
                &labels.logs,
            ];
            for value in fields {
                assert!(!value.trim().is_empty(), "菜单文案不得为空: {labels:?}");
            }
            assert_eq!(labels.app_menu, "MCTier", "应用菜单名必须是产品名");
        }
        assert_ne!(
            Labels::english().settings,
            Labels::simplified_chinese().settings
        );
    }

    /// 语言值沿用应用的 `zh` / `en` 口径，`zh-CN` 这类带区域的写法也要落到中文。
    #[test]
    fn language_selection_matches_the_application_convention() {
        for language in ["zh", "zh-CN", "zh-Hans"] {
            assert_eq!(
                Labels::for_language(language),
                Labels::simplified_chinese(),
                "{language} 应使用中文菜单"
            );
        }
        for language in ["en", "en-US", "ja"] {
            assert_eq!(
                Labels::for_language(language),
                Labels::english(),
                "{language} 应回落到英文菜单"
            );
        }
    }

    /// 自定义 ID 必须唯一且不含空白：重复 ID 会让两个菜单项抢同一个事件，
    /// 空白则会被 AppKit 视为非法标识。
    #[test]
    fn custom_menu_ids_are_unique_and_well_formed() {
        let ids = [
            ID_SETTINGS,
            ID_ABOUT,
            ID_CLOSE_TO_MENU_BAR,
            ID_AUTO_START,
            ID_HELP_WEBSITE,
            ID_HELP_LOGS,
        ];
        let mut sorted = ids.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len(), "菜单 ID 不得重复");
        for id in ids {
            assert!(!id.is_empty());
            assert!(
                id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "菜单 ID 只允许字母数字和短横线: {id}"
            );
        }
    }

    /// 关于面板的版本必须与包版本同源，避免和 tauri.conf.json 漂移。
    #[test]
    fn about_metadata_tracks_the_package_version() {
        let metadata = about_metadata();
        assert_eq!(metadata.name.as_deref(), Some("MCTier"));
        assert_eq!(
            metadata.version.as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert!(metadata.copyright.is_some());
    }
}
