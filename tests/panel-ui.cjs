const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const http=require('node:http'),assert=require('node:assert/strict');
const html=readFileSync('plugins/openviking-codex-app/assets/index.html','utf8');
const requests=[];let rootSummaryResolved=false;const body='# Design report\n\n**Reviewed** with sources.\n\n| Item | State |\n| --- | --- |\n| Directory | Done |\n\n<script>window.hacked=true</script>\n<img src="https://example.com/tracker" onerror="window.hacked=true">\n\n[Next](next.json)\n';
const lists={
 'viking://':'[dir] resources\n[dir] user\n[dir] agent',
 'viking://resources':'[dir] research\n[file] report.md\n[file] next.json\n[file] .abstract.md\n[file] large.txt\n[file] image.png\n[file] slow.md',
 'viking://resources/research':'[file] study.md',
 'viking://user':'[dir] default',
 'viking://user/default':'[dir] sessions\n[dir] memories\n[dir] peers\n[dir] resources\n[dir] privacy\n[dir] skills',
 'viking://agent':'[dir] assistant'
};
const text=t=>({content:[{type:'text',text:t}]});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),uri=u.searchParams.get('uri');requests.push({path:u.pathname,uri,offset:u.searchParams.get('offset')});
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 res.setHeader('Content-Type','application/json');
 if(u.pathname==='/api/state'){res.end(JSON.stringify({connection:{ready:true},workspace:{works:[]},reports:[]}));return;}
 if(u.pathname==='/api/session_progress'){res.end(JSON.stringify({status:'complete',total:0,done:0,matched:0,items:[]}));return;}
 if(u.pathname==='/api/list'){
  if(uri==='viking://agent/assistant'){res.statusCode=400;res.end(JSON.stringify({error:'无权访问此目录'}));return;}
  res.end(JSON.stringify(text(lists[uri]||'')));return;
 }
 if(u.pathname==='/api/tree'){res.end(JSON.stringify(text('Tree of viking:// (depth <= 2, 3 entries):\nresources/\nuser/\nagent/\n(truncated at node_limit=3; narrow the uri or raise node_limit to see more)')));return;}
 if(u.pathname==='/api/read'){
  if(uri==='viking://.abstract.md'||uri==='viking://.overview.md'){setTimeout(()=>{rootSummaryResolved=true;res.end(JSON.stringify(text('(nothing found at '+uri+')')));},1800);return;}
  let value=text(uri.endsWith('report.md')?body:uri.endsWith('next.json')?' {"name":"fixture","state":"ready"}':uri.endsWith('.abstract.md')?'---\ndirectory: viking://resources\ngenerated_by: fixture\n---\n# Directory abstract':uri.endsWith('large.txt')?Number(u.searchParams.get('offset'))===0?Array.from({length:200},(_,i)=>'line '+i).join('\n'):'last line':uri.endsWith('study.md')?'# Study':'');
  if(uri.endsWith('.overview.md'))value=text('# Directory overview\n\nOverview details.');
  if(uri.endsWith('slow.md')){setTimeout(()=>res.end(JSON.stringify(text('# Stale content'))),450);return;}
  if(uri.endsWith('image.png'))value={content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3n0AAAAASUVORK5CYII='}]};
  res.end(JSON.stringify(value));return;
 }
 res.statusCode=404;res.end('{}');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1250,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'目录',exact:true}).click();
 const entry=uri=>page.locator('[data-entry="'+uri+'"]');
 const tab=name=>page.getByRole('tab',{name,exact:true});
 await entry('viking://user/default/sessions').waitFor();
 assert.equal(rootSummaryResolved,false,'Directory identity must expand without waiting for root summaries');
 assert.equal(await page.locator('.files-pane').count(),0);
 assert.deepEqual(await page.locator('#tree > [role=treeitem] > .tree-row > .tree-entry').evaluateAll(nodes=>nodes.map(n=>n.dataset.entry)),['viking://user','viking://resources','viking://agent']);
 assert.equal(await entry('viking://user/default').count(),1);
 assert.ok(await entry('viking://user/default').locator('svg').count());
 await entry('viking://resources').click();
 await page.locator('.markdown-body').getByText('Directory abstract',{exact:true}).waitFor();
 assert.ok(requests.some(r=>r.uri==='viking://resources/.overview.md'));
 assert.equal(await page.locator('.markdown-body').getByText(/generated_by/).count(),0);
 await tab('源码').click();await page.locator('.preview-content pre').getByText(/generated_by: fixture/).waitFor();
 await tab('概览 L1').click();await page.locator('.markdown-body').getByText('Directory overview',{exact:true}).waitFor();
 await tab('源码').click();await page.locator('.preview-content pre').getByText(/# Directory overview/).waitFor();
 await tab('路径').click();await page.locator('.path-view code').getByText('viking://resources/.overview.md',{exact:true}).waitFor();
 await tab('摘要 L0').click();await tab('路径').click();await page.locator('.path-view code').getByText('viking://resources/.abstract.md',{exact:true}).waitFor();
 await entry('viking://resources/report.md').click();
 await page.locator('.markdown-body strong').getByText('Reviewed',{exact:true}).waitFor();
 assert.equal(await page.locator('.markdown-body table').count(),1);assert.equal(await page.evaluate(()=>window.hacked),undefined);assert.equal(await page.locator('.markdown-body img').count(),0);
 assert.equal(await page.getByRole('tablist',{name:'目录内容'}).count(),0);
 await tab('源码').click();await page.locator('.preview-content pre').getByText(/<script>/).waitFor();
 await tab('预览').click();await page.getByRole('link',{name:'Next',exact:true}).click();await page.locator('.preview-content pre').getByText(/"state": "ready"/).waitFor();
 await entry('viking://resources/slow.md').click();await entry('viking://resources/next.json').click();await page.locator('.preview-content pre').getByText(/"state": "ready"/).waitFor();await page.waitForTimeout(600);assert.equal(await page.getByText('Stale content',{exact:true}).count(),0);
 await entry('viking://resources/report.md').click();await page.locator('.markdown-body table').waitFor();
 mkdirSync('.local/acceptance/screenshots',{recursive:true});await page.screenshot({path:'.local/acceptance/screenshots/workspace-directory.png'});
 await page.locator('#show-hidden').uncheck();assert.equal(await entry('viking://resources/.abstract.md').count(),0);
 await entry('viking://resources/large.txt').click();await page.getByRole('button',{name:'继续读取',exact:true}).click();await page.locator('.preview-content pre').getByText(/last line/).waitFor();assert.match(await page.locator('.preview-content pre').innerText(),/line 0/);assert.equal(await page.getByRole('button',{name:'继续读取',exact:true}).count(),0);
 await entry('viking://resources/image.png').click();await page.locator('.file-image').waitFor();
 await page.locator('[data-toggle="viking://resources"]').click();assert.equal(await entry('viking://resources/report.md').count(),0);assert.equal(await page.locator('.file-image').count(),1);
 await page.locator('[data-toggle="viking://resources"]').click();await entry('viking://resources/report.md').waitFor();
 await entry('viking://user/default').click();await page.getByRole('button',{name:'上一级',exact:true}).click();await entry('viking://user/default').waitFor();
 await page.getByLabel('目录路径',{exact:true}).fill('viking://agent/assistant');await page.getByRole('button',{name:'前往',exact:true}).click();await page.locator('[data-retry-tree="viking://agent/assistant"]').getByText(/无权访问/).waitFor();
 await page.getByLabel('目录路径',{exact:true}).fill('viking://resources');await page.getByRole('button',{name:'前往',exact:true}).click();await page.locator('.markdown-body').getByText('Directory abstract',{exact:true}).waitFor();await tab('概览 L1').click();await page.locator('.markdown-body').getByText('Directory overview',{exact:true}).waitFor();
 await page.locator('[data-toggle="viking://agent"]').click();
 await page.setViewportSize({width:680,height:860});await page.screenshot({path:'.local/acceptance/screenshots/workspace-sidebar.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.tree-pane').isVisible(),true);
 await page.setViewportSize({width:390,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.tree-pane').isVisible(),true);
 await page.getByLabel('目录路径',{exact:true}).fill('viking://');await page.getByRole('button',{name:'前往',exact:true}).click();await page.locator('.preview-heading h2').getByText('OpenViking',{exact:true}).waitFor();
 assert.ok(requests.some(r=>r.path==='/api/tree'));assert.ok(requests.some(r=>r.offset==='200'));assert.deepEqual(errors,[]);
 console.log('Panel browser passed: two panes, ordered roots, canonical identity, tree files/icons, automatic L0/L1, nested preview/source/path tabs, stale response protection, ACL retry, safe Markdown, media, pagination and narrow layouts.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
