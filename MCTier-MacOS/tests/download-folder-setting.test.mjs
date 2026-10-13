import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the shared control's native command boundary and saved-state lifecycle.
const bundle = await build({ entryPoints: ['src/components/FileShareManager/DownloadFolderSetting.tsx'], bundle: true,
  format: 'esm', write: false, jsx: 'automatic', plugins: [{ name: 'folder-ui', setup(b) {
    b.onResolve({ filter: /^(react|antd|@tauri-apps\/api\/core)|\/i18n$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'react' ? 'export const useState=(...a)=>globalThis.folderTest.state(...a); export const useEffect=(...a)=>globalThis.folderTest.effect(...a);'
      : args.path.includes('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;'
      : args.path === 'antd' ? 'export const Button="button",Input="input";export const message={success(){},error(){globalThis.folderTest.errors++;}};'
      : args.path.includes('i18n') ? 'export const tl=(zh)=>zh;'
      : 'export const invoke=(...a)=>globalThis.folderTest.invoke(...a);' }));
  } }] });
const { DownloadFolderSetting } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

test('both settings contexts reuse saved path, cancellation and failed saves preserve it, reset persists', async () => {
  let saved = 'C:\\Downloads\\Original', choice = null, rejectSave = false;
  let hooks, cursor, mounted;
  const calls = [];
  globalThis.folderTest = {
    errors: 0,
    state(initial) { const i=cursor++; if (!(i in hooks)) hooks[i]=initial; return [hooks[i],value=>{hooks[i]=value;}]; },
    effect(fn) { if (!mounted) fn(); },
    async invoke(command, args) {
      calls.push(command);
      if (command === 'get_settings') return { fileShareDownloadDir: saved };
      if (command === 'select_file_share_download_folder') return choice;
      assert.equal(command, 'set_file_share_download_dir', 'changing the folder must not restart networking');
      if (rejectSave) throw new Error('denied');
      saved = args.path;
    },
  };
  const render = () => { cursor=0; const tree=DownloadFolderSetting(); mounted=true; return tree; };
  const mount = async () => { hooks=[]; mounted=false; render(); await flush(); };
  const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const input = () => nodes(render()).find(n=>n.type==='input').props.value;
  const click = async label => { const button=nodes(render()).find(n=>n.type==='button' && n.props.children===label); assert.ok(button); assert.equal(button.props.disabled,false); button.props.onClick(); await flush(); };
  try {
    await mount();
    assert.equal(input(), saved);
    await click('选择文件夹');
    assert.equal(calls.filter(c=>c==='set_file_share_download_dir').length, 0);
    choice='D:\\Shared downloads';
    await click('选择文件夹');
    assert.equal(input(), choice);
    await mount(); // reopening from either entry reads the same persistent setting
    assert.equal(input(), choice);
    rejectSave=true; choice='E:\\Denied';
    await click('选择文件夹');
    assert.equal(input(), 'D:\\Shared downloads');
    assert.equal(globalThis.folderTest.errors, 1);
    rejectSave=false;
    await click('恢复默认');
    assert.equal(saved,null);
    await mount();
    assert.match(input(), /系统默认/);
  } finally { delete globalThis.folderTest; }
});
