import {markdown} from './explorer.mjs';
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>{if(!value)return '时间未知';const d=new Date(value);return Number.isNaN(d.getTime())?'时间未知':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};
export function createProgress({host,call,send}){
 let disposed=false,timer,debounce,revision=0,offset=0,query='',data,expanded=new Set(),bodies=new Map(),pending=new Set();
 const $=s=>host.querySelector(s);
 const labels={pending:'正在读取',no_archive:'尚未生成归档概览',no_overview:'最新归档暂无概览',unavailable:'概览暂时无法读取'};
 function cards(){
  if(disposed||!data)return;
  $('#progress-status').textContent=data.status==='running'?`正在更新 · ${data.done} / ${data.total??'…'} 个会话`:`${data.total??data.matched} 个会话${data.unavailable?` · ${data.unavailable} 个暂时无法读取`:''}`;
  $('#progress-list').innerHTML=data.items.map(x=>`<article class="session-card" data-session="${esc(x.id)}"><div class="session-head"><h2>${esc(x.title)}</h2><span class="muted">上次抽取记忆 <time datetime="${esc(x.updatedAt||'')}">${x.overviewUri?date(x.updatedAt):'暂无'}</time></span></div><p class="session-state">${esc(x.state||labels[x.status]||'概览中未提供当前状态')}</p><div class="session-actions">${x.overviewUri?`<button data-overview="${esc(x.id)}" aria-expanded="${expanded.has(x.id)}">${expanded.has(x.id)?'收起概览':'展开概览'}</button>${send?`<button data-resume="${esc(x.id)}">回顾进展，选择下一步</button>`:`<button data-copy-resume="${esc(x.id)}">复制接续指令</button>`}`:''}</div>${expanded.has(x.id)?`<div class="session-overview">${pending.has(x.id)?'<p class="muted">正在读取概览…</p>':bodies.get(x.id)?.error?`<p role="alert">${esc(bodies.get(x.id).error)}</p><button data-retry-overview="${esc(x.id)}">重试</button>`:`<article class="markdown-body">${markdown((bodies.get(x.id)?.overview||'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,''))}</article>`}</div>`:''}</article>`).join('')||`<p class="empty">${data.status==='running'?'正在读取会话概览…':query?'没有匹配的工作':'还没有会话进展。与 Codex 协作并保存到 OpenViking 后，会在这里展示。'}</p>`;
  host.querySelectorAll('.markdown-body a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
  $('#progress-pages').innerHTML=`<button data-prev ${offset===0?'disabled':''}>上一页</button><span class="muted">${Math.floor(offset/20)+1} / ${Math.max(1,Math.ceil(data.matched/20))}</span><button data-next ${offset+20>=data.matched?'disabled':''}>下一页</button>`;
  $('#progress-error').textContent=data.error||'';
 }
 async function load(refresh=false){
  clearTimeout(timer);const gen=++revision;
  try{const r=await call('get_session_progress',{offset,query,refresh});if(disposed||gen!==revision)return;data=r;cards();if(r.status==='running')timer=setTimeout(()=>load(),2500);}
  catch(e){if(!disposed&&gen===revision)$('#progress-error').textContent=e.message||'读取未完成，请刷新重试。';}
 }
 async function detail(item){
  pending.add(item.id);cards();
  try{const body=await call('read_session_overview',{uri:item.overviewUri});if(!disposed)bodies.set(item.id,body);}
  catch(e){if(!disposed)bodies.set(item.id,{error:e.message});}
  finally{pending.delete(item.id);cards();}
 }
 const prompt=x=>`使用 openviking-codex-app 回顾这项工作。先读取 ${x.overviewUri}，核对是否有更新的归档概览，总结目标、当前进展和待解决事项，并建议几个推进方向。等待我的下一条指令后再执行，不自动修改文件或开始任务。`;
 host.innerHTML='<h1>工作进展</h1><p class="progress-description">基于 OpenViking 内的所有 Session 信息，展示你当前的工作进展。</p><div class="progress-controls"><input type="search" aria-label="搜索工作进展" placeholder="搜索标题或进展"><button data-refresh-progress>刷新</button></div><p class="muted" id="progress-status" role="status">正在读取…</p><p id="progress-error" role="alert"></p><div id="progress-list" class="session-list"></div><div id="progress-pages" class="progress-pages"></div><p id="resume-message" role="status" class="muted"></p>';
 host.addEventListener('input',e=>{if(e.target.type==='search'){query=e.target.value;offset=0;clearTimeout(debounce);debounce=setTimeout(()=>load(),250);}});
 host.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;e.stopPropagation();const d=b.dataset;
  if('refreshProgress'in d){offset=0;bodies.clear();await load(true);}
  if('prev'in d||'next'in d){offset=Math.max(0,offset+('next'in d?20:-20));expanded.clear();await load();host.scrollIntoView({block:'start'});}
  const id=d.overview||d.retryOverview||d.resume||d.copyResume,item=data?.items.find(x=>x.id===id);if(!item)return;
  if(d.overview){if(expanded.has(id)){expanded.delete(id);cards();}else{expanded.add(id);if(!bodies.has(id))await detail(item);else cards();}}
  if(d.retryOverview)await detail(item);
  if(d.resume){try{await send(prompt(item));$('#resume-message').textContent='已交给 Codex，请在对话中继续。';}catch{$('#resume-message').textContent='发送未完成，请重试。';}}
  if(d.copyResume){try{await navigator.clipboard.writeText(prompt(item));$('#resume-message').textContent='已复制，粘贴到 Codex 对话即可。';}catch{$('#resume-message').textContent='请复制以下指令：'+prompt(item);}}
 });
 return {mount(){return load(true);},dispose(){disposed=true;revision++;clearTimeout(timer);clearTimeout(debounce);}};
}
