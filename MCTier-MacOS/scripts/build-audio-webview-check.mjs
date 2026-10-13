import { build } from 'esbuild';
import fs from 'node:fs/promises';
import ts from 'typescript';
const output = 'src-tauri/target/audio-webview-check';
const rtcSource = ts.createSourceFile('WebRTCClient.ts', await fs.readFile('src/services/webrtc/WebRTCClient.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const stubs = new Map();
for (const statement of rtcSource.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
  stubs.set(statement.moduleSpecifier.text, statement.importClause.namedBindings.elements.filter(item => !item.isTypeOnly).map(item => `export const ${(item.propertyName ?? item.name).text} = {};`).join('\n'));
}
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: [process.argv[2] || 'tests/fixtures/audio-webview-check.ts'], bundle: true, format: 'iife', outfile: `${output}/check.js`,
  define: { 'globalThis.audioCheckOneSidedIce': process.env.MCTIER_AUDIO_CHECK_ONE_SIDED === '1' ? 'true' : 'false' },
  plugins: [{ name: 'isolated-call-playback', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (!args.importer.endsWith('WebRTCClient.ts')) return;
      if (args.path === '@tauri-apps/api/core' || /(?:registeredSocket|audioDevices|audioTransceiver|voiceHealth|trustBoundary|signalingTrustBoundary|lobbyCaptureGate)$/.test(args.path)) return;
      return { path: args.path, namespace: 'isolated-call' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'isolated-call' }, args => ({ contents: args.path.endsWith('/stores')
      ? 'export const useAppStore={getState:()=>({globalMuted:false,mutedPlayers:new Set(),playerVolumes:new Map([["test-peer",0.01]]),myVoiceGroup:0,playerVoiceGroups:new Map()})};'
      : args.path.endsWith('voiceChangerService') ? 'export const voiceChangerService={process:stream=>stream,setOutputChangedHandler(){},dispose(){}};'
      : stubs.get(args.path) ?? '' }));
  } }, { name: 'local-worklet', setup(builder) {
    builder.onResolve({ filter: /nativeMicrophoneWorklet\.js\?url/ }, () => ({ path: 'worklet', namespace: 'check' }));
    builder.onLoad({ filter: /.*/, namespace: 'check' }, () => ({ contents: 'export default "/worklet.js";' }));
  } }],
});
await fs.copyFile('src/services/voice/nativeMicrophoneWorklet.js', `${output}/worklet.js`);
await fs.writeFile(`${output}/index.html`, '<!doctype html><meta charset="utf-8"><title>MCTier audio integration check</title><p>Audio integration check</p><script src="/check.js"></script>');
console.log(`Audio WebView2 fixture prepared in ${output}`);
