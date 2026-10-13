import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/services/lobby/lobbyEntry.ts'], bundle: true, format: 'esm', write: false });
const { waitForLobbyEntry } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

const storeBundle = await build({ entryPoints: ['src/stores/appStore.ts'], bundle: true,
  format: 'esm', platform: 'node', write: false, define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'entry-store', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.path === '../services' || args.path.endsWith('/services/ui/feedback')) return { path: args.path, namespace: 'stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const webrtcClient={}; export const showFeedback=()=>{};' }));
  } }] });
const { useAppStore } = await import(`data:text/javascript,${encodeURIComponent(storeBundle.outputFiles[0].text)}`);

test('publishing a native lobby keeps the actual store on the form, and a rejected attempt can retry', async () => {
  useAppStore.setState({ appState: 'connecting', lobby: null, versionError: null });
  const store = useAppStore.getState();
  const failed = waitForLobbyEntry(useAppStore.subscribe, new AbortController().signal);
  store.setLobby({ name: 'occupied', entryMode: 'create' });
  assert.equal(useAppStore.getState().appState, 'connecting');
  store.setSignalingStatus('failed', '大厅名称已被占用，请更换大厅名称后重试');
  await assert.rejects(failed, /名称已被占用/);
  store.setLobby(null);
  const retry = waitForLobbyEntry(useAppStore.subscribe, new AbortController().signal);
  store.setLobby({ name: 'available', entryMode: 'create' });
  store.setSignalingStatus('connected');
  assert.equal(useAppStore.getState().appState, 'connecting');
  store.setAppState('in-lobby');
  await retry;
  store.setLobby({ name: 'available', entryMode: 'auto' });
  assert.equal(useAppStore.getState().appState, 'in-lobby', 'reconnect keeps the admitted lobby open');
});

test('the form waits for local initialization as well as server acceptance', async () => {
  let listener, removed = false, done = false;
  const pending = waitForLobbyEntry(fn => { listener = fn; return () => { removed = true; }; }, new AbortController().signal);
  pending.then(() => { done = true; });
  listener({ appState: 'connecting', signalingStatus: 'connected' });
  await Promise.resolve();
  assert.equal(done, false);
  listener({ appState: 'in-lobby', signalingStatus: 'connected' });
  await pending;
  assert.equal(removed, true);
});
for (const reason of ['大厅名称已被占用，请更换大厅名称后重试', '大厅不存在或已关闭，请检查大厅名称或联系房主', '密码错误']) {
  test(`registration rejection reaches the open form: ${reason}`, async () => {
    let listener;
    const pending = waitForLobbyEntry(fn => { listener = fn; return () => {}; }, new AbortController().signal);
    listener({ appState: 'connecting', signalingStatus: 'failed', signalingError: reason });
    await assert.rejects(pending, error => error.message === reason);
  });
}
test('cancelling a pending form removes its observer', async () => {
  const abort = new AbortController(); let removed = false;
  const pending = waitForLobbyEntry(() => () => { removed = true; }, abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(removed, true);
});
