import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolPath = path.join(root, 'shared', 'signaling-protocol.json');
const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
const webRtcSource = fs.readFileSync(
  path.join(root, 'src', 'services', 'webrtc', 'WebRTCClient.ts'),
  'utf8'
);

test('shared signaling protocol manifest declares protocol v3 categories', () => {
  assert.equal(protocol.protocolVersion, 3);
  assert.equal(protocol.transport, 'websocket');
  assert.equal(protocol.legacyRegistrationType, 'register');
  assert.equal(protocol.$schema, undefined, 'an inventory must not identify itself as JSON Schema');
  assert.equal(typeof protocol.messageTypes, 'object');

  const requiredCategories = [
    'registration',
    'challenge',
    'lobby',
    'webrtc',
    'screen',
    'file',
    'remoteControl',
    'communityNodes',
  ];
  for (const category of requiredCategories) {
    assert.ok(Array.isArray(protocol.messageTypes[category]), `${category} must be an array`);
    assert.ok(protocol.messageTypes[category].length > 0, `${category} must not be empty`);
    assert.ok(
      protocol.messageTypes[category].every(
        (messageType) =>
          typeof messageType === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(messageType)
      ),
      `${category} entries must be kebab-case wire names`
    );
  }

  const allMessageTypes = Object.values(protocol.messageTypes).flat();
  assert.equal(
    new Set(allMessageTypes).size,
    allMessageTypes.length,
    'message types must be unique across categories'
  );
  assert.ok(protocol.messageTypes.registration.includes('register-v3'));
  assert.ok(protocol.messageTypes.challenge.includes('server-challenge'));
  assert.ok(protocol.messageTypes.webrtc.includes('offer'));
  assert.ok(protocol.messageTypes.screen.includes('screen-share-offer'));
  assert.ok(protocol.messageTypes.file.includes('file-share-list-request'));
  assert.ok(protocol.messageTypes.remoteControl.includes('remote-control-request'));
  assert.ok(protocol.messageTypes.communityNodes.includes('community-node-list-request'));

  for (const nonWebSocketType of [
    'file-share-list',
    'file-list-request',
    'file-list-response',
    'file-transfer-request',
    'file-transfer-response',
    'file-chunk',
    'file-transfer-complete',
    'file-transfer-error',
    'share-added',
    'share-removed',
  ]) {
    assert.ok(
      !allMessageTypes.includes(nonWebSocketType),
      `${nonWebSocketType} is not a SignalingMessage wire type`
    );
  }
});

test('WebRTCClient reads the signaling protocol version from the shared manifest', () => {
  assert.match(
    webRtcSource,
    /import signalingProtocol from ['"]\.\.\/\.\.\/\.\.\/shared\/signaling-protocol\.json['"]/
  );
  assert.match(
    webRtcSource,
    /const SIGNALING_PROTOCOL_VERSION = signalingProtocol\.protocolVersion;/
  );
});

test('desktop and Android signing versions agree with the shared manifest', () => {
  const rustSource = fs.readFileSync(
    path.join(root, 'src-tauri', 'src', 'modules', 'chat_auth.rs'),
    'utf8'
  );
  const androidSource = fs.readFileSync(
    path.join(
      root,
      'MCTier-Android',
      'app',
      'src',
      'main',
      'java',
      'top',
      'pmh13',
      'mctier',
      'network',
      'ChatAuth.kt'
    ),
    'utf8'
  );
  const rustVersion = rustSource.match(/pub const SIGNALING_PROTOCOL_VERSION:\s*u8\s*=\s*(\d+);/);
  const androidVersion = androidSource.match(/const val SIGNALING_PROTOCOL_VERSION\s*=\s*(\d+)/);

  assert.ok(rustVersion, 'desktop signing version must be declared');
  assert.ok(androidVersion, 'Android signing version must be declared');
  assert.equal(Number(rustVersion[1]), protocol.protocolVersion);
  assert.equal(Number(androidVersion[1]), protocol.protocolVersion);
});
