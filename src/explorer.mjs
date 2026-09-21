import {createElement,Folder,FolderOpen,FileText,ChevronRight,ChevronDown,ArrowLeft,RotateCw} from 'lucide';
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
export function markdown(text){return DOMPurify.sanitize(marked.parse(text,{gfm:true}),{FORBID_TAGS:['img','style','iframe','form','input','button'],ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|viking):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i});}
export function createExplorer({host,call}){
 let current=ROOT,selected=null,selection=0,disposed=false,cache=new Map(),expanded=new Set([ROOT]),pending=new Map(),errors=new Map(),hidden=true,level='abstract',mode='preview',documents={};
 const $=q=>host.querySelector(q);
 const icon=node=>createElement(node,{'aria-hidden':'true',width:16,height:16,'stroke-width':1.7}).outerHTML;
 const order=(a,b)=>{const rank=x=>x.uri==='viking://user'?0:x.uri==='viking://resources'?1:2;return rank(a)-rank(b)||Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name);};
 function rows(uri,depth=0){return (cache.get(uri)||[]).filter(x=>hidden||!x.name.startsWith('.')).sort(order).map(x=>`<div role="treeitem" aria-selected="${selected?.uri===x.uri}" ${x.dir?`aria-expanded="${expanded.has(x.uri)}"`:''}><div class="tree-row ${selected?.uri===x.uri?'selected':''}" style="padding-left:${8+depth*16}px">${x.dir?`<button class="tree-toggle" data-toggle="${esc(x.uri)}" aria-label="${expanded.has(x.uri)?'收起':'展开'} ${esc(x.name)}">${icon(expanded.has(x.uri)?ChevronDown:ChevronRight)}</button>`:'<span class="tree-spacer"></span>'}<button class="tree-entry" data-entry="${esc(x.uri)}" title="${esc(x.uri)}">${icon(x.dir?(expanded.has(x.uri)?FolderOpen:Folder):FileText)}<span>${esc(x.name)}</span></button></div>${x.dir&&expanded.has(x.uri)?`<div role="group">${rows(x.uri,depth+1)}${pending.has(x.uri)?'<div class="tree-status">读取中…</div>':''}${errors.has(x.uri)?`<button class="tree-status" data-retry-tree="${esc(x.uri)}">${esc(errors.get(x.uri))} · 重试</button>`:''}${cache.has(x.uri)&&!cache.get(x.uri).length?'<div class="tree-status">空目录</div>':''}</div>`:''}</div>`).join('');}
 function tree(){if($('#tree'))$('#tree').innerHTML=rows(ROOT)+(errors.has(ROOT)?`<button data-retry-tree="${ROOT}">${esc(errors.get(ROOT))} · 重试</button>`:'');}
 function toolbar(){const parts=current.slice(9).split('/').filter(Boolean);$('.path').innerHTML=`<button data-nav="${ROOT}">viking://</button>`+parts.map((p,i)=>`${i?'<span>/</span>':''}<button data-nav="${esc(ROOT+parts.slice(0,i+1).join('/'))}">${esc(p)}</button>`).join('');$('.uri-form input').value=current;$('[data-up]').disabled=current===ROOT;}
 function shell(){host.innerHTML=`<div class="explorer-toolbar"><button data-up aria-label="上一级">${icon(ArrowLeft)}</button><div class="path"></div><button data-reload aria-label="刷新目录">${icon(RotateCw)}</button></div><form class="uri-form"><input aria-label="目录路径" spellcheck="false"><button>前往</button></form><div class="explorer-layout"><aside class="tree-pane"><div class="pane-title"><span>目录</span><label><input id="show-hidden" type="checkbox" checked>隐藏文件</label></div><div id="tree" role="tree" aria-label="OpenViking 目录"></div></aside><section class="preview" id="preview" aria-label="内容预览"></section></div>`;toolbar();tree();}
 async function children(uri,refresh=false){
  if(!refresh&&cache.has(uri)){tree();return cache.get(uri);}
  if(pending.has(uri)){tree();return pending.get(uri);}
  const task=(async()=>{try{const result=await call('list_directory',{uri});if(disposed)return [];const entries=parseEntries(result,uri);cache.set(uri,entries);errors.delete(uri);return entries;}catch(e){if(!disposed)errors.set(uri,e.message);return [];}finally{pending.delete(uri);if(!disposed)tree();}})();pending.set(uri,task);tree();return task;
 }
 const activeDoc=()=>documents[selected?.dir?level:'content'];
 function preview(){
  if(disposed||!selected)return;
  const doc=activeDoc(),isDir=selected.dir;
  let body='';
  if(!doc||doc.loading&&!doc.text)body='<p class="muted">正在读取…</p>';
  else if(mode==='path')body=`<div class="path-view"><code>${esc(doc.uri)}</code><button data-copy>复制路径</button></div>`;
  else if(doc.error)body=`<p role="alert">${esc(doc.error)}</p><button data-retry-file>重试</button>`;
  else{
   let shown=doc.text;if(isDir&&mode==='preview')shown=shown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'');const md=/\.(md|markdown|mdx)$/i.test(doc.uri),json=/\.(json|jsonl|ndjson)$/i.test(doc.uri);
   if(json&&mode==='preview')try{shown=JSON.stringify(JSON.parse(shown),null,2);}catch{}
   const media=mode==='preview'?doc.blocks.filter(x=>(x.type==='image'&&/^image\/(png|jpeg|gif|webp)$/.test(x.mimeType))||(x.type==='audio'&&/^audio\/(wav|mpeg|mp3|ogg)$/.test(x.mimeType))).map(x=>x.type==='image'?`<img class="file-image" alt="${esc(selected.name)}" src="data:${esc(x.mimeType)};base64,${esc(x.data)}">`:`<audio controls src="data:${esc(x.mimeType)};base64,${esc(x.data)}"></audio>`).join(''):'';
   body=media+(md&&mode==='preview'?`<article class="markdown-body">${markdown(shown)}</article>`:`<pre>${esc(shown)}</pre>`)+(!shown&&!media?'<p class="muted">暂无内容</p>':'')+(doc.more?`<button class="load-more" data-more-file ${doc.loading?'disabled':''}>${doc.loading?'读取中…':'继续读取'}</button>`:'');
  }
  $('#preview').innerHTML=`<div class="preview-heading"><h2>${icon(isDir?Folder:FileText)}${esc(selected.name)}</h2></div>${isDir?`<div class="preview-tabs level-tabs" role="tablist" aria-label="目录内容"><button role="tab" data-level="abstract" aria-selected="${level==='abstract'}">摘要 <span>L0</span></button><button role="tab" data-level="overview" aria-selected="${level==='overview'}">概览 <span>L1</span></button></div>`:''}<div class="preview-tabs view-tabs" role="tablist" aria-label="查看方式">${[['preview','预览'],['source','源码'],['path','路径']].map(([value,label])=>`<button role="tab" data-mode="${value}" aria-selected="${mode===value}">${label}</button>`).join('')}</div><div class="preview-content" role="tabpanel">${isDir&&errors.has(selected.uri)?`<p role="alert">${esc(errors.get(selected.uri))}</p>`:''}${body}</div>`;
  $('#preview').querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});
 }
 async function readDoc(key,uri,gen,more=false){
  const doc=more?documents[key]:{uri,text:'',blocks:[],offset:0,more:false};documents[key]=doc;doc.loading=true;doc.error='';preview();
  try{const r=await call('read_file',{uri,offset:doc.offset});if(disposed||gen!==selection)return;const raw=content(r);const part=selected.dir&&/^\(nothing found at [^\n]+\)\s*$/.test(raw)?'':raw;doc.text+=(more&&doc.text&&!doc.text.endsWith('\n')?'\n':'')+part;doc.blocks.push(...(r.content||[]).filter(x=>x.type!=='text'));doc.offset+=200;doc.more=!!part&&part.replace(/\n$/,'').split('\n').length>=200;
  }catch(e){if(disposed||gen!==selection)return;doc.error=e.message;}finally{doc.loading=false;if(!disposed&&gen===selection)preview();}
 }
 async function select(entry,{refresh=false}={}){
  if(disposed)return;const gen=++selection;selected=entry;current=entry.dir?entry.uri:parentURI(entry.uri);documents={};mode='preview';level='abstract';
  let p=current;while(p!==ROOT){expanded.add(p);p=parentURI(p);}toolbar();tree();preview();
  if(entry.dir)await Promise.all([children(entry.uri,refresh),readDoc('abstract',join(entry.uri,'.abstract.md'),gen),readDoc('overview',join(entry.uri,'.overview.md'),gen)]);
  else await readDoc('content',entry.uri,gen);
  if(!disposed&&gen===selection)preview();
 }
 async function navigate(uri,options){await select({uri,name:uri===ROOT?'OpenViking':uri.split('/').pop(),dir:true},options);}
 async function reveal(uri){const ancestors=[];let p=parentURI(uri);while(p!==ROOT){ancestors.unshift(p);p=parentURI(p);}await children(ROOT);for(const ancestor of ancestors){expanded.add(ancestor);await children(ancestor);}tree();}
 async function open(uri){await reveal(uri);if(disposed)return;const entry=(cache.get(parentURI(uri))||[]).find(x=>x.uri===uri);await select(entry||{uri,name:uri.split('/').pop(),dir:false});}
 async function loadTree(){try{const r=await call('tree_directory',{uri:ROOT});if(disposed)return;const parsed=parseTree(r,ROOT);if(!cache.has(ROOT))cache.set(ROOT,parsed.map.get(ROOT)||[]);tree();}catch{/* list remains authoritative, including the canonical user identity. */}}
 host.addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();const input=$('.uri-form input'),uri=input.value.trim();if(uri.startsWith(ROOT)){const value=uri===ROOT?ROOT:uri.replace(/\/$/,'');await reveal(value);await navigate(value);}else input.setCustomValidity('请输入 viking:// 路径');});
 host.addEventListener('input',e=>e.target.setCustomValidity?.(''));
 host.addEventListener('change',e=>{if(e.target.id==='show-hidden'){hidden=e.target.checked;tree();}});
 host.addEventListener('click',async e=>{
  const link=e.target.closest('a');if(link){const href=link.getAttribute('href')||'';if(href.startsWith(ROOT)||(!/^[a-z][a-z\d+.-]*:/i.test(href)&&!href.startsWith('#'))){e.preventDefault();e.stopPropagation();await open(href.startsWith(ROOT)?href:join(parentURI(activeDoc().uri),href));}return;}
  const b=e.target.closest('button');if(!b)return;e.stopPropagation();const d=b.dataset;
  if(d.nav)await navigate(d.nav);
  if('up'in d)await navigate(parentURI(current));
  if('reload'in d){const entry=selected;await children(current,true);if(entry)await select(entry);}
  if(d.toggle){if(expanded.has(d.toggle)){expanded.delete(d.toggle);tree();}else{expanded.add(d.toggle);await children(d.toggle);}}
  if(d.entry){const entry=(cache.get(parentURI(d.entry))||[]).find(x=>x.uri===d.entry);if(entry)await select(entry);}
  if(d.retryTree)await children(d.retryTree,true);
  if(d.level){level=d.level;mode='preview';preview();}
  if(d.mode){mode=d.mode;preview();}
  if('moreFile'in d&&!activeDoc()?.loading)await readDoc(selected.dir?level:'content',activeDoc().uri,selection,true);
  if('retryFile'in d)await readDoc(selected.dir?level:'content',activeDoc().uri,selection);
  if('copy'in d){try{await navigator.clipboard.writeText(activeDoc().uri);b.textContent='已复制';}catch{b.textContent='请复制路径';}}
 });
 return {async mount(uri=ROOT){shell();const previewTask=navigate(uri),treeTask=loadTree();await children(ROOT);if(disposed)return;if((cache.get(ROOT)||[]).some(x=>x.uri==='viking://user')){expanded.add('viking://user');const users=await children('viking://user');for(const user of users){expanded.add(user.uri);await children(user.uri);}tree();}await Promise.all([previewTask,treeTask]);},open,dispose(){disposed=true;selection++;}};
}
