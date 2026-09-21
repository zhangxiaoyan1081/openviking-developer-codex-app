/* Runs the real bundled App SDK inside a sandboxed iframe against a simulated MCP host. */
const { chromium }=require('playwright');
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const path=require('node:path');
fs.mkdirSync('.local/acceptance/screenshots',{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'../plugins/openviking-codex-app/assets/app.html'),'utf8');
const fixture={configured:true,connection:{hasKey:true,canReuse:true,ready:true,revision:'test-revision'},view:'onboarding',plan:null,workspace:{works:[]},reports:[]};
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/app'?html:`<body style="margin:30px;background:#f4f5f4"><iframe title="OpenViking" sandbox="allow-scripts allow-same-origin" src="/app" style="width:720px;height:570px;border:1px solid #ddd;border-radius:14px"></iframe></body>`);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:820,height:660}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({fixture})=>{
  if(window.top!==window)return;
  window.protocol=[];window.requests=[];window.messages=[];window.fixture={...fixture,connection:{...fixture.connection,ready:false}};window.rejectMessage=false;window.rejectKey=false;
  window.addEventListener('message',event=>{
   const m=event.data;window.protocol.push(m);if(!m?.jsonrpc)return;
   const response=result=>event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
   if(m.method==='ui/notifications/size-changed'&&m.params.height)document.querySelector('iframe').style.height=m.params.height+'px';
   if(m.method==='ui/initialize')response({protocolVersion:m.params.protocolVersion,hostInfo:{name:'test-host',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}},updateModelContext:{}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}});
   if(m.method==='ui/notifications/initialized'&&!window.suppressResult)event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:window.fixture}},'*');
   if(m.method==='tools/call'){
    window.requests.push(m.params);let v={};const {name,arguments:a}=m.params;
    if(name==='select_scope'){v={...window.fixture,scope:a};if(v.onboarding)v.onboarding={...v.onboarding,phase:a.mode==='skip'?'ready':'prepare',choice:null};window.fixture=v;}
    if(name==='confirm_import')v={plan:{hash:a.hash,confirmed:true}};
    if(name==='get_state')v=window.fixture;
    if(name==='choose_collaboration'){v={...window.fixture,onboarding:{...window.fixture.onboarding,collaboration:{...window.fixture.onboarding.collaboration,status:a.choice==='adopt'?(window.fixture.onboarding.collaboration.mode==='reuse'?'active':'accepted'):'adjusting'}}};if(v.onboarding.collaboration.status==='active')v.onboarding.phase='scope';window.fixture=v;}
    if(name==='choose_next'){v={...window.fixture,onboarding:{...window.fixture.onboarding,choice:a.choice}};window.fixture=v;}
    if(name==='import_status')v=window.fixture;
    if(name==='connect_existing'){v={...window.fixture,connection:{...window.fixture.connection,ready:true}};if(v.onboarding)v.onboarding={...v.onboarding,phase:'collaboration',collaboration:{...v.onboarding.collaboration,status:'proposed'}};window.fixture=v;}
    if(name==='connect_key'){
     if(window.rejectKey){response({isError:true,content:[{type:'text',text:'连接权限不足，请核对 API Key。'}]});return;}
     v={...window.fixture,connection:{...window.fixture.connection,ready:false,restartRequired:true}};window.fixture=v;
    }
    if(name==='tree_directory')v={content:[{type:'text',text:'Tree of viking:// (depth <= 2, 1 entries):\nresources/'}]};
    if(name==='list_directory')v={content:[{type:'text',text:'[dir] projects\n[file] report.md'}]};
    if(name==='read_file')v={content:[{type:'text',text:'# 来源正文\n已完成接口核对。\n<script>window.hacked=true</script>'}]};
    response({content:[],structuredContent:v});
   }
   if(m.method==='ui/message'){window.messages.push(m.params);response({isError:window.rejectMessage});}
   if(m.method==='ui/request-display-mode')response({mode:m.params.mode});
  });
 },{fixture});
 await page.goto('http://127.0.0.1:'+server.address().port);const frame=page.frameLocator('iframe');
 await frame.getByRole('button',{name:'使用当前连接',exact:true}).waitFor();
 assert.equal(await frame.getByText('带上过去的工作',{exact:true}).count(),0);
 await page.screenshot({path:'.local/acceptance/screenshots/connection-card.png'});
 await frame.getByRole('button',{name:'使用当前连接',exact:true}).click();
 try{await frame.getByText('带上过去的工作',{exact:true}).waitFor({timeout:8000});}catch(e){console.log('errors',errors,'protocol',await page.evaluate(()=>protocol),'frame',await page.frames()[1].locator('body').innerText());throw e;}
 await page.screenshot({path:'.local/acceptance/screenshots/onboarding-card.png'});
 await frame.getByRole('button',{name:'近期全部工作'}).click();await frame.locator('#days').selectOption('90');await frame.getByRole('button',{name:'继续',exact:true}).click();
 await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();
 assert.equal(await page.evaluate(()=>requests.find(x=>x.name==='select_scope').arguments.days),90);assert.equal(await page.evaluate(()=>messages.length),1);assert.match(await page.evaluate(()=>messages[0].content[0].text),/先不要上传/);
 const render=async value=>page.evaluate(value=>{window.fixture=value;document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:value}},'*');},value);
 await render({...fixture,plan:{hash:'a'.repeat(64),coverage:'最近三个月 · 2 个项目',confirmed:false,items:[{title:'接口设计',project:'OpenViking',messages:12},{title:'网站改版',project:'Website',reuse:true}]}});
 await frame.getByRole('button',{name:'确认同步',exact:true}).click();await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();assert.ok(await page.evaluate(()=>requests.some(r=>r.name==='confirm_import')));
 await render({...fixture,view:'workspace',reports:[{id:'1',title:'本周工作回顾',period:'9 月 14–20 日',coverage:'2 个项目 · 5 个会话',body:'# 已完成\n接口核对与网站改版。',sources:[{label:'接口资料',uri:'viking://user/default/resources/report.md'}]}]});
 await frame.getByRole('button',{name:'报告与洞察',exact:true}).click();await frame.getByRole('button',{name:'生成报告',exact:true}).click();await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();assert.match(await page.evaluate(()=>messages.at(-1).content[0].text),/publish_report/);
 await page.screenshot({path:'.local/acceptance/screenshots/reports-card.png'});
 await frame.getByRole('button',{name:/本周工作回顾/}).click();await frame.getByRole('button',{name:'↗ 接口资料'}).click();await frame.locator('#preview').getByText(/已完成接口核对/).waitFor();assert.equal(await page.frames()[1].evaluate(()=>window.hacked),undefined);
 await frame.getByRole('button',{name:'目录',exact:true}).click();await frame.locator('[data-entry]').filter({hasText:'projects'}).click();await frame.locator('[data-entry]').filter({hasText:'report.md'}).click();await frame.locator('#preview .markdown-body').waitFor();await page.screenshot({path:'.local/acceptance/screenshots/directory-card.png'});
 await page.evaluate(()=>window.rejectMessage=true);await render(fixture);await frame.getByRole('button',{name:'从现在开始 →'}).click();await frame.getByText(/选择已保留/).waitFor();
 await page.setViewportSize({width:420,height:700});await page.locator('iframe').evaluate(el=>{el.style.width='360px';el.style.height='610px';});await render(fixture);await page.screenshot({path:'.local/acceptance/screenshots/onboarding-mobile.png'});assert.equal(await page.frames()[1].evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 // Missing Key asks for credentials; errors preserve the form and do not enter import.
 await render({...fixture,configured:false,connection:{hasKey:false,canReuse:false,ready:false,revision:'missing'}});
 await frame.getByLabel('API Key',{exact:true}).fill('invalid-test-key');
 assert.equal(await frame.getByLabel('API Key',{exact:true}).getAttribute('type'),'password');
 await page.evaluate(()=>window.rejectKey=true);
 await frame.getByRole('button',{name:'连接',exact:true}).click();
 await frame.getByText('连接权限不足，请核对 API Key。',{exact:true}).waitFor();
 assert.equal(await frame.getByLabel('API Key',{exact:true}).inputValue(),'');
 assert.equal(await frame.getByText('带上过去的工作',{exact:true}).count(),0);
 assert.ok(!(await page.evaluate(()=>messages)).some(m=>JSON.stringify(m).includes('invalid-test-key')));
 // Existing connection offers replacement; changing it requires a fresh runtime.
 await render({...fixture,connection:{...fixture.connection,ready:false}});
 await frame.getByRole('button',{name:'更换 API Key',exact:true}).click();
 await page.screenshot({path:'.local/acceptance/screenshots/api-key-card.png'});
 await frame.getByLabel('API Key',{exact:true}).fill('valid-test-key');await page.evaluate(()=>window.rejectKey=false);
 await frame.getByRole('button',{name:'更换并连接',exact:true}).click();
 await frame.getByText('连接已更新',{exact:true}).waitFor();
 assert.equal(await frame.getByText('带上过去的工作',{exact:true}).count(),0);
 // Collaboration adoption hands off a concrete revision; skip still displays expectations.
 await page.evaluate(()=>window.rejectMessage=false);
 await page.setViewportSize({width:820,height:900});await page.locator('iframe').evaluate(el=>el.style.width='720px');
 const collaboration={status:'proposed',mode:'merge',scope:'global',revision:'rules-1',summary:['参考相关记忆和资料','保存重要进展与产出','简短说明参考与沉淀']};
 await render({...fixture,onboarding:{phase:'collaboration',collaboration,capabilities:{hooks:'unverified'}}});
 await frame.getByText('今后这样协作',{exact:true}).waitFor();
 await page.screenshot({path:'.local/acceptance/screenshots/collaboration-card.png'});
 await frame.getByRole('button',{name:'采用这个方式',exact:true}).click();
 await frame.getByText('正在保存协作设置…',{exact:true}).waitFor();
 assert.match(await page.evaluate(()=>messages.at(-1).content[0].text),/apply_rules/);
 const flow={phase:'scope',collaboration:{...collaboration,status:'active',mode:'reuse'},capabilities:{hooks:'unverified'},import:null};
 await render({...fixture,onboarding:flow});
 await frame.getByText('沿用已有协作方式。',{exact:true}).waitFor();
 await frame.getByRole('button',{name:'从现在开始 →'}).click();
 await frame.getByText('从今天开始积累',{exact:true}).waitFor();
 await frame.getByText(/自动回流尚未验证/).waitFor();
 assert.match(await page.evaluate(()=>messages.at(-1).content[0].text),/不要直接结束/);
 await page.screenshot({path:'.local/acceptance/screenshots/start-today-card.png'});
 await frame.getByRole('button',{name:'稍后',exact:true}).click();
 await frame.getByText('设置已保留，随时可以开始。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>fixture.onboarding.choice),'later');
 // Explicit reconnect must show collaboration even for existing authorized rules.
 await render({...fixture,entry:'connection',connection:{...fixture.connection,ready:false},scope:{mode:'skip'},onboarding:{...flow,phase:'ready',choice:'later'}});
 await frame.getByRole('button',{name:'使用当前连接',exact:true}).click();
 await frame.getByRole('button',{name:'沿用这个方式',exact:true}).waitFor();
 assert.equal(await frame.getByText('带上过去的工作',{exact:true}).count(),0);
 await frame.getByRole('button',{name:'沿用这个方式',exact:true}).click();
 await frame.getByText('带上过去的工作',{exact:true}).waitFor();
 await frame.getByText('沿用已有协作方式。',{exact:true}).click();
 await frame.getByText('参考相关记忆和资料',{exact:true}).waitFor();
 assert.equal(await frame.getByText('从今天开始积累',{exact:true}).count(),0);
 // Progress keeps its own surface when the backend has a summary, even before extraction completes.
 const job={jobId:'a'.repeat(64),terminal:false,items:[{title:'接口设计',status:'running',written:true,verified:true}]};
 await render({...fixture,scope:{mode:'recent',days:30},onboarding:{...flow,phase:'import',import:job}});
 await frame.getByText('正在整理你的工作',{exact:true}).waitFor();
 const work={id:'a',title:'接口设计',project:'OpenViking',goal:'完成接口设计',state:'接口约定已核对',decisions:'沿用现有字段',openIssues:'需要补齐错误返回',next:'检查错误示例',coverage:'已核对原始对话；记忆整理中',sources:[{label:'设计原文',uri:'viking://user/default/resources/a.md'}]};
 await page.evaluate(value=>{window.fixture=value;}, {...fixture,scope:{mode:'recent',days:30},workspace:{works:[work]},onboarding:{...flow,phase:'ready',summaryReady:true,import:job}});
 await frame.getByText('同步进度',{exact:true}).waitFor({timeout:8000});
 assert.equal(await frame.getByText('上次停在这里',{exact:true}).count(),0);
 assert.ok(await page.evaluate(()=>requests.some(r=>r.name==='import_status')));
 // A distinct publish result renders summary-only; no synchronous import list or status polling.
 await render({...fixture,scope:{mode:'recent',days:30},workspace:{works:[work]},onboarding:{...flow,phase:'ready',summaryReady:true,import:job}});
 await frame.getByText('上次停在这里',{exact:true}).waitFor();
 assert.equal(await frame.locator('.review').count(),0);
 await frame.getByRole('button',{name:'刷新',exact:true}).click();
 assert.equal(await frame.locator('.review').count(),0);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.local/acceptance/screenshots/continuation-card.png'});
 await frame.getByRole('button',{name:'修正总结',exact:true}).click();await page.waitForFunction(()=>/修正/.test(messages.at(-1).content[0].text));
 await frame.getByRole('button',{name:'回顾这项工作',exact:true}).click();await page.waitForFunction(()=>/等待我的下一条指令/.test(messages.at(-1).content[0].text));
 assert.match(await page.evaluate(()=>messages.at(-1).content[0].text),/不执行任务、不修改文件、不创建新任务/);
 // A malformed/legacy background result must terminate loading, not create a ghost card.
 await render({...fixture,view:undefined});
 await frame.getByText('未收到卡片内容，请重试。').waitFor();
 assert.equal(await frame.getByText('正在加载…',{exact:true}).count(),0);
 await page.evaluate(value=>{window.fixture=value;},fixture);
 await frame.getByRole('button',{name:'重新加载',exact:true}).click();
 await frame.getByText('带上过去的工作',{exact:true}).waitFor();
 // Hosts can deliver only text content; the payload still carries the explicit view.
 await page.evaluate(value=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[{type:'text',text:JSON.stringify(value)}]}},'*'),fixture);
 await frame.getByText('带上过去的工作',{exact:true}).waitFor();
 // Lost initial result has a bounded wait; a late valid result can recover.
 await page.evaluate(()=>{window.suppressResult=true;document.querySelector('iframe').contentWindow.location.reload();});
 await frame.getByText('加载超时，请重试。').waitFor({timeout:18000});
 await render(fixture);await frame.getByText('带上过去的工作',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('App bridge: scope, confirmation, report request, directory preview, XSS escaping, rejected message, mobile, missing result, reload and timeout recovery, existing connection consent, key input, auth failure and key switch passed.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
