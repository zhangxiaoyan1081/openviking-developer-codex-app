export const escapeHTML=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc=escapeHTML;
const ROOTS=['viking://user/default/resources','viking://user/default/memories','viking://user/default/peers'];
export function entries(result,uri){
 const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
 return {text,items:text.split('\n').map(x=>x.match(/^\[(dir|file)\] (.+)$/)).filter(Boolean).map(x=>({dir:x[1]==='dir',name:x[2].replace(/\/$/,''),uri:uri+'/'+x[2].replace(/\/$/,'')}))};
}
export function createUI({call,send,expand,panel=false}){
 let state={},page='progress',scopeMode=null,uri=ROOTS[0],revision=0,busy=false;
 const $=s=>document.querySelector(s),main=$('#main'),notice=$('#notice');
 const message=text=>{notice.textContent=text;};
 async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);message('');try{await fn();}catch(e){message(e.message||'操作未完成，请重试。');}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function notify(text){
  if(!send){message('请在对话中告诉 Codex 要生成的报告。');return;}
  try{await send(text);message('已交给 Codex，请在对话中继续。');}
  catch{message('选择已保留。当前无法发送，请在对话中说“继续 OpenViking”。');}
 }
 function nav(){return `<nav class="tabs" aria-label="工作台">${[['progress','工作进展'],['files','目录'],['reports','报告与洞察']].map(([id,label])=>`<button data-page="${id}" class="${page===id?'active':''}">${label}</button>`).join('')}</nav>`;}
 function onboarding(){
  revision++;$('#header-actions').innerHTML='<span class="pill">开始使用</span>';
  if(!state.configured){main.innerHTML='<h1>连接 OpenViking</h1><p class="muted">将控制台的接入指令发给 Codex。</p>';return;}
  if(state.plan){const p=state.plan;main.innerHTML=`<h1>${p.confirmed?'已确认同步范围':'带入这些工作？'}</h1><p class="muted">${esc(p.coverage)}</p><div class="review">${p.items.map(x=>`<article><strong>${esc(x.title)}</strong><div class="muted">${esc(x.project||'未归入项目')} · ${x.reuse?'复用已有记录':`${x.messages} 条消息`}</div></article>`).join('')}</div><div class="row spaced"><span class="muted">共 ${p.items.length} 个会话</span><div class="row"><button data-action="reset">调整范围</button><button class="primary" data-action="confirm">${p.confirmed?'继续同步':'确认同步'}</button></div></div>`;return;}
  if(scopeMode){main.innerHTML=`<h1>${scopeMode==='recent'?'带入近期工作':scopeMode==='projects'?'带入哪些项目？':'想带入哪些工作？'}</h1><div class="field">${scopeMode==='recent'?'<label for="days">时间范围</label><select id="days"><option value="7">最近 7 天</option><option value="30" selected>最近 1 个月</option><option value="90">最近 3 个月</option></select>':`<label for="scope-text">${scopeMode==='projects'?'项目名称，可填写多个':'同步范围'}</label><textarea id="scope-text" placeholder="${scopeMode==='projects'?'例如：OpenViking、网站改版':'例如：近三个月的产品调研，不含客户支持'}"></textarea>`}</div><div class="actions"><button data-action="back">返回</button><button data-action="select" class="primary">继续</button></div>`;return;}
  main.innerHTML='<h1>带上过去的工作</h1><p class="muted">选择范围，Codex 会先为你整理清单。</p><div class="choices"><button class="choice" data-scope="recent"><strong>近期全部工作</strong><span>7 天、1 个月、3 个月</span></button><button class="choice" data-scope="projects"><strong>选择项目</strong><span>一个或多个项目</span></button><button class="choice" data-scope="description"><strong>描述范围</strong><span>用自己的话说</span></button></div><button class="quiet" data-action="skip">从现在开始 →</button>';
 }
 function sources(items){return items.map(s=>`<button class="source" data-file="${esc(s.uri)}">↗ ${esc(s.label)}</button>`).join('');}
 function workspace(){
  revision++;$('#header-actions').innerHTML=`<button class="quiet" data-action="refresh" aria-label="刷新">刷新</button>${panel?'':'<button class="quiet" data-action="expand">展开</button><button class="quiet" data-action="panel">侧边栏 ↗</button>'}`;
  if(page==='files'){directory();return;}
  if(page==='reports'){reports();return;}
  main.innerHTML=nav()+`<div class="row spaced"><h1>工作进展</h1>${panel?'':'<button data-action="update">更新进展</button>'}</div><div class="cards">${(state.workspace?.works||[]).map((w,i)=>`<article class="card"><div class="tag">${esc(w.project||'我的工作')}</div><h2>${esc(w.title)}</h2><p>${esc(w.state)}</p><p class="muted">${esc(w.coverage||'')}</p><footer>${panel?'':`<button data-work="${i}" class="primary">继续这项工作</button>`}<span class="muted">${esc(w.next)}</span></footer>${sources(w.sources||[])}</article>`).join('')}</div>${state.workspace?.works?.length?'':'<p class="empty">还没有工作进展。在对话中同步已有工作，或开始一项新任务。</p>'}`;
 }
 function reports(){
  const all=state.reports||[];
  main.innerHTML=nav()+`<h1>报告与洞察</h1>${panel?'<p class="muted">在对话中告诉 Codex，即可生成新报告。</p>':'<div class="report-controls"><select id="kind" aria-label="报告类型"><option value="daily">日报</option><option value="weekly">周报</option><option value="progress">工作进展</option><option value="insight">知识洞察</option></select><select id="period" aria-label="时间范围"><option selected>今天</option><option>昨天</option><option>最近 7 天</option><option>最近 30 天</option></select></div><button class="primary" data-action="generate">生成报告</button>'}<div class="stack" style="margin-top:24px">${all.map((r,i)=>`<button class="card" style="text-align:left" data-report="${i}"><div class="tag">${esc(r.period)}</div><h2>${esc(r.title)}</h2><span class="muted">${esc(r.coverage)}</span></button>`).join('')||'<p class="empty">生成的报告会保存在这里。</p>'}</div>`;
 }
 async function directory(){
  const generation=++revision;const root=ROOTS.find(x=>uri===x||uri.startsWith(x+'/'))||ROOTS[0];const segments=uri.slice(root.length).split('/').filter(Boolean);
  main.innerHTML=nav()+`<h1>目录</h1><div class="row">${ROOTS.map((u,i)=>`<button data-dir="${u}" aria-pressed="${u===root}">${['资料','记忆','项目上下文'][i]}</button>`).join('')}</div><div class="path"><button data-dir="${root}">${['资料','记忆','项目上下文'][ROOTS.indexOf(root)]}</button>${segments.map((x,i)=>`<span>/</span><button data-dir="${esc(root+'/'+segments.slice(0,i+1).join('/'))}">${esc(x)}</button>`).join('')}</div><div class="directory"><div class="listing" id="listing">正在读取…</div><section class="preview" id="preview"><p class="muted">选择文件查看内容。</p></section></div>`;
  try{const result=entries(await call('list_directory',{uri}),uri);if(generation!==revision)return;$('#listing').innerHTML=result.items.map(x=>`<button class="entry" data-${x.dir?'dir':'file'}="${esc(x.uri)}">${x.dir?'▸':'·'} ${esc(x.name)}</button>`).join('')||`<p class="muted">${esc(result.text||'目录为空。')}</p>`;}catch(e){if(generation===revision)$('#listing').textContent=e.message;}
 }
 async function read(target,offset=0){
  const parent=target.slice(0,target.lastIndexOf('/'));
  if(page!=='files'||!$('#preview')||uri!==parent){uri=parent;page='files';await directory();}
  const generation=++revision;$('#preview').innerHTML='<p class="muted">正在读取…</p>';
  try{const r=await call('read_file',{uri:target,offset});if(generation!==revision)return;const text=(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');$('#preview').innerHTML=`<h2>${esc(target.split('/').pop())}</h2><pre>${esc(text||'没有更多内容。')}</pre>${text?`<button data-more="${esc(target)}" data-offset="${offset+200}">继续读取</button>`:''}`;}catch(e){if(generation===revision)$('#preview').textContent=e.message;}
 }
 async function refresh(view){const result=await call('get_state',{});state={...state,...result,view:view||state.view};if(state.view==='onboarding')onboarding();else workspace();}
 document.addEventListener('change',event=>{if(event.target.id==='kind'&&$('#period'))$('#period').value=event.target.value==='daily'?'今天':'最近 7 天';});
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
  if(d.scope){scopeMode=d.scope;onboarding();return;}
  if(d.page){page=d.page;workspace();return;}
  if(d.dir){uri=d.dir;page='files';workspace();return;}
  if(d.file){run(()=>read(d.file));return;}
  if(d.more){run(()=>read(d.more,Number(d.offset)));return;}
  if(d.report!==undefined){const r=state.reports[Number(d.report)];main.innerHTML=nav()+`<h1>${esc(r.title)}</h1><p class="muted">${esc(r.period)} · ${esc(r.coverage)}</p><article class="report-body">${esc(r.body)}</article><hr>${sources(r.sources)}`;return;}
  run(async()=>{
   if(d.work!==undefined){const w=state.workspace.works[Number(d.work)];await notify(`使用 openviking-codex-app 接续「${w.title}」。下一步：${w.next}。先读取这些来源核对最新状态：${w.sources.map(x=>x.uri).join('、')}`);}
   if(d.action==='reload'){location.reload();return;}
   if(d.action==='back'){scopeMode=null;onboarding();}
   if(d.action==='reset'){state.plan=null;scopeMode=null;onboarding();}
   if(d.action==='select'||d.action==='skip'){
    const args=d.action==='skip'?{mode:'skip'}:scopeMode==='recent'?{mode:'recent',days:Number($('#days').value)}:{mode:scopeMode,text:$('#scope-text').value.trim()};
    if(['projects','description'].includes(args.mode)&&!args.text)throw Error('请填写同步范围。');
    await call('select_scope',args);
    await notify(args.mode==='skip'?'使用 openviking-codex-app，从现在开始，不导入历史。问我想开始什么工作。':'使用 openviking-codex-app，读取 get_state 中我刚选择的范围，准备可访问的历史清单，调用 review_import 给我确认。先不要上传。');
   }
   if(d.action==='confirm'){await call('confirm_import',{hash:state.plan.hash});await notify(`使用 openviking-codex-app，我已在卡片确认计划 ${state.plan.hash}。核对 get_state 的 confirmed 与当前文件 hash 一致后，执行同步、collect Working Memory 并更新工作进展。`);}
   if(d.action==='generate'){const labels={daily:'日报',weekly:'周报',progress:'工作进展',insight:'知识洞察'};await notify(`使用 openviking-codex-app，基于 OpenViking 里「${$('#period').value}」的实际工作生成${labels[$('#kind').value]}。读取原文，注明时间范围与缺口，归档读回后 publish_report，并 show_workspace 展示结果。`);}
   if(d.action==='update')await notify('使用 openviking-codex-app，读取所选工作相关 Session 的最新 Working Memory 和资料，核对实际进展后更新工作卡片，并 show_workspace。');
   if(d.action==='panel')await notify('请调用 open_workspace_panel，并用 open_in_codex 在右侧打开返回的工作台 URL。');
   if(d.action==='refresh')await refresh();
   if(d.action==='expand'){if(expand)await expand();}
  });
 });
 return {render(value){scopeMode=null;state={...state,...value};if(value.view==='onboarding')onboarding();else workspace();},error:message,fail(text){revision++;$('#header-actions').innerHTML='';message('');main.innerHTML=`<h1>卡片暂时无法显示</h1><p class="muted">${esc(text)}</p><button data-action="reload">重新加载</button>`;}};
}
