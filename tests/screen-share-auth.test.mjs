import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const desktop = fs.readFileSync(new URL('../src/services/screenShare/ScreenShareService.ts', import.meta.url), 'utf8');
const androidController = fs.readFileSync(new URL('../MCTier-Android/app/src/main/java/top/pmh13/mctier/network/ScreenShareController.kt', import.meta.url), 'utf8');
const androidRepository = fs.readFileSync(new URL('../MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt', import.meta.url), 'utf8');

test('relay viewers cannot use a legacy or unassigned offer', () => {
  const desktopOffer = desktop.slice(desktop.indexOf('async handleOffer'), desktop.indexOf('async handleAnswer'));
  const mismatch = desktopOffer.slice(
    desktopOffer.indexOf('if (!isLegacyDirectOffer && (isNullish(expectedVersion)'),
    desktopOffer.indexOf('if (isLegacyDirectOffer && share.requirePassword'),
  );
  const androidOffer = androidController.slice(
    androidController.indexOf('private fun handleViewerOffer'),
    androidController.indexOf('private fun processPendingOffers'),
  );

  assert.match(desktopOffer, /if \(!isOwner && isNullish\(offer\.routeVersion\)\) return;/);
  assert.match(mismatch, /return;/);
  assert.match(mismatch, /pendingRelayOffers\.set\(this\.relayOfferKey\(/);
  assert.match(androidOffer, /if \(!isOwner && message\.routeVersion == null\) return/);
});

test('ICE buffering is partitioned by direction, peer, and route version', () => {
  assert.match(desktop, /private iceKey\(shareId: string, direction: 'in' \| 'out', peerId: string, routeVersion\?: number\)/);
  assert.match(androidController, /private fun iceKey\(shareId: String, direction: String, playerId: String, routeVersion: Int\?\)/);
  assert.match(desktop, /flushPendingIce\(this\.iceKey\(offer\.shareId, 'out', offer\.playerId, offer\.routeVersion\), pc\)/);
  assert.match(androidController, /flushPendingIce\(iceKey\(shareId, "out", from, message\.routeVersion\), pc\)/);
});

test('Android capture announcement is gated on capture success and stop callback', () => {
  assert.match(androidController, /fun startSharing\(shareId: String, permissionData: Intent, password: String\? = null\): Boolean/);
  assert.match(androidController, /onCaptureStopped\?\.invoke\(shareId\)/);
  assert.match(androidRepository, /val started = screenController\?\.startSharing\(shareId, data, password\) == true/);
  assert.match(androidRepository, /announcedScreenShares \+= shareId/);
});

test('Android delayed capture starts are invalidated across lifecycle changes', () => {
  const startBlock = androidRepository.slice(
    androidRepository.indexOf('fun startScreenCapture'),
    androidRepository.indexOf('fun stopScreenCapture'),
  );
  assert.match(androidRepository, /private var screenCaptureStartJob: Job\? = null/);
  assert.match(androidRepository, /private var screenCaptureGeneration = 0L/);
  assert.match(androidRepository, /private fun invalidatePendingScreenCapture\(\)/);
  assert.match(androidRepository, /private fun isCurrentScreenCaptureStart\(/);
  assert.match(startBlock, /invalidatePendingScreenCapture\(\)/);
  assert.match(startBlock, /val generation = screenCaptureGeneration/);
  assert.match(startBlock, /if \(!isCurrentScreenCaptureStart\(generation, shareId, playerId\)\) return@launch/);
  assert.equal((startBlock.match(/isCurrentScreenCaptureStart\(generation, shareId, playerId\)/g) ?? []).length, 3);
  assert.match(startBlock, /if \(screenCaptureGeneration == generation\) screenCaptureStartJob = null/);
  assert.match(androidRepository.slice(androidRepository.indexOf('fun leaveLobby'), androidRepository.indexOf('fun reloadLobby')), /invalidatePendingScreenCapture\(\)/);
  assert.match(androidRepository.slice(androidRepository.indexOf('private fun handleLocalCaptureStopped'), androidRepository.indexOf('/** 开始共享自己的屏幕')), /invalidatePendingScreenCapture\(\)/);
  assert.match(androidRepository.slice(androidRepository.indexOf('fun stopScreenCapture'), androidRepository.indexOf('// ========================= 远程控制')), /invalidatePendingScreenCapture\(\)/);
});

test('Android rejects a required screen-share password before mutating capture state', () => {
  const startBlock = androidRepository.slice(
    androidRepository.indexOf('fun startScreenCapture'),
    androidRepository.indexOf('fun stopScreenCapture'),
  );
  assert.match(startBlock, /if \(requirePassword && password\?\.trim\(\)\.isNullOrEmpty\(\)\)/);
  assert.match(startBlock, /error = L\("请设置屏幕共享密码", "Set a screen sharing password"\)/);
  assert.ok(startBlock.indexOf('password?.trim().isNullOrEmpty()') < startBlock.indexOf('invalidatePendingScreenCapture()'));
  assert.doesNotMatch(startBlock.slice(0, startBlock.indexOf('invalidatePendingScreenCapture()')), /screen-share-start/);
});

test('Relay offers are keyed and resumed by their exact route version', () => {
  assert.match(desktop, /private relayOfferKey\(shareId: string, peerId: string, routeVersion\?: number\)/);
  assert.match(androidController, /private fun relayOfferKey\(shareId: String, playerId: String, routeVersion: Int\?\)/);
  assert.match(desktop, /this\.pendingRelayOffers\.set\(this\.relayOfferKey\(offer\.shareId, offer\.playerId, Number\(offer\.routeVersion\)\), offer\)/);
  assert.match(androidController, /pendingOffers\[relayOfferKey\(shareId, from, message\.routeVersion\)\] = message/);
  assert.match(desktop, /const pendingKey = this\.relayOfferKey\(shareId, message\.downstreamId, routeVersion\)/);
  assert.match(androidController, /pendingOffers\.remove\(relayOfferKey\(shareId, downstreamId, version\)\)/);
  assert.match(desktop, /for \(const \[downstreamId, expectedVersion\] of expected\.entries\(\)\)/);
  assert.match(androidController, /expectedDownstreams\[peerKey\(shareId, from\)\] == message\.routeVersion/);
});

test('Desktop child assignments ignore older route versions', () => {
  const childBlock = desktop.slice(desktop.indexOf("message.action === 'child'"), desktop.indexOf("message.action === 'detach'", desktop.indexOf("message.action === 'child'")));
  assert.match(childBlock, /const previousVersion = expected\.get\(message\.downstreamId\)/);
  assert.match(childBlock, /if \(!isNullish\(previousVersion\) && routeVersion < previousVersion\) return;/);
});

test('Desktop owner accepts relay failure only for the assigned edge and version', () => {
  const failureBlock = desktop.slice(desktop.indexOf("message.action === 'failure'"), desktop.indexOf("// The failed edge is removed", desktop.indexOf("message.action === 'failure'")));
  assert.match(failureBlock, /if \(isNullish\(message\.upstreamId\) \|\| isNullish\(message\.routeVersion\)\) return;/);
  assert.match(failureBlock, /if \(!assignedUpstream \|\| message\.upstreamId !== assignedUpstream\) return;/);
  assert.match(failureBlock, /if \(isNullish\(assignedVersion\) \|\| Number\(message\.routeVersion\) !== assignedVersion\) return;/);
});

test('required screen-share passwords cannot be empty on either platform', () => {
  const desktopStart = desktop.slice(desktop.indexOf('async startSharing'), desktop.indexOf('async stopSharing'));
  const androidAnnounce = androidRepository.slice(androidRepository.indexOf('fun announceScreenShare'), androidRepository.indexOf('// ========================= 文件夹共享'));
  assert.match(desktopStart, /if \(requirePassword && !password\?\.trim\(\)\)/);
  assert.ok(desktopStart.indexOf('!password?.trim()') < desktopStart.indexOf('getDisplayMedia'));
  assert.match(androidAnnounce, /if \(requirePassword && password\?\.trim\(\)\.isNullOrEmpty\(\)\)/);
});

test('direct fallback failure identifies the previously assigned upstream', () => {
  const desktopFallback = desktop.slice(desktop.indexOf('const previousUpstream = this.viewingUpstreams.get'), desktop.indexOf('pending.resolve(stream)'));
  const androidFallback = androidController.slice(androidController.indexOf('if (requestedVersion == null && effectiveReadyVersion != null'), androidController.indexOf('processPendingOffers(shareId)'));
  assert.match(desktopFallback, /upstreamId: previousUpstream/);
  assert.match(androidFallback, /previousUpstream != null/);
  assert.match(androidFallback, /upstreamId = previousUpstream/);
});
