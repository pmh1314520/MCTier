import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

/**
 * 剥掉行注释与块注释后再做断言。
 *
 * 这些测试靠匹配源码文本来锁住行为，如果不剥注释，把实现注释掉之后断言依然通过
 * ——变异测试已经证实了这一点。剥注释后断言才真的锁住「代码在执行」。
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const app = stripComments(read('src/App.tsx'));
const miniWindow = stripComments(read('src/components/MiniWindow/MiniWindow.tsx'));
const webrtc = stripComments(read('src/services/webrtc/WebRTCClient.ts'));
const androidRepo = stripComments(
  read('MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt'),
);
const androidUi = stripComments(
  read('MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt'),
);

// 客户端上报的版本号必须是纯 x.y.z：信令服务器的 is_version_valid 只接受三段数字，
// 带后缀（例如 "3.0.0-android"）会被判成非法版本而直接拒绝。
test('android reports a bare x.y.z client version, not the -android versionName', () => {
  const models = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/data/Models.kt');
  const declared = /const val AppClientVersion = "([^"]+)"/.exec(models);
  assert.ok(declared, 'AppClientVersion should be declared');
  assert.match(declared[1], /^\d+\.\d+\.\d+$/, 'must be bare x.y.z');

  const signaling = read(
    'MCTier-Android/app/src/main/java/top/pmh13/mctier/network/SignalingClient.kt',
  );
  assert.match(signaling, /clientVersion = AppClientVersion/);
});

// 光弹提示不够：EasyTier 先于信令启动，信令拒绝时虚拟网卡已经建好，
// 而 EasyTier 组网不依赖信令，低版本客户端仍连在同一虚拟局域网里。
// 必须主动拆掉组网，才能真正做到「低于最低版本无法组网」。
test('desktop tears down networking when the server rejects the version', () => {
  const handler = /onVersionError\(\([\s\S]{0,2000}?\n          \}\);/.exec(app);
  assert.ok(handler, 'version error handler should exist in App.tsx');
  const body = handler[0];

  assert.match(body, /setVersionError\(/, 'should surface the forced-update UI');
  assert.match(body, /invoke\('leave_lobby'\)/, 'should stop EasyTier via leave_lobby');
  assert.match(
    body,
    /invoke\('force_stop_easytier'\)/,
    'should force-stop the adapter when leave_lobby fails',
  );
});

test('android leaves the lobby on version rejection', () => {
  const branch = /"version-too-old" -> \{[\s\S]{0,1200}?\n            \}/.exec(androidRepo);
  assert.ok(branch, 'version-too-old branch should exist');
  assert.match(branch[0], /versionError = alert/);
  assert.match(branch[0], /leaveLobby\(\)/, 'must drop the virtual network too');
});

// 服务器是唯一权威，客户端不能自己决定放行；同时两端都要能显示最低版本与官网入口。
test('both ends show the minimum version and an official download entry', () => {
  assert.match(miniWindow, /versionError\.minimumVersion/);
  assert.match(miniWindow, /versionError\.currentVersion/);
  assert.match(miniWindow, /DOWNLOAD_WEBSITE/);
  assert.match(androidUi, /alert\.minimum/);
  assert.match(androidUi, /alert\.current/);
  assert.match(androidUi, /openUpdateWebsite/);
});

// 断网之后必须留一条退出路径，否则用户被困在没有网络的界面里只能重启应用。
test('forced-update UI still offers a way out on both ends', () => {
  assert.match(miniWindow, /handleBackToHomeFromVersionError/);
  assert.match(miniWindow, /version-error-btn secondary/);
  // Android 的「稍后处理」复用了原本从未被调用的 clearVersionError()
  assert.match(androidUi, /repository\.clearVersionError\(\)/);
  assert.match(androidRepo, /fun clearVersionError\(\)/);
});

// 关掉弹窗不等于放行：创建/加入入口仍受 versionError 门禁，且服务器会再次拒绝。
test('android blocks lobby entry while a version error is active', () => {
  assert.match(androidUi, /state\.versionError == null/);
});

// 客户端收到拒绝后不得继续自动重连，否则会反复撞墙并刷日志。
test('desktop stops auto-reconnect after a version rejection', () => {
  const branch = /case 'version-too-old':[\s\S]{0,900}?break;/.exec(webrtc);
  assert.ok(branch, 'version-too-old case should exist');
  assert.match(branch[0], /isIntentionalDisconnect = true/);
  assert.match(branch[0], /websocket\.close\(\)/);
});
