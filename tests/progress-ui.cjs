const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const http=require('node:http'),assert=require('node:assert/strict');
const html=readFileSync('plugins/openviking-codex-app/assets/index.html','utf8');
const records=Array.from({length:45},(_,i)=>({id:'work-'+i,title:'项目进展 '+i,state:'已完成需求梳理与方案评审，当前正在核对交互细节。下一步等待测试结果，补齐验收记录。',status:'ready',updatedAt:'2026-09-21T08:30:00Z',overviewUri:'viking://user/default/sessions/work-'+i+'/history/archive_003/.overview.md'}));
let polls=0,detailReads=0,failDetail=true;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(u.pathname==='/api/state'){res.end(JSON.stringify({connection:{ready:true},workspace:{works:[{title:'Old local work should not appear'}]},reports:[]}));return;}
 if(u.pathname==='/api/session_progress'){polls++;const offset=Number(u.searchParams.get('offset')||0),q=u.searchParams.get('query')||'',rows=records.filter(x=>x.title.includes(q));res.end(JSON.stringify({status:polls===1?'running':'complete',done:polls===1?20:45,total:45,matched:rows.length,items:rows.slice(offset,offset+20)}));return;}
 if(u.pathname==='/api/session_detail'){detailReads++;if(failDetail){failDetail=false;res.statusCode=400;res.end(JSON.stringify({error:'概览暂时无法读取。'}));return;}res.end(JSON.stringify({overview:'---\ngenerated_by: fixture\n---\n# Working Memory\n\n## Session Title\n项目进展\n\n## Current State\n已完成评审。\n\n'+Array.from({length:240},(_,i)=>'- 验收条目 '+i).join('\n')+'\n\n<script>window.hacked=true</script>',uri:u.searchParams.get('uri')}));return;}
 res.statusCode=404;res.end('{}');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const context=await browser.newContext({viewport:{width:1180,height:950},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('.session-card').first().waitFor();assert.deepEqual(await page.locator('nav button').allTextContents(),['目录','工作进展','报告与洞察']);assert.equal(await page.getByText('Old local work should not appear',{exact:true}).count(),0);assert.equal(await page.locator('.session-card').count(),20);assert.equal(detailReads,0);
 await page.locator('#progress-status').getByText('45 个会话',{exact:true}).waitFor();
 const first=await page.locator('.session-card').nth(0).boundingBox(),second=await page.locator('.session-card').nth(1).boundingBox();assert.equal(first.x,second.x);assert.ok(second.y>first.y+first.height);assert.ok(first.width>900);
 mkdirSync('.local/acceptance/screenshots',{recursive:true});await page.screenshot({path:'.local/acceptance/screenshots/workspace-progress.png'});
 await page.locator('[data-overview="work-0"]').click();await page.getByRole('alert').getByText('概览暂时无法读取。',{exact:true}).waitFor();await page.locator('[data-retry-overview="work-0"]').click();await page.getByText('验收条目 239',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.hacked),undefined);assert.equal(await page.locator('.markdown-body').getByText(/generated_by/).count(),0);
 await page.locator('[data-overview="work-0"]').click();assert.equal(await page.locator('.session-overview').count(),0);
 await page.locator('[data-copy-resume="work-0"]').click();await page.getByText('已复制，粘贴到 Codex 对话即可。',{exact:true}).waitFor();const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.match(copied,/sessions\/work-0\/history\/archive_003\/\.overview\.md/);assert.match(copied,/等待我的下一条指令后再执行/);
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('[data-session="work-20"]').waitFor();assert.equal(await page.locator('.session-card').count(),20);
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('[data-session="work-40"]').waitFor();assert.equal(await page.locator('.session-card').count(),5);
 await page.getByRole('searchbox',{name:'搜索工作进展'}).fill('项目进展 24');await page.locator('[data-session="work-24"]').waitFor();assert.equal(await page.locator('.session-card').count(),1);
 await page.setViewportSize({width:600,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/acceptance/screenshots/workspace-progress-sidebar.png'});
 assert.deepEqual(errors,[]);console.log('Progress UI passed: cloud source, nav order, large row cards, polling, pagination/search, lazy full L1, retry, XSS, copy-only continuation, narrow layout.');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
