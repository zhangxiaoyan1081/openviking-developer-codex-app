"""Read-only index of the current user's latest archive L1, shared by App and panel."""
import concurrent.futures,fcntl,json,os,re,subprocess,sys,time,uuid
from pathlib import Path
from urllib.parse import urlencode
import cloud
ALL_NODES=2147483647

def load(path,default):
 try:return json.loads(path.read_text())
 except (FileNotFoundError,ValueError):return default

def root(config):return 'viking://user/'+(config.get('user') or config.get('user_id') or 'default')+'/sessions'
def request(config,path,**args):return cloud.request(path+'?'+urlencode(args),config=config,timeout=20).get('result')
def listing(config,uri):
 result=request(config,'/api/v1/fs/ls',uri=uri,output='original',show_all_hidden='true',node_limit=ALL_NODES)
 if not isinstance(result,list):raise cloud.CloudError('无法读取会话目录，请重试。')
 return result

def direct(entry,parent):
 uri=entry.get('uri','').rstrip('/')
 return bool(entry.get('isDir') and uri.startswith(parent+'/') and '/' not in uri[len(parent)+1:] and cloud.browse_uri(uri))

def fields(body,fallback):
 sections={};key=None;lines=[]
 for line in body.splitlines():
  match=re.match(r'^##\s+(.+?)\s*#*\s*$',line)
  if match:
   if key:sections[key]='\n'.join(lines).strip()
   key=match[1].strip().lower();lines=[]
  elif key:lines.append(line)
 if key:sections[key]='\n'.join(lines).strip()
 title=sections.get('session title') or sections.get('会话标题') or fallback
 state=sections.get('current state') or sections.get('当前状态') or sections.get('当前进展') or ''
 def plain(value):
  # L1 often wraps entire fields in Markdown emphasis. Keep card text readable.
  return re.sub(r'^(\*\*|__|\*|_|`)([\s\S]+)\1$',r'\2',value.strip())
 return plain(title),plain(state)

def session_row(config,entry,base):
 uri=entry['uri'].rstrip('/');sid=uri.rsplit('/',1)[-1]
 row={'id':sid,'sessionUri':uri,'title':sid,'state':'','status':'pending','updatedAt':None,'overviewUri':None}
 try:
  contents=listing(config,uri)
  history=uri+'/history'
  if not any(x.get('uri','').rstrip('/')==history and x.get('isDir') for x in contents):
   row['status']='no_archive';return row
  archives=[x for x in listing(config,history) if direct(x,history) and re.fullmatch(r'archive_\d+',x['uri'].rstrip('/').rsplit('/',1)[-1])]
  if not archives:row['status']='no_archive';return row
  latest=max(archives,key=lambda x:int(x['uri'].rstrip('/').rsplit('_',1)[-1]))['uri'].rstrip('/')
  target=latest+'/.overview.md';row['overviewUri']=target
  stat=request(config,'/api/v1/fs/stat',uri=target)
  if not isinstance(stat,dict):raise cloud.CloudError('概览暂时无法读取。')
  # Never substitute session or archive directory mtime for the L1 file mtime.
  row['updatedAt']=stat.get('modTime') or None
  import hashlib
  cache=base/(hashlib.sha256(uri.encode()).hexdigest()+'.json')
  previous=load(cache,{})
  if row['updatedAt'] and previous.get('overviewUri')==target and previous.get('updatedAt')==row['updatedAt'] and isinstance(previous.get('overview'),str):body=previous['overview']
  else:
   body=request(config,'/api/v1/content/read',uri=target,limit=-1)
   if not isinstance(body,str):raise cloud.CloudError('概览暂时无法读取。')
  if not body.strip():row['status']='no_overview';return row
  row['title'],row['state']=fields(body,sid);row['status']='ready'
  cloud.atomic(cache,{**row,'overview':body});return row
 except (cloud.CloudError,ValueError,KeyError):
  row['status']='unavailable';return row

def scan(identity,job):
 config=cloud.credentials();base=cloud.folder()/'session-progress'
 if base.parent.name!=identity:return
 path=base/'index.json';index=load(path,{})
 if index.get('job')!=job:return
 def save():
  if load(path,{}).get('job')!=job:return False
  index['checkedAt']=time.time();cloud.atomic(path,index);return True
 try:
  parent=root(config)
  entries=[x for x in listing(config,parent) if direct(x,parent)]
  index.update(total=len(entries),done=0,rows=[],error=None)
  if not save():return
  # A bounded queue avoids one Future per session for very large libraries.
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   iterator=iter(entries);pending={}
   def submit():
    e=next(iterator,None)
    if e is not None:pending[pool.submit(session_row,config,e,base)]=e
   for _ in range(4):submit()
   last_save=time.monotonic()
   while pending:
    completed,_=concurrent.futures.wait(pending,timeout=5,return_when=concurrent.futures.FIRST_COMPLETED)
    for future in completed:
     entry=pending.pop(future)
     try:row=future.result()
     except Exception:row={'id':entry['uri'].rsplit('/',1)[-1],'title':entry['uri'].rsplit('/',1)[-1],'state':'','status':'unavailable','updatedAt':None,'overviewUri':None,'sessionUri':entry['uri']}
     index['rows'].append(row);index['done']+=1;submit()
    if time.monotonic()-last_save>=1 or index['done']==len(entries):
     if not save():return
     last_save=time.monotonic()
  index['status']='complete';save()
 except Exception:
  index.update(status='failed',error='会话读取未完成，请重试。');save()

def page(value):
 base=cloud.folder()/'session-progress';base.mkdir(parents=True,exist_ok=True,mode=0o700);path=base/'index.json'
 with (base/'scan.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  index=load(path,{})
  running=index.get('status')=='running' and time.time()-index.get('checkedAt',0)<120
  # Reopening refreshes the inventory; existing L1 content is reused only after stat.
  if not running and (not index or value.get('refresh')):
   job=uuid.uuid4().hex
   index={'job':job,'status':'running','total':None,'done':0,'rows':index.get('rows',[]),'checkedAt':time.time()}
   cloud.atomic(path,index)
   subprocess.Popen([sys.executable,__file__,'scan',base.parent.name,job],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  elif index.get('status')=='running' and not running:
   index.update(status='failed',error='读取已中断，请刷新重试。');cloud.atomic(path,index)
 rows=index.get('rows',[]);query=str(value.get('query','')).strip().casefold()[:200]
 filtered=[r for r in rows if not query or query in (r['title']+'\n'+r.get('state','')).casefold()]
 filtered.sort(key=lambda x:(x.get('updatedAt') or '',x['id']),reverse=True)
 offset=max(0,int(value.get('offset',0)));limit=20
 return {**{k:v for k,v in index.items() if k!='rows'},'items':filtered[offset:offset+limit],'matched':len(filtered),'offset':offset,'limit':limit,'ready':sum(r['status']=='ready' for r in rows),'unavailable':sum(r['status']=='unavailable' for r in rows)}

def detail(value):
 uri=cloud.browse_uri(value['uri']);config=cloud.credentials();parent=root(config)
 relative=uri[len(parent)+1:] if uri.startswith(parent+'/') else ''
 if not re.fullmatch(r'[^/]+/history/archive_\d+/\.overview\.md',relative):raise ValueError('请选择会话归档概览。')
 body=request(config,'/api/v1/content/read',uri=uri,limit=-1)
 if not isinstance(body,str):raise cloud.CloudError('概览暂时无法读取。')
 return {'uri':uri,'overview':body}

if __name__=='__main__' and len(sys.argv)==4 and sys.argv[1]=='scan':scan(sys.argv[2],sys.argv[3])
