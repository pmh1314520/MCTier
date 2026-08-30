import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rustServer = fs.readFileSync(new URL('../src-tauri/src/modules/file_transfer.rs', import.meta.url), 'utf8');
const rustCommands = fs.readFileSync(new URL('../src-tauri/src/modules/tauri_commands.rs', import.meta.url), 'utf8');
const androidServer = fs.readFileSync(new URL('../MCTier-Android/app/src/main/java/top/pmh13/mctier/network/FileShareHttpServer.kt', import.meta.url), 'utf8');
const androidClient = fs.readFileSync(new URL('../MCTier-Android/app/src/main/java/top/pmh13/mctier/network/RemoteFileClient.kt', import.meta.url), 'utf8');
const androidRepository = fs.readFileSync(new URL('../MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt', import.meta.url), 'utf8');
const fileShareManager = fs.readFileSync(new URL('../src/components/FileShareManager/FileShareManagerNew.tsx', import.meta.url), 'utf8');
const tauriConfig = fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');

test('range handlers reject malformed intervals and clamp valid oversized ends', () => {
  assert.match(rustServer, /fn resolve_range\(/);
  assert.match(rustServer, /end\.unwrap_or\(file_size - 1\)\.min\(file_size - 1\)/);
  assert.match(rustServer, /ByteRange::Suffix/);
  assert.match(rustServer, /parse_range\(value\)\.ok_or\(StatusCode::RANGE_NOT_SATISFIABLE\)/);
  assert.match(androidServer, /Regex\("\^bytes=.*RegexOption\.IGNORE_CASE\)/);
  assert.match(rustServer, /status\(StatusCode::RANGE_NOT_SATISFIABLE\)/);
  assert.match(androidServer, /if \(fileLen <= 0\) return rangeNotSatisfiable\(fileLen\)/);
  assert.match(androidServer, /rangeEnd < rangeStart/);
  assert.match(androidServer, /coerceAtMost\(fileLen - 1\)/);
  assert.match(androidServer, /newChunkedResponse\(Response\.Status\.OK/);
});

test('downloads use unique exclusive temporary files and no-replace commit', () => {
  assert.match(rustCommands, /create_new\(true\)/);
  assert.match(rustCommands, /commit_download_part_noreplace\(&candidate, &destination\)\.await/);
  assert.match(rustCommands, /tokio::fs::hard_link\(part_path, destination\)/);
  assert.match(rustCommands, /status == reqwest::StatusCode::PARTIAL_CONTENT/);
  assert.match(rustCommands, /status\.as_u16\(\) == 410/);
  assert.match(rustCommands, /downloaded != limit/);
  assert.match(androidClient, /UUID\.randomUUID\(\)/);
  assert.match(androidClient, /StandardOpenOption\.CREATE_NEW/);
  assert.match(androidClient, /if \(resp\.code == 206\) error/);
  assert.match(androidClient, /Files\.move\(partFile\.toPath\(\), outFile\.toPath\(\)\)/);
  assert.match(androidClient, /expectedSize/);
  assert.match(androidClient, /if \(expectedLength != null && downloaded != expectedLength\)/);
});

test('public metadata and verification stay bounded', () => {
  const androidDto = androidServer.slice(androidServer.indexOf('private data class ShareDto'), androidServer.indexOf('private data class VerifyPasswordRequest'));
  assert.match(rustServer, /pub has_password: bool/);
  assert.match(androidServer, /MaxVerifyBodyBytes = 16 \* 1024/);
  assert.doesNotMatch(androidDto, /val password/);
  assert.match(androidServer, /hasPassword = !password\.isNullOrBlank\(\).*password\.isNotBlank\(\)/s);
  assert.doesNotMatch(rustServer, /legacy_password|normalized\(/);
});

test('file servers stay on the overlay and batch responses stream from disk', () => {
  assert.match(androidServer, /NanoHTTPD\(requireOverlayBindIp\(bindIp\), FileSharePort\)/);
  assert.doesNotMatch(androidServer, /NanoHTTPD\("0\.0\.0\.0", FileSharePort\)/);
  assert.match(rustServer, /spawn_blocking[\s\S]*build_batch_zip\([\s\S]*permit/);
  assert.match(rustServer, /create_temp_file_stream\(zip_file, zip_path, zip_size, permit\)/);
  assert.match(rustServer, /struct PreparedBatchZip/);
  assert.match(rustServer, /struct ShareValidityReader/);
  assert.match(rustServer, /ensure_share_current\(&self\.shared_folders/);
  assert.match(rustServer, /MAX_BATCH_FILES/);
  assert.match(rustServer, /MAX_BATCH_SOURCE_BYTES/);
  assert.doesNotMatch(rustServer, /tokio::fs::read\(&zip_path\)/);
});

test('file clients only contact current routed lobby peers through native commands', () => {
  assert.match(rustCommands, /fn require_file_peer_host/);
  assert.match(rustCommands, /allowed_peer_ips/);
  assert.match(rustCommands, /local\.octets\(\)\[\.\.3\] != target\.octets\(\)\[\.\.3\]/);
  assert.match(fileShareManager, /invoke<unknown>\('get_remote_files'/);
  assert.doesNotMatch(fileShareManager, /fetch\([\s\S]{0,240}:14539/);
  assert.doesNotMatch(tauriConfig, /http:\/\/\*:14539/);
  assert.match(androidClient, /contentEquals\(byteArrayOf\(10, 126, 126\)\)/);
  assert.match(androidRepository, /isAuthoritativePeer/);
  assert.match(androidRepository, /networkController\.peerConnectionTypes\(\)/);
});

test('file access is revoked by the signaling-issued lobby token', () => {
  assert.match(rustServer, /LOBBY_TOKEN_HEADER/);
  assert.match(rustServer, /fn authenticate_lobby/);
  assert.match(rustServer, /pub fn set_lobby_token/);
  assert.match(rustCommands, /set_lobby_token\(file_token\)/);
  assert.match(rustCommands, /LOBBY_TOKEN_HEADER[\s\S]{0,160}&target\.token/);
  assert.match(androidServer, /fun configureLobbyToken/);
  assert.match(androidServer, /private fun authenticateLobby/);
  assert.match(androidServer, /byteArrayOf\(10, 126, 126\)/);
  assert.match(androidClient, /fun listShares[\s\S]{0,500}authorizeLobby\(lobbyToken\)/);
  assert.match(androidClient, /fun listFiles[\s\S]{0,900}authorizeLobby\(lobbyToken\)/);
  assert.match(androidClient, /fun download[\s\S]{0,3000}authorizeLobby\(lobbyToken\)/);
  assert.match(androidRepository, /fileServer\?\.configureLobbyToken/);
});

test('ZIP extraction normalizes paths and enforces rollback budgets', () => {
  assert.match(rustCommands, /safe_zip_entry_path/);
  assert.match(rustCommands, /MAX_ZIP_ENTRIES/);
  assert.match(rustCommands, /MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES/);
  assert.match(rustCommands, /MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES/);
  assert.match(rustCommands, /entry\.is_symlink\(\)/);
  assert.match(rustCommands, /拒绝ZIP中的重复条目/);
  assert.match(rustCommands, /max_total_bytes: Option<u64>/);
  assert.match(rustCommands, /created_files\.iter\(\)\.rev\(\)/);
  assert.match(rustCommands, /created_dirs\.iter\(\)\.rev\(\)/);
});
