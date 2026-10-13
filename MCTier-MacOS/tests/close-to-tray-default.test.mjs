import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** 用指定的 navigator.platform 打包并加载 platform.ts，取其平台缺省值。 */
async function loadDefaultCloseToTray(platform) {
  Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true });
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/platform.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const url = `data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}#${platform}`;
  const mod = await import(url);
  return mod.defaultCloseToTray;
}

test('关闭时最小化到托盘：macOS 缺省开启，其他平台保持关闭', async () => {
  assert.equal(await loadDefaultCloseToTray('MacIntel'), true, 'macOS 上红点关窗应隐藏到菜单栏');
  assert.equal(await loadDefaultCloseToTray('Win32'), false, 'Windows 上保持关闭即退出');
  assert.equal(await loadDefaultCloseToTray('Linux x86_64'), false);
});

test('前端平台缺省与后端 default_close_to_tray 用同一条规则', () => {
  const rust = readFileSync(new URL('../src-tauri/src/modules/config_manager.rs', import.meta.url), 'utf8');
  const helper = rust.match(/pub const fn default_close_to_tray\(\) -> bool \{\s*cfg!\(target_os = "macos"\)\s*\}/);
  assert.ok(helper, 'config_manager 必须提供按平台判定的 default_close_to_tray()');
  // 结构体默认值跟着平台走，首次写入的配置文件才不会把 macOS 钉死在「关闭即退出」上。
  assert.match(rust, /close_to_tray: Some\(default_close_to_tray\(\)\)/);
});

test('关闭行为与设置页显示都用同一个缺省，不再各写一个 false', () => {
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /close_to_tray\s*\n?\s*\.unwrap_or_else\(default_close_to_tray\)/,
    'lib.rs 的关闭处理器必须用共享缺省');
  assert.doesNotMatch(lib, /close_to_tray\.unwrap_or\(cfg!\(target_os = "macos"\)\)/);

  const settings = readFileSync(new URL('../src-tauri/src/modules/tauri_commands/settings.rs', import.meta.url), 'utf8');
  assert.match(settings, /"closeToTray": config\.close_to_tray\.unwrap_or_else\([^)]*default_close_to_tray\)/,
    '设置接口返回的实际值与行为缺省必须一致，否则开关会显示成反的');

  const ui = readFileSync(new URL('../src/components/SettingsWindow/SettingsWindow.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /closeToTray:\s*false/, '设置页不应再把关闭到托盘写死成 false');
  assert.match(ui, /import \{ defaultCloseToTray \} from '\.\.\/\.\.\/utils\/platform'/);
});
