/* Runs the real bundled App SDK inside a sandboxed iframe against a simulated MCP host. */
const { chromium }=require('playwright');
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../plugins/ov-personal/assets/app.html'),'utf8');
const fixture={configured:true,view:'onboarding',plan:null,workspace:{works:[]},reports:[]};
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/app'?html:`<body style="margin:30px;background:#f4f5f4"><iframe title="OpenViking" sandbox="allow-scripts allow-same-origin" src="/app" style="width:720px;height:570px;border:1px solid #ddd;border-radius:14px"></iframe></body>`);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:820,height:660}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({fixture})=>{
  if(window.top!==window)return;
  window.protocol=[];window.requests=[];window.messages=[];window.fixture=fixture;window.rejectMessage=false;
  window.addEventListener('message',event=>{
   const m=event.data;window.protocol.push(m);if(!m?.jsonrpc)return;
   const response=result=>event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
   if(m.method==='ui/notifications/size-changed'&&m.params.height)document.querySelector('iframe').style.height=m.params.height+'px';
   if(m.method==='ui/initialize')response({protocolVersion:m.params.protocolVersion,hostInfo:{name:'test-host',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}},updateModelContext:{}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}});
   if(m.method==='ui/notifications/initialized')event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:window.fixture}},'*');
   if(m.method==='tools/call'){
    window.requests.push(m.params);let v={};const {name,arguments:a}=m.params;
    if(name==='select_scope')v={scope:a};
    if(name==='confirm_import')v={plan:{hash:a.hash,confirmed:true}};
    if(name==='get_state')v=window.fixture;
    if(name==='list_directory')v={content:[{type:'text',text:'[dir] projects\n[file] report.md'}]};
    if(name==='read_file')v={content:[{type:'text',text:'# 来源正文\n已完成接口核对。\n<script>window.hacked=true</script>'}]};
    response({content:[],structuredContent:v});
   }
   if(m.method==='ui/message'){window.messages.push(m.params);response({isError:window.rejectMessage});}
   if(m.method==='ui/request-display-mode')response({mode:m.params.mode});
  });
 },{fixture});
 await page.goto('http://127.0.0.1:'+server.address().port);const frame=page.frameLocator('iframe');
 try{await frame.getByText('带上过去的工作',{exact:true}).waitFor({timeout:8000});}catch(e){console.log('errors',errors,'protocol',await page.evaluate(()=>protocol),'frame',await page.frames()[1].locator('body').innerText());throw e;}
 await page.screenshot({path:'docs/screenshots/onboarding-card.png'});
 await frame.getByRole('button',{name:'近期全部工作'}).click();await frame.locator('#days').selectOption('90');await frame.getByRole('button',{name:'继续',exact:true}).click();
 await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();
 assert.equal(await page.evaluate(()=>requests[0].arguments.days),90);assert.equal(await page.evaluate(()=>messages.length),1);assert.match(await page.evaluate(()=>messages[0].content[0].text),/先不要上传/);
 const render=async value=>page.evaluate(value=>{window.fixture=value;document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:value}},'*');},value);
 await render({...fixture,plan:{hash:'a'.repeat(64),coverage:'最近三个月 · 2 个项目',confirmed:false,items:[{title:'接口设计',project:'OpenViking',messages:12},{title:'网站改版',project:'Website',reuse:true}]}});
 await frame.getByRole('button',{name:'确认同步',exact:true}).click();await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();assert.equal(await page.evaluate(()=>requests.at(-1).name),'confirm_import');
 await render({...fixture,view:'workspace',reports:[{id:'1',title:'本周工作回顾',period:'9 月 14–20 日',coverage:'2 个项目 · 5 个会话',body:'# 已完成\n接口核对与网站改版。',sources:[{label:'接口资料',uri:'viking://user/default/resources/report.md'}]}]});
 await frame.getByRole('button',{name:'报告与洞察',exact:true}).click();await frame.getByRole('button',{name:'生成报告',exact:true}).click();await frame.getByText('已交给 Codex，请在对话中继续。').waitFor();assert.match(await page.evaluate(()=>messages.at(-1).content[0].text),/publish_report/);
 await page.screenshot({path:'docs/screenshots/reports-card.png'});
 await frame.getByRole('button',{name:/本周工作回顾/}).click();await frame.getByRole('button',{name:'↗ 接口资料'}).click();await frame.locator('#preview').getByText(/已完成接口核对/).waitFor();assert.equal(await page.frames()[1].evaluate(()=>window.hacked),undefined);
 await frame.getByRole('button',{name:'目录',exact:true}).click();await frame.getByRole('button',{name:'▸ projects'}).click();await frame.getByRole('button',{name:'· report.md'}).click();await frame.locator('#preview pre').waitFor();await page.screenshot({path:'docs/screenshots/directory-card.png'});
 await page.evaluate(()=>window.rejectMessage=true);await render(fixture);await frame.getByRole('button',{name:'从现在开始 →'}).click();await frame.getByText(/选择已保留/).waitFor();
 await page.setViewportSize({width:420,height:700});await page.locator('iframe').evaluate(el=>{el.style.width='360px';el.style.height='610px';});await render(fixture);await page.screenshot({path:'docs/screenshots/onboarding-mobile.png'});assert.equal(await page.frames()[1].evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 assert.deepEqual(errors,[]);console.log('App bridge: scope, confirmation, report request, directory preview, XSS escaping, rejected message and mobile passed.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
