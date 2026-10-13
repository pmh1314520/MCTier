import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const out = '.artifacts/recording-check';
await mkdir(out, { recursive: true });
await writeFile(`${out}/index.html`, '<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#173d2a;color:white;font-family:sans-serif"><h1>MCTier 录屏验证</h1><p>正在验证画面、系统声音及暂停保存</p><canvas id="scene" width="480" height="240"></canvas><script src="check.js"></script></body></html>');
await copyFile('src/services/voice/nativeMicrophoneWorklet.js', `${out}/worklet.js`);
await build({ entryPoints: ['tests/fixtures/recording-check.ts'], bundle: true, outfile: `${out}/check.js`, format: 'iife', target: 'chrome120',
  plugins: [{ name: 'worklet', setup(b) {
    b.onResolve({ filter: /nativeMicrophoneWorklet/ }, () => ({ path: 'worklet', namespace: 'worklet' }));
    b.onLoad({ filter: /.*/, namespace: 'worklet' }, () => ({ contents: "export default '/worklet.js'" }));
    b.onLoad({ filter: /screenRecording\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace("'recording_create'", "'recording_check_create'"), loader: 'ts' }));
    b.onLoad({ filter: /nativeMicrophone\.ts$/ }, async ({ path }) => ({ contents: (await readFile(path, 'utf8')).replace('function diagnostic(stage: string, detail: string): void {', 'function diagnostic(stage: string, detail: string): void { (window as any).__recordingDiagnostics ??= []; (window as any).__recordingDiagnostics.push({stage, detail});'), loader: 'ts' }));
  } }],
});
