import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const commands = read('src-tauri/src/modules/tauri_commands.rs');
const configManager = read('src-tauri/src/modules/config_manager.rs');
const cargoManifest = read('src-tauri/Cargo.toml');
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));
const config = JSON.parse(read('src-tauri/tauri.conf.json'));

test('desktop capabilities keep opener disabled and shell URLs narrowly scoped', () => {
  assert.doesNotMatch(capability.permissions.join('\n'), /^opener:/m);
  assert.ok(capability.permissions.includes('shell:allow-open'));
  assert.equal(
    config.plugins.shell.open,
    'https://(?:mctier\\.pmhs\\.top|www\\.mcmod\\.cn|github\\.com|gitee\\.com|webrtc\\.googlesource\\.com|www\\.wintun\\.net|reqrypt\\.org|npcap\\.com|langlangy\\.cn)(?:[/?#][^\\s]*)?\\z',
  );
  assert.doesNotMatch(config.plugins.shell.open, /file:|javascript:|mailto:|tel:/i);
});

// 上面那条是「配置没被悄悄改动」的固定断言，但它只做字符串比较，说明不了这条
// 正则到底拦不拦得住仿冒域名。这里按行为验证：逐个 URL 实际跑一遍白名单。
test('shell open scope allows only exact sponsor and project hosts', () => {
  // \z 是 Rust/.NET 的字符串结尾锚点，JS 无对应写法；不带 /m 时 $ 语义等价。
  const scope = new RegExp(config.plugins.shell.open.replace(/\\z$/, '$'));

  for (const allowed of [
    'https://langlangy.cn/?imctier',
    'https://langlangy.cn',
    'https://mctier.pmhs.top',
    'https://github.com/pmh1314520/MCTier',
  ]) {
    assert.equal(scope.test(allowed), true, `should allow ${allowed}`);
  }

  for (const blocked of [
    // 仿冒：把白名单域名塞进子域或路径
    'https://langlangy.cn.evil.com/',
    'https://evil.com/langlangy.cn',
    'https://notlanglangy.cn/',
    // 明文 http 不放行
    'http://langlangy.cn/?imctier',
    // 换行拼接第二个 URL（[^\\s] 与结尾锚点共同拦下）
    'https://langlangy.cn/\nhttps://evil.com',
    // 其它协议
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(scope.test(blocked), false, `should block ${blocked}`);
  }
});

test('generic filesystem commands require scoped grants and reject link/path tricks', () => {
  assert.match(commands, /fn normalize_local_path[\s\S]{0,5000}symlink_metadata/);
  assert.match(commands, /fn normalize_local_path[\s\S]{0,5000}validate_local_path_component/);
  assert.match(commands, /pub async fn read_file_bytes[\s\S]{0,900}require_existing_file_grant/);
  assert.match(commands, /pub async fn write_file_bytes[\s\S]{0,1000}require_path_grant/);
  assert.match(commands, /pub async fn read_file\([\s\S]{0,900}require_existing_file_grant/);
  assert.match(commands, /pub async fn save_file\([\s\S]{0,1000}require_path_grant/);
  assert.match(commands, /pub async fn delete_file\([\s\S]{0,500}require_existing_file_grant/);
  assert.match(commands, /pub async fn open_file_location[\s\S]{0,700}require_existing_file_grant/);
  assert.match(commands, /pub async fn open_folder[\s\S]{0,700}require_existing_directory_grant/);
  assert.match(commands, /value\.contains\(':'\)/);
  assert.match(commands, /create_new\(true\)/);
});

test('system process launches avoid PATH and shell-script interpolation in Tauri commands', () => {
  for (const executable of ['taskkill', 'tasklist', 'ipconfig', 'netsh', 'reg', 'explorer', 'notepad', 'powershell']) {
    assert.doesNotMatch(commands, new RegExp(`Command::new\\(\\"${executable}\\"\\)`));
    assert.doesNotMatch(commands, new RegExp(`process::Command::new\\(\\"${executable}\\"\\)`));
  }
  assert.match(commands, /windows_system_command\("WindowsPowerShell\\\\v1\.0\\\\powershell\.exe"\)/);
  assert.match(commands, /Start-Process -FilePath \$env:MCTIER_EXE -Verb RunAs/);
  assert.doesNotMatch(commands, /Start-Process[^\n]*format!\(/);
});

test('ping command validates an IP before passing it as one process argument', () => {
  assert.match(commands, /parse::<std::net::IpAddr>\(\)/);
  assert.match(commands, /\.args\(\["-n", "2", "-w", "1000", &target\]\)/);
  assert.match(commands, /\.args\(\["-c", "2", "-W", "1", &target\]\)/);
});

test('P2P chat commands use signaling-issued sessions and authoritative peers', () => {
  assert.match(commands, /pub async fn configure_p2p_chat[\s\S]{0,1600}set_session\(/);
  assert.match(commands, /pub async fn configure_p2p_chat[\s\S]{0,2200}start_server\(\)/);
  assert.match(commands, /pub async fn stop_p2p_chat[\s\S]{0,700}stop_server\(\)/);
  assert.match(commands, /pub async fn send_p2p_chat_message[\s\S]{0,4200}authoritative_peers\(\)/);
  assert.match(commands, /pub async fn send_p2p_chat_message[\s\S]{0,7000}CHAT_TOKEN_HEADER/);
  assert.match(commands, /pub async fn get_p2p_chat_messages[\s\S]{0,1800}authoritative_peers\(\)/);
  assert.match(commands, /pub async fn get_p2p_chat_messages[\s\S]{0,5000}read_remote_body_limited/);
  assert.match(commands, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
});

test('desktop auto-lobby password stays in the OS credential store', () => {
  assert.match(cargoManifest, /Win32_Security_Credentials/);
  assert.match(commands, /CredReadW/);
  assert.match(commands, /CredWriteW/);
  assert.match(commands, /CRED_PERSIST_LOCAL_MACHINE/);
  assert.match(commands, /auto_lobby_session_secret/);
  assert.match(commands, /spawn_blocking\(read_auto_lobby_secret\)/);
  assert.match(commands, /lobby_password:\s*None/);
  assert.match(commands, /"lobbyPassword": lobby_password/);
  assert.match(configManager, /#\[serde\(default, skip_serializing\)\][\s\S]{0,100}pub lobby_password/);
});
