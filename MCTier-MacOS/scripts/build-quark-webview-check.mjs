import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('.artifacts/quark-ui-check');
await mkdir(out, { recursive: true });
await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { invoke } from '@tauri-apps/api/core';
    import { QuarkStartupPrompt } from './src/components/QuarkSupport/QuarkStartupPrompt';
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const visible = el => el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
    const button = label => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label && visible(el));
    const waitFor = async condition => { for (let i = 0; i < 120; i++) { if (condition()) return; await wait(25); } throw Error('UI condition timed out'); };
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    let root = createRoot(document.getElementById('root'));
    const state = () => ({ ready: true, loggedIn: false, name:'', enabled:false, dismissed:false, result:'', backgroundSupported:true, backgroundRegistered:false, backgroundError:'', loginId:null, loginMethod:null, qrUrl:null, expiresIn:0, stats:{successDays:0, pcReferenceCents:0,mobileReferenceCents:0,firstDay:null,lastDay:null,todayAttempted:false} });
    globalThis.__quarkState = state();
    globalThis.__quarkStart = Promise.resolve(); globalThis.__quarkCalls=[];
    const render = (ready, updating) => root.render(<QuarkStartupPrompt versionVisible={updating}/>);
    const fresh = async loggedIn => { root.unmount(); await wait(80); root=createRoot(document.getElementById('root')); globalThis.__quarkState={...state(),loggedIn}; };
    (async () => {
      const checks = [];
      render(false,false); await waitFor(() => button('下次一定')); checks.push('immediate invitation before update check');
      render(true,true); await waitFor(() => !button('下次一定')); assert(!button('下次一定'), 'covered version prompt'); checks.push('update priority');
      render(true,false); await waitFor(() => button('下次一定'));
      const later=button('下次一定'), support=button('支持一下');
      assert(getComputedStyle(later).backgroundColor === 'rgb(237, 237, 237)', 'later not gray');
      assert(getComputedStyle(support).backgroundColor === 'rgb(39, 130, 59)', 'support not green');
      assert(document.body.textContent.includes('希望您能在MCTier上登录一下夸克账号'), 'missing requested copy'); assert(document.body.textContent.includes('这对MCTier的发展至关重要'), 'missing final paragraph');
      const modal = later.closest('.ant-modal');
      assert(modal.getBoundingClientRect().width <= innerWidth, 'modal too wide');
      later.click(); await waitFor(() => !button('下次一定')); render(true,false); await wait(100);
      assert(!button('下次一定'), 'repeated within same launch'); checks.push('dismiss and layout');
      await fresh(false); render(true,false); await waitFor(() => button('支持一下')); button('支持一下').click();
      await waitFor(() => button('获取登录二维码')); assert(document.body.textContent.includes('手机号登录'), 'SMS choice missing'); checks.push('new launch and sponsor navigation');
      assert(!document.querySelector('input[type=checkbox]'), 'consent checkbox still present');
      assert(!button('获取登录二维码').disabled, 'QR login still gated');
      button('获取登录二维码').click(); await waitFor(() => globalThis.__quarkCalls.includes('login')); await wait(80);
      const phone = [...document.querySelectorAll('.ant-segmented-item')].find(el => el.textContent.trim() === '手机号登录');
      assert(phone, 'phone tab missing'); phone.querySelector('input').click(); await waitFor(() => button('开始手机号登录'));
      assert(!button('开始手机号登录').disabled, 'SMS login still gated');
      button('开始手机号登录').click(); await waitFor(() => globalThis.__quarkCalls.includes('mobile_login'));
      assert(!document.body.textContent.includes('开机') && !document.body.textContent.includes('关闭 MCTier'), 'background copy remains');
      checks.push('direct QR and SMS login without checkbox');
      globalThis.__quarkState={...state(),loginId:'phone-test',loginMethod:'mobile',expiresIn:600};
      render(true,false); await waitFor(() => document.querySelector('.quark-mobile-login iframe'));
      const frameHeight=parseFloat(getComputedStyle(document.querySelector('.quark-mobile-login iframe')).height); assert(frameHeight === 240, 'phone frame height: '+frameHeight);
      checks.push('compact phone form');
      await fresh(true); render(true,false); await wait(250); assert(!button('下次一定'), 'prompted signed-in account'); checks.push('signed-in suppression');
      await fresh(false); let release; globalThis.__quarkStart=new Promise(resolve => release=resolve);
      render(true,false); await wait(150); assert(!button('下次一定'), 'prompted before login load'); release();
      await waitFor(() => button('下次一定')); checks.push('wait for account state');
      await invoke('quark_check_report', { report:{ ok:true, checks, viewport:innerWidth } });
    })().catch(async error => { await invoke('quark_check_report', { report:{ok:false,error:String(error), text:document.body.textContent.slice(0,1200)} }); });
  ` },
  bundle: true, outfile: path.join(out, 'check.js'), format: 'iife', target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'local-quark', setup(b) {
    b.onResolve({ filter: /services\/quarkSupport$/ }, () => ({ path: 'quark-service', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const useQuarkSupport=()=>globalThis.__quarkState;
      export const getQuarkSupportSnapshot=()=>globalThis.__quarkState;
      export const loadQuarkSupport=()=>globalThis.__quarkStart;
      export const quarkSupport=async(action)=>{globalThis.__quarkCalls.push(action);return globalThis.__quarkState;};
    ` }));
    b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'language' }));
    b.onLoad({ filter: /.*/, namespace: 'language' }, () => ({ contents: 'export const tl=(zh)=>zh;' }));
  }}],
});
await writeFile(path.join(out, 'index.html'), '<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="check.css"><div id="root"></div><script src="check.js"></script></html>');
console.log('Built isolated Quark startup UI check');
