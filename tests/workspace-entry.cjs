// Actual bundled MCP App, simulated host; no tool-result notification or model turn.
const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const http=require('node:http'),assert=require('node:assert/strict');
const html=readFileSync('plugins/openviking-codex-app/assets/workspace.html','utf8');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/app'?html:'<iframe sandbox="allow-scripts allow-same-origin" src="/app" style="border:0;width:100%;height:950px"></iframe>');});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   if(top!==window)return;
   window.calls=[];window.messages=[];window.ready=false;window.fail=false;window.switchFail=false;window.active="current";window.extra=false;window.supportsNew=true;
   window.addEventListener('message',e=>{
    const m=e.data;if(!m?.jsonrpc)return;
    const reply=result=>e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
    if(m.method==='ui/initialize')reply({protocolVersion:m.params.protocolVersion,hostInfo:{name:'sidebar-fixture',version:'1'},hostCapabilities:{serverTools:{},message:{text:{}},experimental:{'openai/message':{}}},hostContext:{theme:'light',displayMode:'fullscreen',availableDisplayModes:['fullscreen']}});
    if(m.method==='ui/message'){window.messages.push(m.params);if(window.supportsNew)reply({});else e.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'unsupported'}},'*');return;}
    if(m.method!=='tools/call')return;
    let {name,arguments:a}=m.params;window.calls.push(name);if(name==='workspace_read'){name=a.tool;a=a.arguments;}
    const text=t=>({content:[{type:'text',text:t}]});
    if(name==='workspace_switch_user'){if(window.switchFail){reply({isError:true,...text('验证失败，原连接已保留。')});return;}window.active=a.profile_name;name='get_workspace_state';}
    if(name==='get_workspace_state'){
     if(window.fail){reply({isError:true,...text('读取失败，请重试。')});return;}
     reply({content:[],structuredContent:{connection:{ready:window.ready,revision:window.active},identity:{user:window.active==='current'?'default':'bob',account:'default'},boundUsers:[{name:'current',serviceName:'个人空间',user:'default',account:'default',active:window.active==='current'},{name:'work',serviceName:'团队空间',user:'bob',account:'team',active:window.active==='work'},...(window.extra?[{name:'other',serviceName:'团队空间',user:'bob',account:'other',databaseId:'fixture-db',active:window.active==='other'}]:[])],reports:window.ready?[{title:'测试周报',period:'本周',body:'已核对的测试内容',coverage:'虚构验收数据',sources:[]}]:[]}});return;
    }
    if(name==='list_directory'){const lists={'viking://':'[dir] user\n[dir] resources','viking://user':'[dir] default','viking://user/default':'[dir] sessions','viking://resources':'[file] report.md'};reply({structuredContent:text((a.uri==='viking://user'&&window.active!=='current'?'[dir] bob':a.uri==='viking://user/bob'?'[dir] resources':lists[a.uri]||''))});return;}
    if(name==='tree_directory'){reply({structuredContent:text('user/\nresources/\n')});return;}
    if(name==='read_file'){reply({structuredContent:text(a.uri.endsWith('report.md')?'# 文件正文':a.uri.endsWith('.overview.md')?'# 目录概览':'# 目录摘要')});return;}
    if(name==='get_session_progress'){reply({structuredContent:{status:'complete',total:1,matched:1,items:[{id:'fixture',title:'测试工作',state:'已完成评审',status:'ready',updatedAt:'2026-10-09T00:00:00Z',overviewUri:'viking://user/default/sessions/fixture/history/archive_001/.overview.md'}]}});return;}
    if(name==='read_session_overview'){reply({structuredContent:{overview:'# Working Memory\n\n## Current State\n已完成评审，等待下一步。'}});return;}
    reply({isError:true,...text('Unexpected call: '+name)});
   });
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('iframe');
  await frame.getByRole('heading',{name:'连接 OpenViking',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>calls),['get_workspace_state']);
  // Completing setup elsewhere can be picked up without opening onboarding here.
  await page.evaluate(()=>window.ready=true);
  await frame.getByRole('button',{name:'刷新',exact:true}).click();
  await frame.locator('[data-entry="viking://user/default/sessions"]').waitFor();
  await frame.locator('[data-entry="viking://resources"]').click();
  await frame.getByRole('tab',{name:'概览 L1',exact:true}).click();
  await frame.locator('.markdown-body').getByText('目录概览',{exact:true}).waitFor();
  await frame.locator('[data-entry="viking://resources/report.md"]').click();
  await frame.locator('.markdown-body').getByText('文件正文',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'工作进展',exact:true}).click();
  await frame.getByRole('button',{name:'展开概览',exact:true}).click();
  await frame.getByText('已完成评审，等待下一步。',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'复制接续指令'}).count(),1);
  await frame.getByRole('button',{name:'报告与洞察',exact:true}).click();
  await frame.getByRole('button',{name:/测试周报/}).click();
  await frame.getByText('已核对的测试内容',{exact:true}).waitFor();
  assert.ok(!(await page.evaluate(()=>calls)).some(n=>/onboarding|binding|select_scope|connect_key|choose/.test(n)));
  // A fresh navigation must still bootstrap without a preceding tool result.
  await page.evaluate(()=>document.querySelector('iframe').src='/app');
  await frame.locator('[data-entry="viking://user/default/sessions"]').waitFor();
  mkdirSync('.local/acceptance/screenshots',{recursive:true});
  await page.screenshot({path:'.local/acceptance/screenshots/sidebar-workspace.png'});
  await page.evaluate(()=>{window.fail=true;document.querySelector('iframe').src='/app';});
  await frame.getByRole('heading',{name:'工作台暂时无法显示'}).waitFor();
  await page.evaluate(()=>window.fail=false);
  await frame.getByRole('button',{name:'重新加载'}).click();
  await frame.locator('[data-entry="viking://user/default/sessions"]').waitFor();
  // Switch locally without opening cards/onboarding; failure preserves the view.
  await frame.getByLabel('切换 OpenViking 用户').click();
  await page.evaluate(()=>window.switchFail=true);
  await frame.locator('[data-user="work"]').click();
  await frame.getByText('验证失败，原连接已保留。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.active),'current');
  await page.evaluate(()=>window.switchFail=false);
  await frame.getByLabel('切换 OpenViking 用户').click();
  await frame.locator('[data-user="work"]').click();
  await frame.locator('[data-entry="viking://user/bob/resources"]').waitFor();
  assert.equal(await frame.locator('[data-entry="viking://user/default/sessions"]').count(),0);
  await frame.getByText('已切换。新对话使用此用户，已有对话保持原连接。',{exact:true}).waitFor();
  // A binding created in a conversation appears on returning to the workspace.
  await page.evaluate(()=>{window.extra=true;document.querySelector('iframe').contentWindow.dispatchEvent(new Event('focus'));});
  await frame.getByLabel('切换 OpenViking 用户').click();
  await frame.locator('[data-user="other"]').waitFor();
  assert.match(await frame.locator('[data-user="other"]').innerText(),/fixture-db/);
  await frame.locator('[data-add-user]').click();
  assert.equal(await page.evaluate(()=>window.messages.length),0);
  await frame.getByRole('button',{name:'在新对话中接入',exact:true}).click();
  await page.waitForFunction(()=>window.messages.length===1);
  const message=await page.evaluate(()=>window.messages[0]);
  assert.equal(message._meta['openai/message'].target,'new');
  assert.match(message.content[0].text,/Hooks/);assert.match(message.content[0].text,/确认记忆和长期协作方式/);
  assert.match(message.content[0].text,/不要复用旧用户/);assert.equal(message.role,'user');
  // Unsupported hosts leave a useful, copyable prompt instead of starting elsewhere.
  await page.evaluate(()=>window.supportsNew=false);
  await frame.getByLabel('切换 OpenViking 用户').click();await frame.locator('[data-add-user]').click();
  await frame.getByRole('button',{name:'在新对话中接入',exact:true}).click();
  await frame.getByText('未能打开新对话，请复制接入指令。',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'复制接入指令',exact:true}).count(),1);
  await frame.getByRole('button',{name:'取消',exact:true}).click();
  await frame.getByLabel('切换 OpenViking 用户').click();
  await page.screenshot({path:'.local/acceptance/screenshots/workspace-users.png'});
  assert.deepEqual(errors,[]);
  console.log('Sidebar App passed: no model result needed, setup recovery, directory/L1/file, progress/detail, reports, reopening, failure/retry; no onboarding mutations.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
