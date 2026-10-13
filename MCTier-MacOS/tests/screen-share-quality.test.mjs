import test from 'node:test';
import assert from 'node:assert/strict';
import { screenDimensions, screenBitrate, normalizeScreenQuality, screenSenderLimits } from '../src/services/screenShare/quality.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('quality limits preserve aspect ratio, orientation and original size', () => {
  assert.deepEqual(screenDimensions(3840, 2160, 1080), [1920, 1080]);
  assert.deepEqual(screenDimensions(2160, 3840, 1080), [1080, 1920]);
  assert.deepEqual(screenDimensions(1280, 720, 2160), [1280, 720]);
  assert.deepEqual(screenDimensions(2560, 1080, 1080), [1920, 810]);
  assert.deepEqual(screenDimensions(0, 0, 720), [1280, 720]);
});

test('all high frame rate profiles keep their requested FPS and bounded bitrate', () => {
  for (const resolution of [720, 1080, 1440, 2160]) {
    for (const frameRate of [30, 60, 120]) {
      const q = { resolution, frameRate, bitrateMbps: 0 };
      assert.equal(screenSenderLimits(q, true).maxFramerate, frameRate);
      assert.ok(screenBitrate(q) >= 2_000_000 && screenBitrate(q) <= 64_000_000);
      assert.deepEqual(screenSenderLimits(q, false), {});
    }
  }
  assert.equal(screenBitrate({ resolution: 2160, frameRate: 120, bitrateMbps: 0 }), 64_000_000);
  assert.equal(screenBitrate({ resolution: 2160, frameRate: 120, bitrateMbps: 8 }), 8_000_000);
});

test('old or corrupt saved preferences fall back to safe defaults', () => {
  assert.deepEqual(normalizeScreenQuality({ resolution: -1, frameRate: 999, bitrateMbps: -3 }),
    { resolution: 1080, frameRate: 30, bitrateMbps: 0 });
  assert.deepEqual(normalizeScreenQuality(null), normalizeScreenQuality());
});

test('real sharing service applies 4K/120 capture and encoding limits after negotiation', async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/screenShare/ScreenShareService.ts', import.meta.url))], bundle: true, format: 'esm', write: false, drop: ['console'], plugins: [{ name: 'native-capture', setup(b) {
    b.onResolve({ filter: /\/nativeCapture$/ }, () => ({ path: 'capture', namespace: 'capture' }));
    b.onLoad({ filter: /.*/, namespace: 'capture' }, () => ({ contents: 'export const requestNativeScreen = (...args) => globalThis.__qualityCapture(...args);' }));
  } }] });
  const { screenShareService } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
  const service = new screenShareService.constructor();
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldPeer = globalThis.RTCPeerConnection;
  let captureOptions, outgoing, stopped = 0;
  const track = { kind: 'video', getSettings: () => ({ width: 3840, height: 2160 }),
    stop: () => { stopped++; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getDisplayMedia: async () => { throw new Error('Browser capture is forbidden'); },
  } } });
  globalThis.__qualityCapture = async options => { captureOptions = options; return stream; };
  globalThis.RTCPeerConnection = class {
    addTrack() {}
    async setRemoteDescription() {}
    async createAnswer() { return { type: 'answer', sdp: 'test' }; }
    async setLocalDescription() { this.negotiated = true; }
    getSenders() { return [{ track, getParameters: () => ({ encodings: [{}] }), setParameters: async parameters => {
      assert.ok(this.negotiated); outgoing = parameters;
    } }]; }
    close() {}
  };
  service.startOutboundHealthHeartbeat = () => {};
  try {
    service.initialize('owner', 'Owner', null);
    const shareId = await service.startSharing(false, undefined, { resolution: 2160, frameRate: 120, bitrateMbps: 32 });
    assert.equal(captureOptions.frameRate, 120);
    assert.equal(captureOptions.resolution, 2160);
    await service.handleOffer({ shareId, playerId: 'viewer', playerName: 'Viewer', requirePassword: false, sdp: 'offer' });
    assert.equal(outgoing.encodings[0].maxFramerate, 120);
    assert.equal(outgoing.encodings[0].maxBitrate, 32_000_000);
    service.stopSharing(shareId);
    assert.equal(stopped, 1);

    // A low quality local preference must not restrict an incoming 4K stream.
    service.initialize('relay', 'Relay', null);
    service.localQuality = { resolution: 720, frameRate: 30, bitrateMbps: 4 };
    service.activeShares.set(shareId, { id: shareId, playerId: 'owner' });
    service.remoteStreams.set(shareId, stream);
    service.expectedDownstreams.set(shareId, new Map([['viewer', 1]]));
    outgoing = null;
    await service.handleOffer({ shareId, playerId: 'viewer', playerName: 'Viewer', requirePassword: false, sdp: 'offer', routeVersion: 1 });
    assert.ok(outgoing);
    assert.equal(outgoing.encodings[0].maxFramerate, undefined);
    assert.equal(outgoing.encodings[0].maxBitrate, undefined);

    globalThis.__qualityCapture = async () => { throw new Error('native capture rejected'); };
    await assert.rejects(service.startSharing(false), /native capture rejected/);
    assert.equal(stopped, 1, 'failed native startup must not stop an unrelated track');
    assert.equal(service.localStream, null);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
    globalThis.RTCPeerConnection = oldPeer;
    delete globalThis.__qualityCapture;
  }
});
