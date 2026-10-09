import {createProgress} from './progress.mjs';
import {createExplorer,ROOT} from './explorer.mjs';
export const escapeHTML=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc=escapeHTML;

export function entries(result,uri){
 const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
 return {text,items:text.split('\n').map(x=>x.match(/^\[(dir|file)\] (.+)$/)).filter(Boolean).map(x=>({dir:x[1]==='dir',name:x[2].replace(/\/$/,''),uri:uri+'/'+x[2].replace(/\/$/,'')}))};
}
export function createUI({call,send,expand,panel=false,initialPage='progress',stateTool='get_state',failureTitle='卡片暂时无法显示'}){
 let state={},page=initialPage,scopeMode=null,keyEntry=false,choosingScope=false,entryConnection=false,uri=ROOT,revision=0,busy=false,pollTimer,pollCount=0,pollGeneration=0,summaryCard=false,explorer,sessionProgress;
 const $=s=>document.querySelector(s),main=$('#main'),notice=$('#notice');
 const message=text=>{notice.textContent=text;};
 async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);message('');try{await fn();}catch(e){message(e.message||'操作未完成，请重试。');}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function notify(text){
  if(!send){message('请在对话中告诉 Codex 要生成的报告。');return;}
  try{await send(text);message('已交给 Codex，请在对话中继续。');}
  catch{message('选择已保留。当前无法发送，请在对话中说“继续 OpenViking”。');}
 }
 function nav(){return `<nav class="tabs" aria-label="工作台">${[['files','目录'],['progress','工作进展'],['reports','报告与洞察']].map(([id,label])=>`<button data-page="${id}" class="${page===id?'active':''}">${label}</button>`).join('')}</nav>`;}
 function userTable(){
  const rows=state.boundUsers||[];
  return `<section><h2>已绑定的 OpenViking 用户</h2>${rows.length?`<div style="overflow:auto"><table><thead><tr><th>服务展示名</th><th>User ID</th><th>库 ID（如可用）</th><th>当前连接</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.serviceName||r.name)}${rows.filter(x=>(x.serviceName||x.name)===(r.serviceName||r.name)).length>1?`<div class="muted">${esc(r.name)}</div>`:""}</td><td><code>${esc(r.user)}</code><div class="muted">Account: ${esc(r.account)}</div></td><td><code>${esc(r.databaseId||'—')}</code>${r.databaseIdSource==='user'?'<small>（控制台填写）</small>':''}</td><td>${r.active?'当前使用':'已绑定'}</td></tr>`).join('')}</tbody></table></div>`:'<p>尚无绑定。</p>'}<p class="muted">记住你的 User ID。下次直接说“切换 OpenViking user 为 XX”。</p></section>`;
 }
 function users(){
  $('#header-actions').innerHTML='<button data-action="refresh">刷新</button>';
  main.innerHTML=`<h1>${state.status==='switched'?'用户已切换':'OpenViking 用户'}</h1>${state.message?`<p>${esc(state.message)}</p>`:''}${userTable()}${state.newTaskRequired?'<p>新开一个任务使用该用户；旧任务继续固定原连接。</p>':''}<button data-action="new-binding">新增用户绑定</button>`;
 }
 function binding(){
  const b=state.binding;if(!b||!['setup','install','connection','activate'].includes(b.phase))return false;
  $('#header-actions').innerHTML='<button data-action="refresh">刷新</button>';
  if(b.phase==='setup')main.innerHTML='<h1>绑定新的 OpenViking 用户</h1><p>保留已有用户，为新用户重新设置协作方式。</p><div class="choices"><button data-binding-setup="reuse"><strong>使用已安装插件</strong><span>直接继续绑定</span></button><button data-binding-setup="update"><strong>更新插件 App</strong><span>更新后继续绑定</span></button><button data-binding-setup="reinstall"><strong>重新安装插件 App</strong><span>修复安装后继续绑定</span></button></div>';
  if(b.phase==='install')main.innerHTML='<h1>正在准备插件</h1><p>完成所选安装操作后，继续绑定新用户。</p><button data-action="continue-install">继续</button>';
  if(b.phase==='activate')main.innerHTML='<h1>新用户绑定已保存</h1><p>无需再次输入 API Key，继续启用该用户。</p><button class="primary" data-action="activate-binding">使用此用户</button>';
  if(b.phase==='connection')main.innerHTML='<h1>连接新的 OpenViking 用户</h1><p>已有用户保留。验证成功后使用新用户继续设置。</p><label for="binding-key">API Key</label><input id="binding-key" type="password" autocomplete="off" spellcheck="false"><label for="service-name">服务展示名（可选）</label><input id="service-name" maxlength="80" autocomplete="off" placeholder="例如：个人服务、公司研发"><details><summary>指定企业身份（可选）</summary><label for="binding-account">Account ID</label><input id="binding-account"><label for="binding-user">User ID</label><input id="binding-user"><p>留空时由 API Key 自动识别。</p></details><button class="primary" data-action="bind-user">验证并使用新用户</button>';
  return true;
 }
 function connect(){
  revision++;$('#header-actions').innerHTML=panel?'':'<button class="quiet" data-action="refresh">刷新</button>';
  const c=state.connection||{};
  if(panel){$('#header-actions').innerHTML='<button class="quiet" data-action="refresh">刷新</button>';main.innerHTML='<h1>连接 OpenViking</h1><p class="muted">在 Codex 对话中发送“接入 OpenViking”，完成后刷新此页。</p>';return;}
  if(c.blocked){main.innerHTML=`<h1>连接 OpenViking</h1><p class="muted">${esc(c.message||'请在 Codex 中检查连接配置。')}</p>`;return;}
  if(c.restartRequired){main.innerHTML='<h1>连接已更新</h1><p>新开一个 Codex 任务，发送“继续 OpenViking 接入”。</p>';return;}
  if(c.canReuse&&!keyEntry){main.innerHTML='<h1>连接 OpenViking</h1><p class="muted">检测到此设备已保存的火山连接。</p><div class="actions"><button class="primary" data-action="connect-existing">使用当前连接</button><button data-action="change-key">更换 API Key</button></div>';return;}
  main.innerHTML=`<h1>${c.hasKey?'更换 API Key':'连接 OpenViking'}</h1><p class="muted">${c.hasKey?'验证成功后，将更新此设备的 OpenViking 连接。':'填入火山控制台中的 API Key。'}</p><form id="connect-form"><label for="api-key">API Key</label><input id="api-key" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" placeholder="粘贴 API Key" required><details><summary>企业用户（可选）</summary><label for="account-id">Account</label><input id="account-id" autocomplete="off"><label for="user-id">User</label><input id="user-id" autocomplete="off"><p class="muted">留空时由 API Key 自动识别；填写时核对服务端身份。</p></details><div class="actions">${c.canReuse?'<button type="button" data-action="cancel-key">返回</button>':''}<button type="button" class="primary" data-action="connect-key">${c.hasKey?'更换并连接':'连接'}</button></div></form>`;
 }
 function onboarding(){
  if(binding())return;
  if(!state.connection?.ready||keyEntry){connect();return;}
  revision++;$('#header-actions').innerHTML='<span class="pill">连接已验证</span><button class="quiet" data-action="refresh">刷新</button><button class="quiet" data-action="change-key">更换连接</button>';
  const flow=choosingScope?{...state.onboarding,phase:'scope'}:state.onboarding;
  if(flow?.phase==='hooks'){memorySetup();return;}
  if(flow?.phase==='collaboration'){collaboration();return;}
  if(flow?.phase==='ready'){if(state.scope?.mode!=='skip'&&!summaryCard)importProgress(true);else ready();return;}
  if(flow?.phase==='import'){
   importProgress(false);return;
  }
  if(flow?.phase==='prepare'){main.innerHTML='<h1>正在整理可带入的工作</h1><p class="muted">清单准备好后，由你确认。</p><button data-action="prepare">继续整理</button>';return;}
  if(state.plan&&!choosingScope){const p=state.plan;main.innerHTML=`<h1>${p.confirmed?'已确认同步范围':'带入这些工作？'}</h1><p class="muted">${esc(p.coverage)}</p><div class="review">${p.items.map(x=>`<article><strong>${esc(x.title)}</strong><div class="muted">${esc(x.project||'未归入项目')} · ${x.reuse?'复用已有记录':`${x.messages} 条消息`}</div></article>`).join('')}</div><div class="row spaced"><span class="muted">共 ${p.items.length} 个会话</span><div class="row"><button data-action="reset">调整范围</button><button class="primary" data-action="confirm">${p.confirmed?'继续同步':'确认同步'}</button></div></div>`;return;}
  if(scopeMode){main.innerHTML=`<h1>${scopeMode==='recent'?'带入近期工作':scopeMode==='projects'?'带入哪些项目？':'想带入哪些工作？'}</h1><div class="field">${scopeMode==='recent'?'<label for="days">时间范围</label><select id="days"><option value="7">最近 7 天</option><option value="30" selected>最近 1 个月</option><option value="90">最近 3 个月</option></select>':`<label for="scope-text">${scopeMode==='projects'?'项目名称，可填写多个':'同步范围'}</label><textarea id="scope-text" placeholder="${scopeMode==='projects'?'例如：OpenViking、网站改版':'例如：近三个月的产品调研，不含客户支持'}"></textarea>`}</div><div class="actions"><button data-action="back">返回</button><button data-action="select" class="primary">继续</button></div>`;return;}
  main.innerHTML=`<h1>带上过去的工作</h1>${flow?.collaboration?.mode==='reuse'?`<details><summary>沿用已有协作方式。</summary>${(flow.collaboration.summary||[]).map(x=>`<p>${esc(x)}</p>`).join('')}<p class="muted">${flow.collaboration.scope==='global'?'适用于所有 Codex 项目':'适用于当前项目'}</p></details>`:''}<p class="muted">选择范围，Codex 会先为你整理清单。</p><div class="choices"><button class="choice" data-scope="recent"><strong>近期全部工作</strong><span>7 天、1 个月、3 个月</span></button><button class="choice" data-scope="projects"><strong>选择项目</strong><span>一个或多个项目</span></button><button class="choice" data-scope="description"><strong>描述范围</strong><span>用自己的话说</span></button></div><button class="quiet" data-action="skip">从现在开始 →</button><button class="quiet" data-action="settings">调整协作方式</button>`;
 }
 function memorySetup(){
  const m=state.onboarding.memory||{},c=m.check||{};
  const guidance=m.mode==='manual'&&!c.manualReady?'在 /hooks 中关闭 OpenViking Hooks，再检查。':c.message||'先检查官方记忆插件，再选择使用方式。';
  main.innerHTML=`<h1>怎样使用记忆</h1><div class="choices"><button class="choice" data-memory="automatic"><strong>自动记忆 · 推荐</strong><span>自动召回相关内容并保存对话</span></button><button class="choice" data-memory="manual"><strong>按需使用</strong><span>需要时检索，按约定保存资料</span></button></div>${m.mode?`<p>已选择：${m.mode==='automatic'?'自动记忆':'按需使用'}</p>`:''}<p class="muted">${esc(guidance)}</p><div class="actions"><button class="primary" data-action="check-memory">检查状态</button>${c.status==='absent'||c.status==='runtime'||c.status==='unknown'?'<button data-action="setup-memory">帮助设置</button>':''}</div>`;
 }
 function collaboration(){
  const r=state.onboarding.collaboration;
  if(['unreviewed','changed','adjusting'].includes(r.status)){main.innerHTML=`<h1>今后怎样协作</h1><p>先核对你的协作设置，再带入已有工作。</p><button class="primary" data-action="settings">${r.status==='changed'?'重新核对设置':'检查协作设置'}</button>`;return;}
  main.innerHTML=`<h1>今后这样协作</h1><div class="stack">${r.summary.map(x=>`<p>${esc(x)}</p>`).join('')}</div><p class="muted">${r.scope==='global'?'适用于所有 Codex 项目':'适用于当前项目'}</p>${r.status==='accepted'?'<p>正在保存协作设置…</p><button data-action="apply-rules">继续</button>':`<div class="actions"><button class="primary" data-rules="adopt">${r.mode==='reuse'?'沿用这个方式':'采用这个方式'}</button><button data-rules="adjust">调整</button></div>`}`;
 }
 function progress(){
  const job=state.onboarding?.import;if(!job)return '';
  const labels={pending:'整理中',running:'整理中',cancelling:'正在取消',completed:'记忆已整理',failed:'整理未完成',cancelled:'已取消',skipped:'无需重复整理',reused:'沿用已有内容',unknown:'状态待确认'};
  return `<div class="review" aria-live="polite">${job.items.map(x=>`<article><strong>${esc(x.title)}</strong><div class="muted">${x.verified?'已保存并核对':x.written?'已保存':'正在保存'} · ${labels[x.status]||'状态待确认'}</div></article>`).join('')}</div>`;
 }
 function importProgress(summaryReady){
  const job=state.onboarding?.import;
  const complete=job?.terminal&&job.items.every(x=>['completed','reused','skipped'].includes(x.status));
  main.innerHTML=`<h1>${complete?'同步已完成':summaryReady?'同步进度':'正在整理你的工作'}</h1>${progress()}${summaryReady?'':`<p class="muted">先恢复已保存的进展，记忆整理会继续进行。</p><button class="primary" data-action="restore">查看工作摘要</button>`}<button data-action="refresh">刷新</button>`;
 }
 function workCards(){return (state.workspace?.works||[]).map((w,i)=>`<article class="card"><div class="tag">${esc(w.project||'我的工作')}</div><h2>${esc(w.title)}</h2>${w.goal?`<p>${esc(w.goal)}</p>`:''}<strong>上次停在这里</strong><p>${esc(w.state)}</p>${w.decisions?`<p>已确定：${esc(w.decisions)}</p>`:''}${w.openIssues?`<p>待处理：${esc(w.openIssues)}</p>`:''}<strong>建议下一步</strong><p>${esc(w.next)}</p><p class="muted">${esc(w.coverage||'')}</p><footer>${panel?'':`<button data-work="${i}" class="primary">回顾这项工作</button><button data-correct="${i}">修正总结</button>`}</footer>${sources(w.sources||[])}</article>`).join('');}
 function ready(){
  const f=state.onboarding,skipped=state.scope?.mode==='skip';
  main.innerHTML=`<h1>${skipped?'从今天开始积累':'接着上次的工作做'}</h1>${skipped?`<div class="stack">${(f.collaboration.summary||[]).map(x=>`<p>${esc(x)}</p>`).join('')}</div><p class="muted">下次可以说“继续上次的工作”，也可以让我整理周报。</p>`:`<div class="cards">${workCards()}</div>`}<p class="muted">${f.memory?.mode==='manual'?'按需使用已开启，需要时让我检索或保存。':f.capabilities?.hooks==='verified'?'对话回流已验证。':'自动回流尚未验证，可先在对话中主动保存和读取。'}</p><div class="actions"><button class="${skipped?'primary':''}" data-next="start">开始一项工作</button><button data-next="save">保存一份资料</button><button data-next="later">稍后</button><button class="quiet" data-action="settings">调整协作方式</button></div>${f.choice==='later'?'<p class="muted">设置已保留，随时可以开始。</p>':''}${userTable()}`;
 }
 function sources(items){return items.map(s=>`<button class="source" data-file="${esc(s.uri)}">↗ ${esc(s.label)}</button>`).join('');}
 function workspace(){
  sessionProgress?.dispose();explorer?.dispose();
  if(!state.connection?.ready||keyEntry){connect();return;}
  revision++;$('#header-actions').innerHTML=`<button class="quiet" data-action="refresh" aria-label="刷新">刷新</button>${panel?'':'<button class="quiet" data-action="expand">展开</button><button class="quiet" data-action="panel">侧边栏 ↗</button>'}`;
  if(page==='files'){directory();return;}
  if(page==='reports'){reports();return;}
  sessionProgress?.dispose();main.innerHTML=nav()+'<section id="session-progress"></section>';sessionProgress=createProgress({host:$('#session-progress'),call,send:panel?undefined:send});sessionProgress.mount();
 }
 function reports(){
  const all=state.reports||[];
  main.innerHTML=nav()+`<h1>报告与洞察</h1>${panel?'<p class="muted">在对话中告诉 Codex，即可生成新报告。</p>':'<div class="report-controls"><select id="kind" aria-label="报告类型"><option value="daily">日报</option><option value="weekly">周报</option><option value="progress">工作进展</option><option value="insight">知识洞察</option></select><select id="period" aria-label="时间范围"><option selected>今天</option><option>昨天</option><option>最近 7 天</option><option>最近 30 天</option></select></div><button class="primary" data-action="generate">生成报告</button>'}<div class="stack" style="margin-top:24px">${all.map((r,i)=>`<button class="card" style="text-align:left" data-report="${i}"><div class="tag">${esc(r.period)}</div><h2>${esc(r.title)}</h2><span class="muted">${esc(r.coverage)}</span></button>`).join('')||'<p class="empty">生成的报告会保存在这里。</p>'}</div>`;
 }
 function directory(){
  explorer?.dispose();main.innerHTML=nav()+'<div id="explorer"></div>';
  explorer=createExplorer({host:$('#explorer'),call});return explorer.mount(uri);
 }
 async function read(target){
  if(page!=='files'||!$('#explorer')){page='files';await directory();}
  await explorer.open(target);
 }
 async function refresh(view){const result=await call(state.view==='users'?'list_bound_users':stateTool,{});state={...state,...result,view:view||state.view};if(state.view==='users')users();else if(state.view==='onboarding')onboarding();else workspace();schedulePoll();}
 function schedulePoll(){
  clearTimeout(pollTimer);
  if(panel||summaryCard||keyEntry||choosingScope||!state.connection?.ready||pollCount>=16)return;
  const flow=state.onboarding,job=flow?.import;
  if(!(job&&!job.terminal)&&!['prepare','import'].includes(flow?.phase)&&flow?.collaboration?.status!=='accepted')return;
  const generation=++pollGeneration;
  pollTimer=setTimeout(async()=>{
   if(generation!==pollGeneration)return;
   if(busy){schedulePoll();return;}
   const old=state;pollCount++;
   try{
    const value=await call(job&&!job.terminal?'import_status':'get_state',job&&!job.terminal?{jobId:job.jobId}:{});
    if(old!==state||generation!==pollGeneration)return;
    if(state.onboarding?.phase!==value.onboarding?.phase)message('');state={...state,...value};if(state.view==='onboarding')onboarding();else if(page==='progress')workspace();
   }catch{message('进度暂时无法更新，已保存的内容不受影响。');}
   schedulePoll();
  },[2000,5000,10000,30000][Math.min(pollCount,3)]);
 }
 window.addEventListener('pagehide',()=>{clearTimeout(pollTimer);pollGeneration++;});
 document.addEventListener('submit',event=>{if(event.target.id==='connect-form'){event.preventDefault();document.querySelector('[data-action="connect-key"]')?.click();}});
 document.addEventListener('change',event=>{if(event.target.id==='kind'&&$('#period'))$('#period').value=event.target.value==='daily'?'今天':'最近 7 天';});
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
  if(d.scope){scopeMode=d.scope;onboarding();return;}
  if(d.page){sessionProgress?.dispose();explorer?.dispose();page=d.page;workspace();return;}
  if(d.dir){uri=d.dir;page='files';workspace();return;}
  if(d.file){run(()=>read(d.file));return;}
  if(d.more){run(()=>read(d.more,Number(d.offset)));return;}
  if(d.report!==undefined){const r=state.reports[Number(d.report)];main.innerHTML=nav()+`<h1>${esc(r.title)}</h1><p class="muted">${esc(r.period)} · ${esc(r.coverage)}</p><article class="report-body">${esc(r.body)}</article><hr>${sources(r.sources)}`;return;}
  run(async()=>{
   if(d.action==='new-binding'){state={...await call('begin_user_binding',{}),view:'onboarding'};onboarding();return;}
   if(d.bindingSetup){state={...state,...await call('choose_binding_setup',{revision:state.binding.revision,mode:d.bindingSetup})};onboarding();if(d.bindingSetup!=='reuse')await notify(`使用 openviking-codex-app，已选择${d.bindingSetup==='update'?'更新':'重新安装'}插件 App。保留所有连接配置，完成实际安装并修复连接隔离组件后，调用 complete_binding_setup(revision=${state.binding.revision}) 继续绑定。不要覆盖 Key 或替我批准 Hooks。`);return;}
   if(d.action==='continue-install'){await notify(`使用 openviking-codex-app，继续已选择的插件安装操作，完成后 complete_binding_setup(revision=${state.binding.revision})。`);return;}
   if(d.action==='bind-user'||d.action==='activate-binding'){
    let args={revision:state.binding.revision};
    if(d.action==='bind-user'){args={...args,api_key:$('#binding-key').value.trim(),service_name:$('#service-name').value.trim()||undefined,account:$('#binding-account').value.trim()||undefined,user:$('#binding-user').value.trim()||undefined};if(!args.api_key)throw Error('请填写 API Key。');$('#binding-key').value='';}
    try{state={...state,...await call(d.action==='bind-user'?'bind_user':'activate_user_binding',args)};onboarding();await notify('OpenViking 新用户已绑定并启用。新任务加载该用户后，继续完整 onboarding：记忆方式、协作规则、历史范围、接续摘要；完成时展示所有绑定的 User ID、库 ID 和当前连接。旧任务不要继续向新库读写。');}
    catch(e){const text=e.message;state={...state,...await call('get_state',{})};onboarding();throw Error(text);}
    return;
   }
   if(d.memory){state={...state,...await call('choose_memory',{mode:d.memory})};onboarding();if(state.onboarding.memory.ready)await notify('使用 openviking-codex-app，按已选记忆方式准备长期协作方案；自动记忆优先使用 Hook 召回，不足时才补查，不重复提交对话。');}
   if(d.action==='check-memory'&&!state.onboarding.memory?.check?.status){await notify('使用 openviking-codex-app，用实际项目 cwd 调用 check_memory，再展示记忆方式。');return;}
   if(d.action==='check-memory'){state={...state,...await call('check_memory',{})};onboarding();if(state.onboarding.memory.ready)await notify('使用 openviking-codex-app，记忆设置已核对，按已选方式 prepare_collaboration 展示长期协作方案，等待我确认。');else if(state.onboarding.memory.check.status==='unknown')await notify('使用 openviking-codex-app，用实际项目 cwd 调用 check_memory，核对官方插件与 Hooks 后继续接入。');}
   if(d.action==='setup-memory')await notify('使用 openviking-codex-app，检查官方记忆插件。已有安装必须复用；仅未安装时执行 install.py --official-only。检查桌面 Node 路径，引导我在 /hooks 中启用并信任，再 check_memory；不要代替我批准 Hooks。');
   if(d.work!==undefined){const w=state.workspace.works[Number(d.work)];if(state.onboarding?.phase==='ready')await call('choose_next',{choice:'continue'});await notify(`使用 openviking-codex-app 回顾「${w.title}」。先读取这些来源核对最新状态：${w.sources.map(x=>x.uri).join('、')}。只总结目标、已完成、当前进展和待解决事项，并建议几个推进方向供我选择。历史建议仅供参考：${w.next}。等待我的下一条指令，不执行任务、不修改文件、不创建新任务。`);}
   if(d.correct!==undefined){const w=state.workspace.works[Number(d.correct)];await notify(`修正「${w.title}」的工作摘要，请问我哪里需要调整。`);}
   if(d.rules){state={...state,...await call('choose_collaboration',{revision:state.onboarding.collaboration.revision,choice:d.rules})};onboarding();if(state.onboarding.collaboration.status!=='active')await notify(d.rules==='adopt'?'使用 openviking-codex-app，按已确认 revision 执行 onboarding.py apply_rules，读回核对，再继续选择历史范围。':'使用 openviking-codex-app，调整已展示的协作方式，先问我需要改变什么。');schedulePoll();}
   if(d.next){state={...state,...await call('choose_next',{choice:d.next})};ready();await notify(d.next==='later'?'OpenViking 设置先保留，我稍后开始。不要上传其他历史或创建新任务。':d.next==='save'?'使用 openviking-codex-app，帮我保存一份资料，先问我要保存的内容。':'使用 openviking-codex-app，从现在开始一项工作，问我这次的目标，按已确认协作方式使用 OpenViking。');}
   if(d.action==='settings')await notify('使用 openviking-codex-app，读取实际生效的 AGENTS.md 与已有授权，prepare_collaboration 准备协作方式。已有规则也先展示行为摘要和作用范围，让我选择沿用或调整；新增或变更先确认，再继续 onboarding。');
   if(d.action==='apply-rules')await notify('使用 openviking-codex-app，完成已确认协作规则的保存与读回，然后继续 onboarding。');
   if(d.action==='restore')await notify('使用 openviking-codex-app，继续已确认的导入；读取可用概览或已核对的原文，恢复工作摘要、publish_work(onboarding=true) 直接展示摘要。不要等待全部抽取结束，也不要重复上传。');
   if(d.action==='prepare')await notify('使用 openviking-codex-app，按 get_state 已选范围准备可访问历史清单，review_import 展示，先不要上传。');
   if(d.action==='change-key'){keyEntry=true;connect();return;}
   if(d.action==='cancel-key'){keyEntry=false;if(state.view==='onboarding')onboarding();else workspace();return;}
   if(d.action==='connect-existing'||d.action==='connect-key'){
    const args={revision:state.connection.revision};
    if(d.action==='connect-key'){args.api_key=$('#api-key').value.trim();args.account=$('#account-id')?.value.trim()||undefined;args.user=$('#user-id')?.value.trim()||undefined;if(!args.api_key)throw Error('请填写 API Key。');$('#api-key').value='';}
    message('正在验证连接…');
    const result=await call(d.action==='connect-key'?'connect_key':'connect_existing',args);
    state={...state,...result};keyEntry=false;choosingScope=entryConnection&&state.connection?.ready&&state.onboarding?.collaboration?.status==='active';entryConnection=false;message('');if(state.view==='onboarding')onboarding();else workspace();
    if(state.view==='onboarding'&&state.connection?.ready&&['hooks','collaboration'].includes(state.onboarding?.phase))await notify('使用 openviking-codex-app，连接已验证，先用实际项目 cwd 调用 check_memory，再 show_onboarding 让我选择记忆方式；完成 Hook 设置后再准备长期协作方案。');
    return;
   }
   if(d.action==='reload'){location.reload();return;}
   if(d.action==='back'){scopeMode=null;onboarding();}
   if(d.action==='reset'){choosingScope=true;state.plan=null;scopeMode=null;onboarding();}
   if(d.action==='select'||d.action==='skip'){
    const args=d.action==='skip'?{mode:'skip'}:scopeMode==='recent'?{mode:'recent',days:Number($('#days').value)}:{mode:scopeMode,text:$('#scope-text').value.trim()};
    if(['projects','description'].includes(args.mode)&&!args.text)throw Error('请填写同步范围。');
    state={...state,...await call('select_scope',args)};choosingScope=false;onboarding();schedulePoll();
    await notify(args.mode==='skip'?'使用 openviking-codex-app，不导入历史。继续说明已确认的协作方式、实际能力和后续使用预期，show_onboarding 展示开始工作、保存资料、稍后。不要直接结束，也不要索要第二次继续指令。':'使用 openviking-codex-app，读取 get_state 中我刚选择的范围，准备可访问的历史清单，调用 review_import 给我确认。先不要上传。');
   }
   if(d.action==='confirm'){const hash=state.plan.hash;await call('confirm_import',{hash});await refresh();await notify(`使用 openviking-codex-app，我已在卡片确认计划 ${hash}。核对 get_state 后同步、读回核对、短暂检查抽取状态。用可用概览或已核对原文恢复摘要，publish_work(onboarding=true) 展示摘要并引导下一步。抽取未完成也不要停在导入结果；不要重复上传。`);}
   if(d.action==='generate'){const labels={daily:'日报',weekly:'周报',progress:'工作进展',insight:'知识洞察'};await notify(`使用 openviking-codex-app，基于 OpenViking 里「${$('#period').value}」的实际工作生成${labels[$('#kind').value]}。读取原文，注明时间范围与缺口，归档读回后 publish_report 直接展示结果。`);}
   if(d.action==='update')await notify('使用 openviking-codex-app，读取所选工作相关 Session 的最新 Working Memory 和资料，核对实际进展后更新工作卡片，然后打开侧边工作台。');
   if(d.action==='panel')await notify('请调用 open_workspace_panel，并用 open_in_codex 在右侧打开返回的工作台 URL。');
   if(d.action==='refresh'){pollCount=0;await refresh();}
   if(d.action==='expand'){if(expand)await expand();}
  });
 });
 return {render(value){message('');scopeMode=null;choosingScope=false;entryConnection=value.entry==='connection';summaryCard=value.view==='onboarding'&&value.onboarding?.phase==='ready';pollCount=0;pollGeneration++;state={...state,...value};if(value.view==='users')users();else if(value.view==='onboarding')onboarding();else workspace();schedulePoll();},error:message,fail(text){clearTimeout(pollTimer);pollGeneration++;revision++;$('#header-actions').innerHTML='';message('');main.innerHTML=`<h1>${esc(failureTitle)}</h1><p class="muted">${esc(text)}</p><button data-action="reload">重新加载</button>`;}};
}
