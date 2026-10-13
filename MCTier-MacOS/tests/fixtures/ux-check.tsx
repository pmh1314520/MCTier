import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Modal, theme } from 'antd';
import { DesktopComplianceGate, ComplianceDocuments } from '../../src/components/ComplianceGate/ComplianceGate';
import { QuarkStartupPrompt } from '../../src/components/QuarkSupport/QuarkStartupPrompt';
import { ScreenRecordingPanel } from '../../src/components/RoomTools/ScreenRecording';
import '../../src/components/ComplianceGate/ComplianceGate.css';
import { startupVersionStage, useStartupUpdates } from '../../src/services/version/startupUpdates';
import { VersionUpdateModal } from '../../src/components/VersionUpdateModal';
const controls = window as any;

function Prompts() {
  const [blocked, setBlocked] = useState(true);
  const [mandatory, setMandatory] = useState(true);
  const {checked, update, dismiss} = useStartupUpdates();
  const stage = startupVersionStage(mandatory, checked, !!update);
  useEffect(() => { controls.setMandatory = setMandatory; }, []);
  return <><div>应用已启用</div><div data-stage={stage} data-quark-blocking={blocked}/>
    <QuarkStartupPrompt blocked={stage !== 'ready'} onBlockingChange={setBlocked} />
    <Modal open={stage === 'mandatory'} title="最低版本限制" footer={<Button onClick={()=>setMandatory(false)}>返回首页</Button>}>服务器拒绝连接</Modal>
    {update && <VersionUpdateModal visible={stage === 'optional'} {...update} onClose={dismiss}/>}
  </>;
}
const root = createRoot(document.getElementById('root')!);
function recording(dark: boolean) { root.render( <ConfigProvider theme={{algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm}}><div style={{width:380, maxWidth:'calc(100vw - 40px)', padding:20, background:dark ? '#1e1e2d':'white', color:dark ? 'white':'#222'}}><ScreenRecordingPanel /></div></ConfigProvider>
); }
function consent() { root.render(<React.StrictMode><DesktopComplianceGate><Prompts /></DesktopComplianceGate></React.StrictMode>); }

const wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
const reports: string[] = [];
function check(value:unknown, message:string) { if (!value) throw Error(message); }
async function until(predicate:()=>boolean) { for(let i=0;i<100;i++){ if(predicate())return; await wait(50); } throw Error('UI timeout: '+document.body.innerText.slice(0,300)); }
async function click(text:string) { await until(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()===text)); (Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===text) as HTMLButtonElement).click(); await wait(150); }
(async()=>{
 localStorage.removeItem('testConsent'); localStorage.removeItem('testDirectory');
 controls.uxVersion = {calls:0};
 consent(); await until(()=>document.body.innerText.includes('同意并继续'));
 check(!document.body.innerText.includes('应用已启用'),'App mounted before consent');
 for (const label of ['隐私政策', '用户协议', '权限用途说明', '免责声明']) {
   await click(label); await until(()=>!!document.querySelector('.desktop-compliance-reader .desktop-compliance-body'));
   check(document.querySelector('.desktop-compliance-reader [role="dialog"]') || document.querySelector('[role="dialog"].desktop-compliance-reader'), 'Document is not in a dialog');
   const body = document.querySelector('.desktop-compliance-body') as HTMLElement;
   check(body.scrollHeight > body.clientHeight, 'Long agreement is not scrollable');
   body.scrollTop=body.scrollHeight;
   check(!localStorage.getItem('testConsent'), 'Reading granted consent');
   await click('我已阅读');
   await until(()=>!document.body.innerText.includes('我已阅读'));
 }

 await click('不同意并退出'); check(document.body.dataset.exited==='true'&&!localStorage.getItem('testConsent'),'Decline did not exit');
 check(controls.uxVersion.calls===0,'Network update check started before consent');
 await click('同意并继续'); await until(()=>document.querySelector('[data-stage="mandatory"]')!==null);
 await until(()=>!!controls.uxVersion.finish);
 check(controls.uxVersion.calls===1,'StrictMode repeated startup request');
 check(!document.body.innerText.includes('免费持续支持 MCTier'),'Sponsor appeared during mandatory/checking');
 controls.uxVersion.finish({hasUpdate:true,latestVersion:'99.0.0',currentVersion:'1.0.0',updateMessage:'测试更新提示'});
 await wait(200); check(!document.body.innerText.includes('测试更新提示'),'Optional update overtook mandatory');
 await click('返回首页'); await until(()=>document.body.innerText.includes('测试更新提示'));
 check(!document.body.innerText.includes('免费持续支持 MCTier'),'Sponsor overtook optional update');
 await click('稍后更新'); await until(()=>document.body.innerText.includes('免费持续支持 MCTier'));
 controls.setMandatory(true); await wait(500);
 check(!document.body.innerText.includes('免费持续支持 MCTier'),'Late mandatory did not preempt sponsor');
 await click('返回首页'); await until(()=>document.body.innerText.includes('免费持续支持 MCTier'));
 await click('支持一下'); await until(()=>document.body.innerText.includes('关闭赞助'));
 controls.setMandatory(true); await wait(500);
 check(!document.body.innerText.includes('关闭赞助'),'Mandatory did not hide sponsor details');
 await click('返回首页'); await until(()=>document.body.innerText.includes('关闭赞助')); await click('关闭赞助');
 reports.push('consent > mandatory > optional > sponsorship/details; late mandatory preempts and resumes; decline exits; separate agreement readers');
 for(const outcome of ['current','unavailable','error','skipped']) {
   root.render(<div/>); await wait(100); controls.uxVersion={calls:0,skip:outcome==='skipped'}; consent();
   await until(()=>document.body.innerText.includes('应用已启用'));
   check(!document.body.innerText.includes('欢迎使用 MCTier'),'Consent repeated after remount');
   await click('返回首页'); await wait(500);
   if(outcome!=='skipped') {
     check(!document.body.innerText.includes('免费持续支持 MCTier'),'Sponsor appeared before slow check finished');
     controls.uxVersion.finish(outcome==='current'?{hasUpdate:false}:outcome==='error'?'error':null);
   }
   await until(()=>document.body.innerText.includes('免费持续支持 MCTier')); await click('下次一定');
   reports.push(outcome+' check releases sponsorship; consent retained');
 }
 for(const dark of [false,true]){
  root.render(<ConfigProvider theme={{algorithm:dark?theme.darkAlgorithm:theme.defaultAlgorithm}}><ComplianceDocuments /></ConfigProvider>);
  await until(()=>document.body.innerText.includes('隐私政策'));
  for(const arrow of document.querySelectorAll('.desktop-compliance-chevron')) {
    const icon=arrow.getBoundingClientRect(), button=arrow.closest('button')!.getBoundingClientRect();
    check(Math.abs(icon.top+icon.height/2-button.top-button.height/2)<1,'Agreement arrow is not vertically centered');
  }
  await click('隐私政策'); await until(()=>document.body.innerText.includes('我已阅读'));
  const reader=document.querySelector('.desktop-compliance-body') as HTMLElement;
  check(reader.getBoundingClientRect().bottom<window.innerHeight,'Reader exceeds viewport');
  await click('我已阅读'); await until(()=>!document.body.innerText.includes('我已阅读'));
  check(document.body.innerText.includes('用户协议'),'Settings links disappeared after reading');
  reports.push((dark?'dark':'light')+' settings agreement dialog and acknowledgement');

  recording(dark); await until(()=>document.body.innerText.includes('C:/Users/Player/Videos/MCTier'));
  check(!document.body.innerText.includes('录像已保存'),'Saved panel still present');
  const hint=document.querySelector('.record-panel-hint') as HTMLElement;
  check(parseFloat(getComputedStyle(hint).fontSize)===11,'Hint font size');
  const rect=hint.getBoundingClientRect(); check(rect.height<20,'Chinese hint wraps at narrow panel width');
  check(document.querySelector('.record-location')!.scrollWidth<=380,'Folder controls overflow');
  await click('修改'); await until(()=>document.body.innerText.includes('D:/Clips'));
  root.render(<div/>); await wait(100); recording(dark); await until(()=>document.body.innerText.includes('D:/Clips'));
  await click('恢复默认'); await until(()=>document.body.innerText.includes('C:/Users/Player/Videos/MCTier'));
  reports.push((dark?'dark':'light')+' recording layout, folder change/persistence/reset');
 }
 await invoke('recording_check_report',{report:{ok:true,reports}});
})().catch(async error=>{await invoke('recording_check_report',{report:{ok:false,error:String(error),reports}});});
