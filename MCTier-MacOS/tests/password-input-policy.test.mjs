import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLinuxUserAgent,
  shouldAvoidNativePasswordInput,
} from '../src/utils/passwordInputPolicy.ts';

// Linux 端的 WebKitGTW/WebKitGTK 与 fcitx5 / ibus 的组合会吞掉 <input type="password">
// 的按键（issue #42 实机反馈），因此这些 UA 必须走 CSS 遮罩分支。
const LINUX_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Debian) AppleWebKit/605.1.15 Safari/605.1.15',
];

const NON_LINUX_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
];

test('Linux user agents avoid the native password input', () => {
  for (const agent of LINUX_AGENTS) {
    assert.equal(isLinuxUserAgent(agent), true, agent);
    assert.equal(shouldAvoidNativePasswordInput(agent), true, agent);
  }
});

test('Windows and macOS keep the native password input', () => {
  for (const agent of NON_LINUX_AGENTS) {
    assert.equal(isLinuxUserAgent(agent), false, agent);
    assert.equal(shouldAvoidNativePasswordInput(agent), false, agent);
  }
});

test('Android is not treated as desktop Linux even though its UA says Linux', () => {
  // 安卓端是独立的原生应用，不使用这套 WebView 组件；误判会让它走无谓的降级分支。
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
  assert.equal(isLinuxUserAgent(android), false);
  assert.equal(shouldAvoidNativePasswordInput(android), false);
});

test('missing or malformed user agents fall back to the native input', () => {
  // 判定不了平台时必须保守：原生密码框是语义更强的那个选项。
  for (const value of [undefined, null, '', 0, {}, []]) {
    assert.equal(shouldAvoidNativePasswordInput(value), false, String(value));
  }
});

test('a substring like "linuxlike" does not match', () => {
  // 用词边界匹配，避免把任意含 linux 字样的 UA 全都降级。
  assert.equal(isLinuxUserAgent('Mozilla/5.0 (SomeLinuxlikeOS)'), false);
});
