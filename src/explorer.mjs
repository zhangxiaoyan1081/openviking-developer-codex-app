import {marked} from 'marked';
import DOMPurify from 'dompurify';
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ROOT='viking://';
const join=(base,name)=>name.startsWith(ROOT)?name:(base===ROOT?base:base.replace(/\/$/,'')+'/')+name.replace(/^\//,'');
export const parentURI=uri=>uri===ROOT?ROOT:uri.slice(9).replace(/\/$/,'').includes('/')?ROOT+uri.slice(9).replace(/\/$/,'').split('/').slice(0,-1).join('/'):ROOT;
const content=r=>(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
export function parseEntries(r,base){
 const raw=r.structuredContent||r;const bucket=Array.isArray(raw)?raw:raw.entries||raw.items||raw.children||raw.nodes;
 let items;
 if(Array.isArray(bucket))items=bucket.map(x=>typeof x==='string'?{name:x.replace(/\/$/,''),dir:x.endsWith('/'),uri:join(base,x).replace(/\/$/,'')}:{name:x.name||x.uri?.split('/').pop(),dir:!!(x.is_dir||x.isDir||x.type==='directory'||x.type==='dir'),uri:join(base,x.uri||x.path||x.name).replace(/\/$/,''),size:x.size_bytes??x.size??'',modified:x.mod_time||x.modTime||''});
 else items=content(r).split('\n').map(x=>x.match(/^\[(dir|file)\] (.+)$/)).filter(Boolean).map(x=>({dir:x[1]==='dir',name:x[2].replace(/\/$/,''),uri:join(base,x[2].replace(/\/$/,''))}));
 return items.filter(x=>x.uri?.startsWith(ROOT)&&x.name).sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name));
}
export function parseTree(r,base){
 const map=new Map([[base,[]]]),stack=[base];let truncated=false;
 for(const line of content(r).split('\n')){
  if(line.startsWith('(truncated')){truncated=true;continue;}
  if(!line||line.startsWith('Tree of '))continue;
  const match=line.match(/^( *)([^ ].*?)\s*$/);if(!match)continue;
  const depth=Math.floor(match[1].length/2),name=match[2].replace(/ \([^)]*\)$/,'').replace(/\/$/,''),dir=/\/$/.test(match[2]),parent=stack[depth];
  if(!parent||!name)continue;
  const uri=join(parent,name),entry={uri,name,dir};if(!map.has(parent))map.set(parent,[]);map.get(parent).push(entry);stack[depth+1]=uri;
 }
 return {map,truncated};
}
function markdown(text){return DOMPurify.sanitize(marked.parse(text,{gfm:true}),{FORBID_TAGS:['img','style','iframe','form','input','button'],ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|viking):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i});}
export function createExplorer({host,call}){
 let current=ROOT,selected=null,generation=0,previewGeneration=0,items=[],cache=new Map(),expanded=new Set([ROOT]),filter='',hidden=true,sort='name',count=100,previewText='',blocks=[],offset=0,hasMore=false,mode='preview',level='content',loading=false;
 let disposed=false;
 const $=q=>host.querySelector(q);
 function rows(list,tree=false,depth=0){return list.map(x=>tree?(x.dir?`<div><button class="tree-entry ${current===x.uri?'selected':''}" data-tree="${esc(x.uri)}" style="padding-left:${12+depth*14}px" aria-expanded="${expanded.has(x.uri)}"><span>${expanded.has(x.uri)?'▾':'▸'}</span><span class="file-icon">▱</span><span>${esc(x.name)}</span></button>${expanded.has(x.uri)?rows(cache.get(x.uri)||[],true,depth+1):''}</div>`:''):`<button class="entry ${selected?.uri===x.uri?'selected':''}" data-entry="${esc(x.uri)}" title="${esc(x.name)}"><span class="file-icon">${x.dir?'▱':'≡'}</span><span class="filename">${esc(x.name)}</span>${x.dir?'<span>›</span>':x.size!==undefined?`<small>${esc(x.size)}</small>`:''}</button>`).join('');}
 function tree(){if($('#tree'))$('#tree').innerHTML=`<button class="tree-entry ${current===ROOT?'selected':''}" data-nav="viking://">▾ OpenViking</button>`+rows(cache.get(ROOT)||[],true,1);}
 function listing(){
  if(!$('#listing'))return;
  const visible=items.filter(x=>(hidden||!x.name.startsWith('.'))&&x.name.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>Number(b.dir)-Number(a.dir)||(sort==='name'?a.name.localeCompare(b.name):b.name.localeCompare(a.name)));
  $('#listing').innerHTML=rows(visible.slice(0,count))+(visible.length>count?'<button class="load-more" data-load>显示更多</button>':'')+(!visible.length?'<p class="empty">'+(filter?'没有匹配的文件':'目录为空')+'</p>':'');
  $('#file-count').textContent=`${visible.length} 项`;
 }
 function shell(){
  const parts=current.slice(9).split('/').filter(Boolean);
  host.innerHTML=`<div class="explorer-toolbar"><button data-up aria-label="上一级" ${current===ROOT?'disabled':''}>←</button><div class="path"><button data-nav="viking://">viking://</button>${parts.map((p,i)=>`<button data-nav="${esc(ROOT+parts.slice(0,i+1).join('/'))}">${esc(p)}</button>${i<parts.length-1?'<span>/</span>':''}`).join('')}</div><button data-reload aria-label="刷新目录">↻</button></div><form class="uri-form"><input aria-label="目录路径" value="${esc(current)}" spellcheck="false"><button>前往</button></form><div class="explorer-layout"><aside class="tree-pane"><div class="pane-title">目录</div><div id="tree"></div></aside><section class="files-pane"><div class="file-controls"><input id="file-filter" type="search" aria-label="筛选当前目录" placeholder="筛选文件" value="${esc(filter)}"><label><input id="show-hidden" type="checkbox" ${hidden?'checked':''}>显示隐藏文件</label><select id="file-sort" aria-label="排序"><option value="name">名称 A–Z</option><option value="reverse" ${sort==='reverse'?'selected':''}>名称 Z–A</option></select></div><div class="pane-title"><span>${esc(parts.at(-1)||'OpenViking')}</span><span id="file-count"></span></div><div id="listing" class="listing">正在读取…</div></section><section class="preview" id="preview"><div class="empty">选择文件查看内容</div></section></div>`;
  tree();
 }
 async function navigate(uri,{refresh=false}={}){
  if(disposed)return;current=uri;selected=null;filter='';count=100;previewGeneration++;const gen=++generation;shell();
  let p=uri;while(p!==ROOT){expanded.add(p);p=parentURI(p);}expanded.add(ROOT);
  try{
   const r=await call('list_directory',{uri});if(disposed||gen!==generation)return;
   items=parseEntries(r,uri);cache.set(uri,items);tree();listing();
   $('#preview').innerHTML=`<div class="preview-heading"><h2>${esc(uri===ROOT?'OpenViking':uri.split('/').pop())}</h2><span class="muted">${items.filter(x=>x.dir).length} 个目录 · ${items.filter(x=>!x.dir).length} 个文件</span></div><div class="preview-tabs"><button data-level="abstract">L0 摘要</button><button data-level="overview">L1 概览</button></div><div class="empty">选择文件查看内容，或查看目录概览。</div>`;
  }catch(e){if(!disposed&&gen===generation)$('#listing').innerHTML=`<p role="alert">${esc(e.message)}</p><button data-reload>重试</button>`;}
 }
 function preview(){
  if(!$('#preview')||!selected)return;
  const isMd=/\.(md|markdown|mdx)$/i.test(selected.uri),isJson=/\.(json|jsonl|ndjson)$/i.test(selected.uri);
  let shown=previewText;
  if(isJson&&mode==='preview'){try{shown=JSON.stringify(JSON.parse(shown),null,2);}catch{}}
  const media=blocks.filter(x=>(x.type==='image'&&/^image\/(png|jpeg|gif|webp)$/.test(x.mimeType))||(x.type==='audio'&&/^audio\/(wav|mpeg|mp3|ogg)$/.test(x.mimeType))).map(x=>x.type==='image'?`<img class="file-image" alt="${esc(selected.name)}" src="data:${esc(x.mimeType)};base64,${esc(x.data)}">`:`<audio controls src="data:${esc(x.mimeType)};base64,${esc(x.data)}"></audio>`).join('');
  $('#preview').innerHTML=`<div class="preview-heading"><h2>${esc(selected.name)}</h2><div class="muted file-uri">${esc(selected.uri)}</div></div><div class="preview-tabs">${isMd||isJson?`<button data-mode="preview" aria-pressed="${mode==='preview'}">预览</button><button data-mode="source" aria-pressed="${mode==='source'}">源码</button>`:''}<button data-copy>复制路径</button></div><div class="preview-content">${media}${isMd&&mode==='preview'?`<article class="markdown-body">${markdown(shown)}</article>`:`<pre>${esc(shown)}</pre>`}${!media&&!shown?'<p class="muted">没有更多内容。</p>':''}</div>${hasMore?'<button class="load-more" data-more-file>继续读取</button>':''}`;
  $('#preview').querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
 }
 async function read(entry,more=false){
  selected=entry;mode=more?mode:'preview';level='content';const gen=++previewGeneration;if(!more){previewText='';blocks=[];offset=0;}loading=true;
  $('#preview').innerHTML=`<p class="muted">正在读取 ${esc(entry.name)}…</p>`;listing();
  try{
   const r=await call('read_file',{uri:entry.uri,offset});if(disposed||gen!==previewGeneration)return;
   const part=content(r);previewText+=(more&&previewText&&!previewText.endsWith('\n')?'\n':'')+part;blocks.push(...(r.content||[]).filter(x=>x.type!=='text'));offset+=200;
   // A full page may end at EOF. Only offer another bounded read; never imply completeness.
   hasMore=part.replace(/\n$/,'').split('\n').length>=200&&!!part;preview();
  }catch(e){if(!disposed&&gen===previewGeneration)$('#preview').innerHTML=`<p role="alert">${esc(e.message)}</p><button data-retry-file>重试</button>`;}
  finally{if(gen===previewGeneration)loading=false;}
 }
 async function summary(kind){
  const entry={name:kind==='abstract'?'L0 摘要':'L1 概览',uri:join(current,kind==='abstract'?'.abstract.md':'.overview.md')};await read(entry);level=kind;
 }
 async function loadTree(){
  try{const result=await call('tree_directory',{uri:ROOT});if(disposed)return;const parsed=parseTree(result,ROOT);for(const [u,entries] of parsed.map){if(!cache.has(u))cache.set(u,entries);}tree();}catch{/* Listing is authoritative; tree capability is optional on older cloud endpoints. */}
 }
 host.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();const uri=host.querySelector('.uri-form input').value.trim();if(uri.startsWith(ROOT))navigate(uri);else host.querySelector('.uri-form input').setCustomValidity('请输入 viking:// 路径');});
 host.addEventListener('input',e=>{if(e.target.id==='file-filter'){filter=e.target.value;count=100;listing();}else e.target.setCustomValidity?.('');});
 host.addEventListener('change',e=>{if(e.target.id==='show-hidden'){hidden=e.target.checked;listing();}if(e.target.id==='file-sort'){sort=e.target.value;listing();}});
 host.addEventListener('click',async e=>{
  const link=e.target.closest('a');if(link){const href=link.getAttribute('href')||'';if(href.startsWith(ROOT)||(!/^[a-z][a-z\d+.-]*:/i.test(href)&&!href.startsWith('#'))){e.preventDefault();e.stopPropagation();const uri=href.startsWith(ROOT)?href:join(parentURI(selected.uri),href);await open(uri);}return;}
  const b=e.target.closest('button');if(!b)return;e.stopPropagation();const d=b.dataset;
  if(d.nav)await navigate(d.nav);
  if('up'in d)await navigate(parentURI(current));
  if('reload'in d){cache.clear();await navigate(current,{refresh:true});loadTree();}
  if(d.tree){const wasOpen=expanded.has(d.tree);if(wasOpen&&current===d.tree){expanded.delete(d.tree);tree();}else{expanded.add(d.tree);await navigate(d.tree);}}
  if(d.entry){const x=items.find(x=>x.uri===d.entry);if(x?.dir)await navigate(x.uri);else if(x)await read(x);}
  if('load'in d){count+=100;listing();}
  if(d.level)await summary(d.level);
  if(d.mode){mode=d.mode;preview();}
  if('moreFile'in d&&!loading)await read(selected,true);
  if('retryFile'in d)await read(selected);
  if('copy'in d){try{await navigator.clipboard.writeText(selected.uri);b.textContent='已复制';}catch{b.textContent='请复制上方路径';}}
 });
 async function open(uri){const parent=parentURI(uri);await navigate(parent);if(!disposed)await read({uri,name:uri.split('/').pop()});}
 return {async mount(uri=ROOT){await navigate(uri);await loadTree();},open,dispose(){disposed=true;generation++;previewGeneration++;}};
}
