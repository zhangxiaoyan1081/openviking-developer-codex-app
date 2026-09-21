/* Real bundled MCP + Python state + App SDK, with a simulated host message bridge.
   This verifies the integration but deliberately does not claim Codex UI acceptance. */
const {chromium}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
(async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'ov-app-integration-'));
 const scripts=path.resolve('plugins/openviking-codex-app/scripts');
 const env={PATH:process.env.PATH,HOME:tmp,TMPDIR:tmp};
 const py=code=>execFileSync('python3',['-c',`import sys,json;sys.path.insert(0,${JSON.stringify(scripts)});import cloud,onboarding;${code}`],{env,encoding:'utf8'});
 const client=new Client({name:'app-integration',version:'1'});let browser,server;
 const steps=[];
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(scripts,'app_server.mjs')],env}));
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r;};
  const html=(await client.readResource({uri:'ui://openviking/personal.html'})).contents[0].text;
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/app'?html:'<iframe sandbox="allow-scripts allow-same-origin" src="/app" style="width:760px;height:900px"></iframe>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('mcpCall',(name,args)=>call(name,args));
  await page.addInitScript(()=>{if(top!==window)return;window.messages=[];window.addEventListener('message',async e=>{
   const m=e.data;if(!m?.jsonrpc)return;const reply=result=>e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
   if(m.method==='ui/initialize')reply({protocolVersion:m.params.protocolVersion,hostInfo:{name:'integration-test-host',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline']}});
   if(m.method==='ui/notifications/initialized'){const r=await window.mcpCall('show_onboarding',{step:'connection'});e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:r},'*');}
   if(m.method==='tools/call')reply(await window.mcpCall(m.params.name,m.params.arguments));
   if(m.method==='ui/message'){window.messages.push(m.params);reply({});}
  });});
  await page.goto('http://127.0.0.1:'+server.address().port);const frame=page.frameLocator('iframe');
  const deliver=r=>page.evaluate(r=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:r},'*'),r);
  await frame.getByRole('button',{name:'连接',exact:true}).waitFor();steps.push('no-key connection card');
  // Fixture authentication is isolated and never sent to the commercial service.
  py("cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'fixture-only'});cloud.save('connection.json',{'verifiedAt':'fixture'})");
  await deliver(await call('show_onboarding',{step:'connection'}));
  await frame.getByRole('button',{name:'使用当前连接',exact:true}).waitFor();steps.push('existing connection still shown on explicit entry');
  const proposal=await call('prepare_collaboration',{path:path.join(tmp,'AGENTS.md'),mode:'merge',scope:'global',summary:['按需读取，保存明确批准的资料'],block:'Read relevant context and save approved deliverables.'});
  await deliver(proposal);await frame.getByRole('button',{name:'采用这个方式',exact:true}).click();
  await page.waitForFunction(()=>messages.some(m=>m.content[0].text.includes('apply_rules')));
  py(`onboarding.apply_rules({'revision':${JSON.stringify(proposal.structuredContent.onboarding.collaboration.revision)}})`);
  // The existing card follows persisted backend state, without a fabricated tool result.
  await frame.getByText('带上过去的工作',{exact:true}).waitFor({timeout:10000});steps.push('rules approval -> persisted rules -> scope card');
  await frame.getByRole('button',{name:'从现在开始 →'}).click();
  await frame.getByText('从今天开始积累',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'稍后',exact:true}).click();
  await frame.getByText('设置已保留，随时可以开始。',{exact:true}).waitFor();
  assert.equal((await call('get_state')).structuredContent.onboarding.choice,'later');steps.push('skip -> expectations -> next choice');
  await call('select_scope',{mode:'recent',days:30});
  const plan={sessions:[{source_id:'fixture',title:'测试工作',ended:true,capture_checked:true,messages:[{role:'user',content:'Synthetic acceptance fixture',created_at:'2026-09-21T00:00:00Z',source_message_id:'1'}]}]};
  const planPath=path.join(tmp,'plan.json');await fs.writeFile(planPath,JSON.stringify(plan));
  const preview=await call('review_import',{path:planPath,coverage:'虚构验收资料，未上传云端'});await deliver(preview);
  await frame.getByRole('button',{name:'确认同步',exact:true}).click();
  await frame.getByText('正在整理你的工作',{exact:true}).waitFor();steps.push('review confirmation -> progress card before upload');
  const hash=preview.structuredContent.plan.hash;
  py(`cloud.save('active-import.json',{'hash':${JSON.stringify(hash)},'sources':[{'id':'fixture','title':'测试工作'}]});cloud.save('imports/'+${JSON.stringify(hash)}+'.json',{'items':{'fixture':{'state':'submitted','verified':True,'task':{'status':'completed'}}}})`);
  await frame.getByText('已保存并核对 · 记忆已整理',{exact:true}).waitFor({timeout:10000});steps.push('progress polls actual persisted ledger');
  const state=(await call('get_state')).structuredContent;
  const work={id:'fixture',title:'测试工作',goal:'完成接口设计',state:'接口方案已核对',decisions:'沿用字段',openIssues:'待补错误示例',next:'检查错误示例',coverage:'虚构验收资料',sources:[{label:'测试来源',uri:'viking://user/default/resources/test.md'}]};
  await deliver(await call('publish_work',{onboarding:true,scopeRevision:state.onboarding.scopeRevision,works:[work]}));
  await frame.getByText('上次停在这里',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'继续这项工作',exact:true}).click();
  await page.waitForFunction(()=>messages.some(m=>m.content[0].text.includes('接续「测试工作」')));
  assert.equal((await call('get_state')).structuredContent.onboarding.choice,'continue');steps.push('publish -> visible summary -> continuation bridge');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:'MCP + Python + App SDK',steps,cloudWrites:0,codexNativeUI:'not_tested'},null,2));
 }finally{if(browser)await browser.close();if(server)server.close();await client.close();await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
