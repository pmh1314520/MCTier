import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(here, '..', relativePath), 'utf8');

const manifest = read('MCTier-Android/app/src/main/AndroidManifest.xml');
const networkSecurity = read('MCTier-Android/app/src/main/res/xml/network_security_config.xml');
const mainActivity = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/MainActivity.kt');
const mctierApp = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt');
const inviteCodec = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/network/LobbyInviteCodec.kt');
const vpnService = read('MCTier-Android/app/src/main/java/com/easytier/jni/EasyTierVpnService.kt');
const voiceService = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/service/VoiceForegroundService.kt');
const repository = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt');
const secureStore = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/SecurePreferenceStore.kt');
const models = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/data/Models.kt');
const chatServer = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/network/ChatHttpServer.kt');
const chatClient = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/network/ChatP2PClient.kt');

test('Android manifest keeps non-entry components private and disables global cleartext', () => {
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:name="\.PortraitCaptureActivity"[\s\S]*?android:exported="false"/);
  assert.match(manifest, /android:name="\.service\.ScreenCaptureService"[\s\S]*?android:exported="false"/);
  assert.match(manifest, /android:name="\.service\.VoiceForegroundService"[\s\S]*?android:exported="false"/);
  assert.match(manifest, /android:name="com\.easytier\.jni\.EasyTierVpnService"[\s\S]*?android:exported="false"/);
  assert.match(manifest, /android:name="\.service\.MctierAccessibilityService"[\s\S]*?android:exported="true"[\s\S]*?android:permission="android\.permission\.BIND_ACCESSIBILITY_SERVICE"/);
  assert.doesNotMatch(manifest, /androidx\.core\.content\.FileProvider/);
});

test('network security allows cleartext only through explicit scoped exceptions', () => {
  assert.match(networkSecurity, /<base-config\s+cleartextTrafficPermitted="false"\s*\/>/);
  assert.match(networkSecurity, /<domain-config\s+cleartextTrafficPermitted="true">/);
  assert.doesNotMatch(networkSecurity, /cleartextTrafficPermitted="true"[^>]*>\s*<\/base-config>/);
});

test('deep links require the registered VIEW route and clear URI credentials after handling', () => {
  assert.match(mainActivity, /intent\?\.action\s*!=\s*Intent\.ACTION_VIEW/);
  assert.match(mainActivity, /data\.host\.equals\("join",\s*ignoreCase\s*=\s*true\)/);
  assert.match(mainActivity, /data\.path\.orEmpty\(\)\s*!in\s*setOf\("",\s*"\/"\)/);
  assert.match(mainActivity, /intent\?\.let\s*\{\s*if\s*\(it\.data\s*==\s*data\)\s*it\.data\s*=\s*null\s*\}/);
  assert.match(inviteCodec, /fun isValidLobbyPassword/);
  assert.match(inviteCodec, /isUnsafeControl/);
  assert.match(inviteCodec, /fun isValidEasyTierNode/);
  assert.match(inviteCodec, /fun isValidSignalingServer/);
  assert.match(mctierApp, /if \(state\.pendingJoin == null\) repository\.maybeAutoJoin\(\)/);
});

test('foreground services fail closed on invalid input or missing permission', () => {
  assert.doesNotMatch(vpnService, /arrayListOf\("10\.0\.0\.0\/8"\)/);
  assert.match(vpnService, /Rejecting invalid VPN start request/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_SYSTEM_EXEMPTED/);
  assert.match(manifest, /android:name="com\.easytier\.jni\.EasyTierVpnService"[\s\S]*?android:foregroundServiceType="systemExempted"/);
  assert.match(vpnService, /ServiceInfo\.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED/);
  assert.match(vpnService, /Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE/);
  assert.match(voiceService, /RECORD_AUDIO/);
  assert.match(voiceService, /Rejecting voice foreground service without microphone permission/);
  assert.match(voiceService, /Failed to start voice foreground service/);
});

test('lobby credentials use Keystore-backed encryption and no new plaintext writes', () => {
  assert.match(secureStore, /AndroidKeyStore/);
  assert.match(secureStore, /AES\/GCM\/NoPadding/);
  assert.match(repository, /SecureAutoLobbyPasswordKey/);
  assert.match(repository, /saveSecurePreference\(/);
  assert.match(secureStore, /fun putStringRemoving/);
  assert.match(secureStore, /\.remove\(legacyKey\)[\s\S]{0,80}\.commit\(\)/);
  assert.match(repository, /securePrefs\.putStringRemoving/);
  assert.doesNotMatch(repository, /putString\("autoLobbyPassword"/);
  assert.doesNotMatch(repository, /putString\("favorites"/);
  assert.doesNotMatch(repository, /putString\("recentLobbies"/);
});

test('Android P2P chat is gated by signaling token, epoch, and source IP identity', () => {
  assert.match(models, /val chatToken: String\? = null/);
  assert.match(models, /val chatTokenEpoch: Long\? = null/);
  assert.match(repository, /"register-success"[\s\S]{0,1800}chatTokenEpoch/);
  assert.match(repository, /"chat-token-rotated"[\s\S]{0,1400}rotateToken/);
  assert.match(repository, /"player-left"[\s\S]{0,900}currentChatPeers\(setOf\(id\)\)/);
  assert.doesNotMatch(repository, /ChatP2PClient\([^\n]+\)\.also\s*\{\s*it\.start/);

  assert.match(chatServer, /ChatTokenHeader/);
  assert.match(chatServer, /session\.remoteIpAddress/);
  assert.match(chatServer, /snapshot\.identities\[source\]/);
  assert.match(chatServer, /it is Inet4Address/);
  assert.match(chatServer, /byteArrayOf\(10, 126, 126\)/);
  assert.match(chatServer, /isMessageIdForPlayer/);
  assert.match(chatServer, /messages\.any \{ it\.id == message\.id \}/);

  assert.match(chatClient, /followRedirects\(false\)/);
  assert.match(chatClient, /followSslRedirects\(false\)/);
  assert.match(chatClient, /\.header\(ChatTokenHeader, token\)/);
  assert.match(chatClient, /Chat send suppressed before authenticated session/);
});

test('public lobbies are passwordless and plaza metadata has no credential field', () => {
  const publicLobbyWire = models.slice(
    models.indexOf('data class PublicLobbyWire'),
    models.indexOf('/** 收藏大厅'),
  );
  assert.doesNotMatch(publicLobbyWire, /val password/);
  assert.match(inviteCodec, /if \(text\.isEmpty\(\)\) return true/);
  assert.match(mctierApp, /onFill\(lobby\.lobbyName, "", lobby\.serverNode\)/);
  assert.match(mctierApp, /Public lobbies must not have a password/);
  assert.match(repository, /if \(isPublic && !_state\.value\.lobby\?\.password\.isNullOrEmpty\(\)\)/);
  assert.doesNotMatch(repository, /password = publicPassword/);
});
