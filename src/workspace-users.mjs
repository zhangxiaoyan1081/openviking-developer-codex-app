import {createUI,escapeHTML as esc} from './ui.mjs';
export const bindingPrompt='使用 openviking-codex-app 新增 OpenViking 用户绑定。保留已有绑定，先检查是否已有保存但未完成的新用户接入；有则继续，无则开始新增绑定。验证并保存新身份后，检查 Hooks，向我说明并确认记忆和长期协作方式，再选择是否导入历史；不要复用旧用户的接入确认或自动上传。完成后告诉我如何在工作台切换用户。';

// Both the global MCP App and loopback workspace share this controller.
export function createWorkspace({transport,sendNew}){
 let state,ui,busy=false,generation=0,sequence=0;
 const box=document.createElement('section');box.className='workspace-users';box.setAttribute('aria-label','OpenViking 用户');
 document.querySelector('header').after(box);
 function controls(){
  const rows=state?.boundUsers||[],active=rows.find(r=>r.active),id=state?.identity;
  const label=active?`${active.serviceName} · ${active.user}`:id?.user||'尚未连接';
  box.innerHTML=`<details><summary aria-label="切换 OpenViking 用户">${esc(label)} <span aria-hidden="true">⌄</span></summary><div class="user-menu">${rows.map(r=>`<button data-user="${esc(r.name)}" ${r.active?'disabled':''}><strong>${esc(r.serviceName)} · ${esc(r.user)}</strong><small>Account: ${esc(r.account)}${r.databaseId?` · 库: ${esc(r.databaseId)}`:''}${rows.filter(x=>x.serviceName===r.serviceName&&x.user===r.user).length>1?` · ${esc(r.name)}`:''}${r.active?' · 当前用户':''}</small></button>`).join('')}<button data-add-user>＋ 新增用户</button></div></details><p class="user-status" role="status"></p>`;
 }
 const status=text=>{box.querySelector('.user-status').textContent=text;};
 function accept(next){
  if(state?.connection?.revision!==next.connection?.revision)generation++;
  state=next;controls();return next;
 }
 async function call(name,args={}){
  if(name==='get_workspace_state'){
   const serial=++sequence,next=await transport(name,args);
   if(serial!==sequence)throw Error('连接已变化，请刷新工作台。');
   return accept(next);
  }
  const current=generation,revision=state?.connection?.revision;
  const result=await transport('workspace_read',{revision,tool:name,arguments:args});
  if(current!==generation)throw Error('连接已变化，请刷新工作台。');
  return result;
 }
 ui=createUI({call,panel:true,initialPage:'files',stateTool:'get_workspace_state',failureTitle:'工作台暂时无法显示'});
 async function refresh(onlyChanges=false){
  if(busy)return;
  const before=JSON.stringify(state);const next=await call('get_workspace_state');
  if(!onlyChanges||before!==JSON.stringify(next))ui.render({...next,view:'workspace'});
 }
 function handoff(){
  box.querySelector('details').open=false;
  const dialog=document.createElement('dialog');dialog.className='user-dialog';
  dialog.innerHTML=`<h2>新增 OpenViking 用户</h2><p>在新对话中验证 API Key，确认记忆、协作方式和历史导入。已有绑定会保留。</p><div class="actions">${sendNew?'<button class="primary" data-start-binding>在新对话中接入</button>':''}<button data-copy-binding>${sendNew?'复制接入指令':'复制指令，在 Codex 新对话中接入'}</button><button data-close>取消</button></div><p role="status"></p>`;
  document.body.append(dialog);dialog.showModal();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.addEventListener('click',async e=>{
   e.stopPropagation();const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-close')){dialog.close();return;}
   b.disabled=true;
   try{
    if(b.hasAttribute('data-copy-binding')){
     try{await navigator.clipboard.writeText(bindingPrompt);dialog.querySelector('[role=status]').textContent='已复制，请粘贴到 Codex 新对话。';}
     catch{const text=document.createElement('textarea');text.readOnly=true;text.value=bindingPrompt;text.setAttribute('aria-label','接入指令');dialog.append(text);text.select();dialog.querySelector('[role=status]').textContent='复制以下指令，粘贴到 Codex 新对话。';}
    }else{await sendNew(bindingPrompt);dialog.close();status('已打开接入对话。完成后返回此页即可查看新用户。');}
   }catch{dialog.querySelector('[role=status]').textContent='未能打开新对话，请复制接入指令。';}
   finally{b.disabled=false;}
  });
 }
 box.addEventListener('click',async e=>{
  e.stopPropagation();const b=e.target.closest('button');if(!b||busy)return;
  if(b.hasAttribute('data-add-user')){handoff();return;}
  if(!b.hasAttribute('data-user'))return;
  const target=b.dataset.user;if(state.boundUsers?.some(r=>r.name===target&&r.active))return;busy=true;sequence++;
  box.querySelectorAll('button').forEach(x=>x.disabled=true);status('正在验证并切换…');
  try{
   const next=await transport('workspace_switch_user',{revision:state.connection.revision,profile_name:target});
   accept(next);ui.render({...next,view:'workspace'});
   status('已切换。新对话使用此用户，已有对话保持原连接。');
  }catch(e){controls();status(e.message||'切换未完成，请重试。');}
  finally{busy=false;}
 });
 // Conversation onboarding can add/switch a binding while the workspace is open.
 const resume=()=>{if(!document.hidden)refresh(true).catch(e=>status(e.message));};
 window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
 return {start:()=>refresh(),fail:ui.fail};
}
