import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Actual Zustand actions; stub only unrelated UI/network side effects.
const bundle = await build({ entryPoints: ['src/stores/appStore.ts'], bundle: true,
  format: 'esm', platform: 'node', write: false, define: { 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'moderation-store', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.path === '../services' || args.path.endsWith('/services/ui/feedback')) return { path: args.path, namespace: 'stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const webrtcClient={}; export const showFeedback=()=>{};' }));
  } }] });
const { useAppStore } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text + '\n//# sourceURL=moderation-store.js')}`);

test('host promotion clears only the new host mute and never opens the microphone', () => {
  useAppStore.setState({ hostId: 'host', hostMutedPlayers: new Set(['member', 'other']), micEnabled: false });
  useAppStore.getState().setHostId('member');
  assert.deepEqual([...useAppStore.getState().hostMutedPlayers], ['other']);
  assert.equal(useAppStore.getState().micEnabled, false);
  useAppStore.getState().setHostId('host');
  assert.equal(useAppStore.getState().hostMutedPlayers.has('member'), false);
  useAppStore.getState().setHostMuted('member', true);
  assert.equal(useAppStore.getState().hostMutedPlayers.has('member'), true);
});

test('stale mute events and reconnect snapshots cannot restrict the current host', () => {
  useAppStore.setState({ hostId: 'host', hostMutedPlayers: new Set() });
  useAppStore.getState().setHostMuted('host', true);
  assert.equal(useAppStore.getState().hostMutedPlayers.size, 0);
  useAppStore.getState().setHostMutedPlayers(['host', 'member']);
  assert.deepEqual([...useAppStore.getState().hostMutedPlayers], ['member']);
});
