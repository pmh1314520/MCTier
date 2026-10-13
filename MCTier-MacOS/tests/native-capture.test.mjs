import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/screenShare/nativeCapture.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Capture',
  plugins: [
    {
      name: 'native-ipc',
      setup(b) {
        b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({
          path: 'ipc',
          namespace: 'ipc',
        }));
        b.onLoad({ filter: /.*/, namespace: 'ipc' }, () => ({
          contents: 'export const invoke = (...args) => globalThis.fixture.invoke(...args);',
        }));
      },
    },
  ],
});
const flush = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
const quality = { resolution: 1080, frameRate: 60, bitrateMbps: 8 };
function packet(width = 2, height = 2) {
  const data = new ArrayBuffer(8 + width * height * 4),
    view = new DataView(data);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  new Uint8Array(data, 8).fill(127);
  return data;
}
function setup(generator = false) {
  const calls = [],
    draws = [],
    events = [],
    listeners = new Map();
  let choice,
    nextFrame,
    nativeStop = 0,
    trackStop = 0,
    frameRequests = 0;
  const track = {
    stop() {
      trackStop++;
    },
    requestFrame() {
      frameRequests++;
    },
    dispatchEvent(e) {
      events.push(e.type);
    },
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      putImageData(frame) {
        draws.push(frame);
      },
    }),
    captureStream: (fps) => {
      assert.ok(fps === 0 || fps === quality.frameRate);
      return stream;
    },
  };
  const fixture = {
    async invoke(name, args) {
      calls.push([name, args]);
      if (name === 'native_capture_start')
        return { id: 'session', source: { id: 'monitor:1' }, remote: args?.remote === true };
      if (name === 'native_capture_stop') {
        nativeStop++;
        return;
      }
      if (calls.filter((c) => c[0] === 'native_capture_frame').length === 1) return packet();
      return new Promise((resolve, reject) => {
        nextFrame = { resolve, reject };
      });
    },
  };
  const generatedFrames = [],
    closedFrames = [];
  let abortedWrites = 0;
  let now = 0;
  const generatedTrack = {
    stop() {
      trackStop++;
    },
    dispatchEvent(e) {
      events.push(e.type);
    },
    writable: {
      getWriter() {
        return {
          async write(frame) {
            generatedFrames.push(frame);
          },
          async abort() {
            abortedWrites++;
          },
        };
      },
    },
  };
  const context = vm.createContext({
    fixture,
    Date: { now: () => now },
    DOMException,
    AbortController,
    ArrayBuffer,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    Event,
    console: { warn() {} },
    ...(generator
      ? {
          performance: { now: () => 123.456 },
          MediaStreamTrackGenerator: class {
            constructor() {
              return generatedTrack;
            }
          },
          MediaStream: class {
            constructor(tracks) {
              this.tracks = tracks;
            }
            getTracks() {
              return this.tracks;
            }
            getVideoTracks() {
              return this.tracks;
            }
          },
          VideoFrame: class {
            constructor(pixels, options) {
              this.pixels = pixels;
              this.options = options;
            }
            close() {
              closedFrames.push(this);
            }
          },
        }
      : {}),
    window: {
      addEventListener: (n, f) => listeners.set(n, f),
      removeEventListener: (n) => listeners.delete(n),
    },
    document: { createElement: () => canvas },
    ImageData: class {
      constructor(pixels, width, height) {
        this.pixels = pixels;
        this.width = width;
        this.height = height;
      }
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const api = context.Capture;
  const unmount = api.registerCapturePicker((value) => {
    choice = value;
  });
  return {
    api,
    advanceTime(ms) { now += ms; },
    fixture,
    calls,
    draws,
    events,
    listeners,
    track,
    stream,
    unmount,
    generatedFrames,
    closedFrames,
    get abortedWrites() {
      return abortedWrites;
    },
    get next() {
      return nextFrame;
    },
    get choice() {
      return choice;
    },
    get nativeStop() {
      return nativeStop;
    },
    get trackStop() {
      return trackStop;
    },
    get frameRequests() {
      return frameRequests;
    },
    select() {
      choice.resolve({ id: 'monitor:1', kind: 'monitor', primary: true });
    },
  };
}
test('picker cancellation, abort and host teardown never start capture', async () => {
  const f = setup(),
    abort = new AbortController();
  const first = f.api.requestNativeScreen(quality, false, abort.signal);
  abort.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
  const second = f.api.requestNativeScreen(quality);
  f.choice.reject(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
  const third = f.api.requestNativeScreen(quality);
  f.unmount();
  await assert.rejects(third, { name: 'AbortError' });
});
test('one native frame in flight; consumer stop releases native session exactly once', async () => {
  const f = setup(),
    pending = f.api.requestNativeScreen(quality);
  f.select();
  const stream = await pending;
  assert.equal(f.draws.length, 1);
  assert.equal(f.frameRequests, 1);
  assert.equal(f.calls.filter((c) => c[0] === 'native_capture_frame').length, 2);
  assert.equal(f.calls[0][1].frameRate, 60);
  stream.getTracks()[0].stop();
  stream.getTracks()[0].stop();
  f.next.resolve(packet());
  await flush();
  assert.equal(f.trackStop, 1);
  assert.equal(f.nativeStop, 1);
  assert.equal(f.draws.length, 1);
  assert.equal(f.events.length, 0);
  assert.equal(f.listeners.size, 0);
});
test('native stop or target close ends the WebRTC track and notifies its owner once', async () => {
  const f = setup(),
    pending = f.api.requestNativeScreen(quality);
  f.select();
  await pending;
  f.next.reject(new Error('target closed'));
  await flush();
  assert.deepEqual(f.events, ['ended']);
  assert.equal(f.trackStop, 1);
  assert.equal(f.nativeStop, 1);
});
test('abort while native startup is pending releases the late session', async () => {
  const f = setup(),
    abort = new AbortController();
  let finish;
  const original = f.fixture.invoke;
  f.fixture.invoke = (name, args) =>
    name === 'native_capture_start'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(name, args);
  const pending = f.api.requestNativeScreen(quality, false, abort.signal);
  f.select();
  await flush();
  abort.abort();
  finish({ id: 'late' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.nativeStop, 1);
  assert.equal(f.draws.length, 0);
});
test('malformed or oversized native frames fail closed and release capture', async () => {
  const f = setup();
  assert.equal(f.api.decodeCaptureFrame(new ArrayBuffer(0)), null);
  assert.throws(() => f.api.decodeCaptureFrame(new ArrayBuffer(4)), /Truncated/);
  const huge = new ArrayBuffer(8);
  new DataView(huge).setUint32(0, 0xffffffff, true);
  assert.throws(() => f.api.decodeCaptureFrame(huge), /Invalid/);
  const pending = f.api.requestNativeScreen(quality);
  f.select();
  await pending;
  f.next.resolve(huge);
  await flush();
  assert.equal(f.nativeStop, 1);
  assert.deepEqual(f.events, ['ended']);
});

test('late callbacks from a cancelled picker cannot dismiss the next picker', async () => {
  const f = setup();
  const first = f.api.requestNativeScreen(quality);
  const old = f.choice;
  old.reject(new DOMException('Cancel', 'AbortError'));
  await assert.rejects(first, { name: 'AbortError' });
  const second = f.api.requestNativeScreen(quality);
  const current = f.choice;
  old.resolve({ id: 'stale' });
  assert.equal(f.choice, current);
  assert.equal(f.calls.length, 0);
  current.reject(new DOMException('Cancel', 'AbortError'));
  await assert.rejects(second, { name: 'AbortError' });
});

test('WebCodecs generator bypasses canvas capture and closes every submitted video frame', async () => {
  const f = setup(true),
    pending = f.api.requestNativeScreen(quality);
  f.select();
  const stream = await pending;
  assert.equal(f.draws.length, 0);
  assert.equal(f.frameRequests, 0);
  assert.equal(f.generatedFrames.length, 1);
  assert.equal(f.generatedFrames[0].options.format, 'RGBA');
  assert.equal(f.generatedFrames[0].options.timestamp, 123456);
  assert.equal(f.closedFrames.length, 1);
  f.next.resolve(packet());
  await flush();
  assert.equal(f.generatedFrames.length, 2);
  assert.equal(f.closedFrames.length, 2);
  stream.getTracks()[0].stop();
  await flush();
  assert.equal(f.abortedWrites, 1);
  assert.equal(f.trackStop, 1);
  assert.equal(f.nativeStop, 1);
});

test('remote control uses the same generated video frames as sharing and retains input authorization', async () => {
  const f = setup(true),
    pending = f.api.requestNativeScreen(quality, true);
  f.select();
  const stream = await pending;
  assert.equal(f.calls[0][1].remote, true);
  assert.equal(f.generatedFrames.length, 1);
  assert.equal(f.draws.length, 0);
  assert.equal(f.frameRequests, 0);
  f.next.resolve(packet());
  await flush();
  assert.equal(f.generatedFrames.length, 2);
  // A static desktop must still produce a keyframe for a newly attached peer.
  f.advanceTime(1000);
  f.next.resolve(new ArrayBuffer(0));
  await flush();
  assert.equal(f.generatedFrames.length, 3);
  assert.equal(f.closedFrames.length, 3);
  stream.getTracks()[0].stop();
  await flush();
  assert.equal(f.nativeStop, 1);
});

test('static native sources repeat the latest frame so late viewers receive a picture', async () => {
  const f = setup(true), pending = f.api.requestNativeScreen(quality);
  f.select(); const stream = await pending;
  f.next.resolve(new ArrayBuffer(0)); await flush();
  assert.equal(f.generatedFrames.length, 1);
  f.advanceTime(1000); f.next.resolve(new ArrayBuffer(0)); await flush();
  assert.equal(f.generatedFrames.length, 2);
  assert.equal(f.closedFrames.length, 2);
  stream.getTracks()[0].stop();
});
