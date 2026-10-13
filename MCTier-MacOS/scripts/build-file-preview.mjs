import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const wasm = await readFile(path.join(root, 'node_modules/libarchive.js/dist/libarchive.wasm'));
const worker = (await readFile(path.join(root, 'node_modules/libarchive.js/dist/worker-bundle.js'), 'utf8'))
  .replaceAll('import.meta.url', 'self.location.href')
  .replaceAll('libarchive.wasm', `data:application/wasm;base64,${wasm.toString('base64')}`);
const result = await build({
  entryPoints: [path.join(root, 'shared/file-preview/viewer.js')], bundle: true, write: false,
  format: 'iife', minify: true, target: 'es2020',
  plugins: [{ name: 'inline-archive-worker', setup(builder) {
    builder.onResolve({ filter: /worker\.generated\.js$/ }, () => ({ path: 'worker', namespace: 'inline' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline' }, () => ({ contents: `export const archiveWorkerSource = ${JSON.stringify(worker)}` }));
  } }],
});
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; worker-src blob:; connect-src data: https://preview.mctier.invalid/attachment"><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font:14px system-ui;color:#202124;background:#edf0f2}html[data-theme=dark],html[data-theme=dark] body{color:#edf0f2;background:#181b20}#content{margin:12px auto;width:calc(100% - 24px);max-width:1200px;overflow:auto}#status{text-align:center;padding:28px}#content>div{margin:auto}.archive-tree{list-style:none;margin:0;padding:0}.archive-tree li{display:flex;justify-content:space-between;gap:18px;padding:9px 12px;border-bottom:1px solid #8883}.archive-tree span{overflow-wrap:anywhere;min-width:0}.archive-tree small{white-space:nowrap;opacity:.65}
</style></head><body><div id="status">正在加载预览 / Loading preview</div><main id="content"></main><script>${script}</script></body></html>`;
for (const folder of ['public/file-preview']) {
  await mkdir(path.join(root, folder), { recursive: true });
  await writeFile(path.join(root, folder, 'index.html'), html);
  const licenses = path.join(root, folder, 'licenses');
  await mkdir(licenses, { recursive: true });
  for (const [source, name] of [
    ['node_modules/@aiden0z/pptx-renderer/LICENSE', 'pptx-renderer-LICENSE.txt'],
    ['node_modules/@aiden0z/pptx-renderer/THIRD_PARTY_NOTICES.md', 'pptx-renderer-NOTICES.md'],
    ['node_modules/libarchive.js/LICENSE', 'libarchivejs-LICENSE.txt'],
    ['licenses/LICENSE-Apache-2.0.txt', 'sherpa-onnx-LICENSE.txt'],
  ]) await cp(path.join(root, source), path.join(licenses, name));
  await cp(path.join(root, 'node_modules/@aiden0z/pptx-renderer/licenses'), path.join(licenses, 'pptx-renderer'), { recursive: true });
}
console.log('Built isolated desktop and Android file previews');
// The desktop PDF preview renders with app controls; keep all decoder/font assets local.
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(root, 'node_modules/pdfjs-dist', folder), path.join(root, 'public/pdfjs', folder), { recursive: true });
}
await cp(path.join(root, 'node_modules/pdfjs-dist/LICENSE'), path.join(root, 'public/pdfjs/LICENSE'));
