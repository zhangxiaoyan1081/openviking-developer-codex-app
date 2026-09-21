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
  const page=await browser.newPage({viewport:{width:800,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('mcpCall',(name,args)=>call(name,args));
  await page.addInitScript(()=>{if(top!==window)return;window.messages=[];window.addEventListener('message',async e=>{
   const m=e.data;if(!m?.jsonrpc)return;
   if(m.method==='ui/notifications/size-changed'&&m.params.height){for(const f of document.querySelectorAll('iframe'))if(f.contentWindow===e.source)f.style.height=m.params.height+'px';}
   const reply=result=>e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
   if(m.method==='ui/initialize')reply({protocolVersion:m.params.protocolVersion,hostInfo:{name:'integration-test-host',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline']}});
   if(m.method==='ui/notifications/initialized'){const r=window.summaryResult&&e.source===document.querySelector('#summary')?.contentWindow?window.summaryResult:await window.mcpCall('show_onboarding',{step:'connection'});e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:r},'*');}
   if(m.method==='tools/call')reply(await window.mcpCall(m.params.name,m.params.arguments));
   if(m.method==='ui/message'){window.messages.push(m.params);reply({});}
  });});
  await page.goto('http://127.0.0.1:'+server.address().port);const frame=page.frameLocator('iframe').first();
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
  // Reconnecting with existing AGENTS.md must still show the collaboration choice.
  const beforeRules=await fs.readFile(path.join(tmp,'AGENTS.md'),'utf8');
  const beforeMtime=(await fs.stat(path.join(tmp,'AGENTS.md'))).mtimeMs;
  py("cloud.save('connection.json',{'verifiedAt':'fixture-reconnect'})");
  const reuseArgs={path:path.join(tmp,'AGENTS.md'),mode:'reuse',scope:'global',summary:['按需读取，保存明确批准的资料'],evidence:'The fixture user previously adopted these exact rules.'};
  await deliver(await call('prepare_collaboration',reuseArgs));
  await frame.getByRole('button',{name:'沿用这个方式',exact:true}).waitFor();
  assert.equal(await frame.getByText('带上过去的工作',{exact:true}).count(),0);
  await frame.getByRole('button',{name:'调整',exact:true}).click();
  await page.waitForFunction(()=>messages.some(m=>m.content[0].text.includes('调整已展示')));
  await deliver(await call('prepare_collaboration',reuseArgs));
  await frame.getByRole('button',{name:'沿用这个方式',exact:true}).click();
  await frame.getByText('带上过去的工作',{exact:true}).waitFor();
  assert.equal(await fs.readFile(path.join(tmp,'AGENTS.md'),'utf8'),beforeRules);
  assert.equal((await fs.stat(path.join(tmp,'AGENTS.md'))).mtimeMs,beforeMtime);
  await deliver(await call('show_onboarding'));
  await frame.getByText('带上过去的工作',{exact:true}).waitFor();
  steps.push('existing rules -> explicit reuse/adjust -> scope; no file rewrite or repeated resume prompt');
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
  const summary=await call('publish_work',{onboarding:true,scopeRevision:state.onboarding.scopeRevision,works:[work]});
  // A host creates a second iframe for publish_work, rather than replacing the first tool's iframe.
  await page.evaluate(result=>{window.summaryResult=result;const el=document.createElement('iframe');el.id='summary';el.src='/app';el.setAttribute('sandbox','allow-scripts allow-same-origin');el.style='width:760px;height:900px';document.body.append(el);},summary);
  const summaryFrame=page.frameLocator('#summary');
  await summaryFrame.getByText('上次停在这里',{exact:true}).waitFor();
  assert.equal(await summaryFrame.locator('.review').count(),0);
  await frame.getByRole('button',{name:'刷新',exact:true}).first().click();
  await frame.getByText('同步已完成',{exact:true}).waitFor();
  assert.equal(await frame.getByText('上次停在这里',{exact:true}).count(),0);
  assert.equal(await frame.locator('[data-work]').count(),0);
  await frame.getByRole('button',{name:'刷新',exact:true}).first().click();
  assert.equal(await frame.getByText('上次停在这里',{exact:true}).count(),0);
  steps.push('two real App iframes: finished sync stays separate, only one summary after refresh');
  await fs.mkdir('.local/acceptance/screenshots',{recursive:true});
  await frame.getByRole('button',{name:'刷新',exact:true}).first().isEnabled();
  await page.screenshot({path:'.local/acceptance/screenshots/sync-and-summary-separated.png',fullPage:true});
  await summaryFrame.getByRole('button',{name:'回顾这项工作',exact:true}).click();
  await page.waitForFunction(()=>messages.some(m=>m.content[0].text.includes('回顾「测试工作」')));
  const handoff=await page.evaluate(()=>messages.at(-1).content[0].text);
  assert.match(handoff,/只总结目标、已完成、当前进展和待解决事项/);
  assert.match(handoff,/等待我的下一条指令，不执行任务、不修改文件、不创建新任务/);
  assert.equal((await call('get_state')).structuredContent.onboarding.choice,'continue');steps.push('summary -> read-only recap and suggested directions -> wait for user instruction');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:'MCP + Python + App SDK',steps,cloudWrites:0,codexNativeUI:'not_tested'},null,2));
 }finally{if(browser)await browser.close();if(server)server.close();await client.close();await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
