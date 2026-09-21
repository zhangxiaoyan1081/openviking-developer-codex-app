const {chromium}=require('playwright');
const {readFileSync,mkdirSync}=require('node:fs');
const http=require('node:http'),assert=require('node:assert/strict');
const html=readFileSync('plugins/openviking-codex-app/assets/index.html','utf8');
const requests=[];const body='# Design report\n\n**Reviewed** with sources.\n\n| Item | State |\n| --- | --- |\n| Directory | Done |\n\n<script>window.hacked=true</script>\n<img src="https://example.com/tracker" onerror="window.hacked=true">\n\n[Next](next.json)\n';
const lists={
 'viking://':'[dir] resources\n[dir] user\n[dir] agent',
 'viking://resources':'[dir] research\n[file] report.md\n[file] next.json\n[file] .abstract.md\n[file] large.txt\n[file] image.png',
 'viking://resources/research':'[file] study.md',
 'viking://user':'[dir] default',
 'viking://user/default':'[dir] sessions\n[dir] memories\n[dir] peers',
 'viking://agent':'[dir] assistant'
};
const text=t=>({content:[{type:'text',text:t}]});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),uri=u.searchParams.get('uri');requests.push({path:u.pathname,uri,offset:u.searchParams.get('offset')});
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 res.setHeader('Content-Type','application/json');
 if(u.pathname==='/api/state'){res.end(JSON.stringify({connection:{ready:true},workspace:{works:[]},reports:[]}));return;}
 if(u.pathname==='/api/list'){
  if(uri==='viking://agent/assistant'){res.statusCode=400;res.end(JSON.stringify({error:'无权访问此目录'}));return;}
  res.end(JSON.stringify(text(lists[uri]||'')));return;
 }
 if(u.pathname==='/api/tree'){res.end(JSON.stringify(text('Tree of viking:// (depth <= 2, 3 entries):\nresources/\nuser/\nagent/\n(truncated at node_limit=3; narrow the uri or raise node_limit to see more)')));return;}
 if(u.pathname==='/api/read'){
  let value=text(uri.endsWith('report.md')?body:uri.endsWith('next.json')?' {"name":"fixture","state":"ready"}':uri.endsWith('.abstract.md')?'# Directory abstract':uri.endsWith('large.txt')?Number(u.searchParams.get('offset'))===0?Array.from({length:200},(_,i)=>'line '+i).join('\n'):'last line':uri.endsWith('study.md')?'# Study':'');
  if(uri.endsWith('image.png'))value={content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3n0AAAAASUVORK5CYII='}]};
  res.end(JSON.stringify(value));return;
 }
 res.statusCode=404;res.end('{}');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1250,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'目录',exact:true}).click();
 await page.locator('[data-entry="viking://resources"]').click();
 await page.locator('[data-entry="viking://resources/report.md"]').click();
 await page.locator('.markdown-body strong').getByText('Reviewed',{exact:true}).waitFor();
 assert.equal(await page.locator('.markdown-body table').count(),1);assert.equal(await page.evaluate(()=>window.hacked),undefined);assert.equal(await page.locator('.markdown-body img').count(),0);
 await page.getByRole('button',{name:'源码',exact:true}).click();await page.locator('.preview-content pre').getByText(/<script>/).waitFor();
 await page.getByRole('button',{name:'预览',exact:true}).click();await page.getByRole('link',{name:'Next',exact:true}).click();await page.locator('.preview-content pre').getByText(/"state": "ready"/).waitFor();
 await page.locator('[data-entry="viking://resources/report.md"]').click();await page.locator('.markdown-body table').waitFor();
 mkdirSync('.local/acceptance/screenshots',{recursive:true});await page.screenshot({path:'.local/acceptance/screenshots/workspace-directory.png'});
 await page.locator('#show-hidden').uncheck();assert.equal(await page.locator('[data-entry="viking://resources/.abstract.md"]').count(),0);
 await page.getByLabel('筛选当前目录').fill('report');assert.equal(await page.locator('[data-entry]').count(),1);await page.getByLabel('筛选当前目录').fill('');
 await page.locator('[data-entry="viking://resources/large.txt"]').click();await page.getByRole('button',{name:'继续读取',exact:true}).click();await page.locator('.preview-content pre').getByText(/last line/).waitFor();assert.match(await page.locator('.preview-content pre').innerText(),/line 0/);assert.equal(await page.getByRole('button',{name:'继续读取',exact:true}).count(),0);
 await page.locator('[data-entry="viking://resources/image.png"]').click();await page.locator('.file-image').waitFor();
 await page.getByRole('button',{name:'刷新目录',exact:true}).click();await page.getByRole('button',{name:'L0 摘要',exact:true}).click();await page.locator('.markdown-body').getByText('Directory abstract',{exact:true}).waitFor();
 await page.locator('[data-tree="viking://user"]').click();await page.locator('[data-entry="viking://user/default"]').click();await page.locator('[data-entry="viking://user/default/sessions"]').waitFor();
 await page.getByRole('button',{name:'上一级',exact:true}).click();await page.locator('[data-entry="viking://user/default"]').waitFor();
 await page.getByLabel('目录路径',{exact:true}).fill('viking://agent/assistant');await page.getByRole('button',{name:'前往',exact:true}).click();await page.getByRole('alert').getByText('无权访问此目录',{exact:true}).waitFor();
 await page.getByLabel('目录路径',{exact:true}).fill('viking://resources');await page.getByRole('button',{name:'前往',exact:true}).click();await page.locator('[data-entry="viking://resources/report.md"]').click();await page.locator('.markdown-body table').waitFor();
 await page.setViewportSize({width:680,height:860});await page.screenshot({path:'.local/acceptance/screenshots/workspace-sidebar.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:390,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.ok(requests.some(r=>r.path==='/api/tree'));assert.ok(requests.some(r=>r.offset==='200'));assert.deepEqual(errors,[]);
 console.log('Panel browser passed: full roots, tree, breadcrumbs, path entry, ACL error, Markdown/source, JSON, images, summaries, filter, hidden files, append pagination, narrow layouts.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
