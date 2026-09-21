"""Import an explicit, approved export; never scans private host session files."""
import argparse,hashlib,json,sys,fcntl,time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import cloud,connection,onboarding

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def result(value):return value.get('result',value)
def validate(plan):
 if not isinstance(plan,dict) or not isinstance(plan.get('sessions'),list) or not plan['sessions']:raise ValueError('请选择会话。')
 seen=set()
 for s in plan['sessions']:
  if not s.get('source_id') or s['source_id'] in seen:raise ValueError('来源标识缺失或重复。')
  seen.add(s['source_id'])
  if not isinstance(s['source_id'],str):raise ValueError('来源标识需要是字符串。')
  if not s.get('existing_session_id'):
   if not s.get('ended') or not s.get('capture_checked'):raise ValueError('请先核对会话已结束及官方插件的同步记录。')
   if not s.get('messages'):raise ValueError('会话内容为空。')
   message_ids=set()
   for m in s['messages']:
    if m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) or not m.get('source_message_id'):raise ValueError('消息缺少角色、正文或来源标识。')
    if m['source_message_id'] in message_ids:raise ValueError('消息来源标识重复。')
    message_ids.add(m['source_message_id'])
    if datetime.fromisoformat(m['created_at'].replace('Z','+00:00')).tzinfo is None:raise ValueError('消息时间需要包含时区。')
 return plan

def apply(plan,confirmation):
 connection.require_ready()
 validate(plan);key=digest(plan)
 if confirmation!=key:raise ValueError('导入范围已变化，请重新确认。')
 review=cloud.load('review.json')
 if review and (review.get('hash')!=key or not review.get('confirmed')):raise ValueError('清单已变化或尚未确认，请核对后再同步。')
 cloud.save('imports/'+key+'.plan.json',plan)
 cloud.save('active-import.json',{'hash':key,'sources':[{'id':s['source_id'],'title':s.get('title',s['source_id'])} for s in plan['sessions']]})
 root=cloud.folder();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(root/'import.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  name='imports/'+key+'.json';state=cloud.load(name,{'planHash':key,'items':{}})
  ledger=cloud.load('import-ledger.json',{})
  def persist():
   cloud.save('import-ledger.json',ledger);cloud.save(name,state)
  for s in plan['sessions']:
   fingerprint=digest(s)
   previous=ledger.get(s['source_id'])
   if previous and previous.get('fingerprint')!=fingerprint:raise ValueError('同一会话的来源内容已变化，请先核对已有导入。')
   item=previous or state['items'].setdefault(s['source_id'],{'fingerprint':fingerprint,'session_id':s.get('existing_session_id') or 'ovp-'+digest(s['source_id'])[:28],'batches':0,'state':'pending'})
   ledger[s['source_id']]=item;state['items'][s['source_id']]=item
   persist()
   if item['state'] in ('submitted','reused'):continue
   if item['state']=='unknown':raise ValueError('上次请求结果未知，请核对云端记录后继续。')
   if s.get('existing_session_id'):
    result(cloud.request('/api/v1/sessions/'+quote(item['session_id'],safe='')+'/context'))
    item['state']='reused';persist();continue
   sid=quote(item['session_id'],safe='')
   if item['state']=='pending':
    item['state']='unknown';persist()
    result(cloud.request('/api/v1/sessions',{'session_id':item['session_id']}))
    item['state']='created';persist()
   messages=[{'role':m['role'],'content':m['content'],'created_at':m['created_at'],'source_message_ids':[m['source_message_id']],**({'peer_id':s['peer_id']} if s.get('peer_id') else {})} for m in s['messages']]
   for start in range(item['batches']*100,len(messages),100):
    item['state']='unknown';persist()
    result(cloud.request('/api/v1/sessions/'+sid+'/messages/batch',{'messages':messages[start:start+100]}))
    item['batches']+=1;item['state']='created';persist()
   item['state']='unknown';persist()
   receipt=result(cloud.request('/api/v1/sessions/'+sid+'/commit',{'keep_recent_count':0}))
   item.update(state='submitted',receipt=receipt);persist()
  return state

def collect(plan):
 validate(plan);receipt=cloud.load('imports/'+digest(plan)+'.json',{'items':{}});rows=[]
 for s in plan['sessions']:
  sid=s.get('existing_session_id') or receipt['items'].get(s['source_id'],{}).get('session_id')
  row={'source_id':s['source_id'],'title':s.get('title',''),'project':s.get('project',''),'session_id':sid,'archive_id':None}
  if not sid:row.update(status='not_imported',overview='')
  else:
   try:
    item=receipt['items'].get(s['source_id'],{})
    archive=item.get('receipt',{}).get('archive_uri')
    if archive and item.get('task',{}).get('status')=='completed':
     row['archive_id']=archive.rstrip('/').split('/')[-1]
     ctx=result(cloud.request('/api/v1/sessions/'+quote(sid,safe='')+'/archives/'+quote(row['archive_id'],safe='')))
     overview=ctx.get('overview','')
    else:
     ctx=result(cloud.request('/api/v1/sessions/'+quote(sid,safe='')+'/context'))
     # A newly imported session must not claim an older overview as this commit.
     overview=ctx.get('latest_archive_overview','') if not archive else ''
    row.update(status='available' if overview else 'no_overview',overview=overview,stats=ctx.get('stats',{}),activeMessageCount=len(ctx.get('messages',[])))
   except cloud.CloudError:row.update(status='unavailable',overview='')
  rows.append(row)
 return {'sessions':rows,'coverage':{'selected':len(rows),'withOverview':sum(x['status']=='available' for x in rows)}}

def status(plan,limit=3):
 connection.require_ready();validate(plan)
 key=digest(plan);name='imports/'+key+'.json'
 state=cloud.load(name,{'items':{}});updates={}
 # Oldest checked first, at most three calls per request; never holds the write lock during I/O.
 candidates=sorted(state['items'].items(),key=lambda pair:pair[1].get('checkedAt',''))
 count=0
 for source,item in candidates:
  task=item.get('receipt',{}).get('task_id')
  if task and item.get('task',{}).get('status') not in ('completed','failed','cancelled') and count<limit:
   count+=1
   try:item['task']=result(cloud.request('/api/v1/tasks/'+quote(task,safe=''),timeout=8))
   except cloud.CloudError:item['task']={'status':'unknown'}
   updates[source]={'task':item['task'],'checkedAt':onboarding.now()}
  elif not task and item.get('receipt',{}).get('status')=='skipped':
   updates[source]={'task':{'status':'skipped'},'checkedAt':onboarding.now()}
 root=cloud.folder();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(root/'import.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  latest=cloud.load(name,{'items':{}})
  ledger=cloud.load('import-ledger.json',{})
  for source,update in updates.items():
   if source in latest['items']:latest['items'][source].update(update)
   if source in ledger:ledger[source].update(update)
  cloud.save('import-ledger.json',ledger)
  cloud.save(name,latest)
 return latest

def verify(plan):
 """Read back the exact archive when completed, otherwise the live context.

 Incomplete/truncated reads remain unverified and never trigger a re-upload.
 """
 connection.require_ready();validate(plan)
 name='imports/'+digest(plan)+'.json';state=cloud.load(name,{'items':{}});updates={}
 for source in plan['sessions']:
  item=state['items'].get(source['source_id'])
  if not item or source.get('existing_session_id'):continue
  sid=quote(item['session_id'],safe='');archive=item.get('receipt',{}).get('archive_uri')
  route='/api/v1/sessions/'+sid+('/archives/'+quote(archive.rstrip('/').split('/')[-1],safe='') if archive and item.get('task',{}).get('status')=='completed' else '/context')
  try:
   remote=result(cloud.request(route,timeout=8)).get('messages',[])
   actual=[(m.get('role'),m.get('content') if isinstance(m.get('content'),str) else ''.join(p.get('text','') for p in m.get('parts',[])),m.get('source_message_ids')) for m in remote]
   expected=[(m['role'],m['content'],[m['source_message_id']]) for m in source['messages']]
   updates[source['source_id']]={'verified':actual==expected,'verifiedAt':onboarding.now()}
  except cloud.CloudError:updates[source['source_id']]={'verified':False,'verifiedAt':onboarding.now()}
 with open(cloud.folder()/'import.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);latest=cloud.load(name,{'items':{}})
  ledger=cloud.load('import-ledger.json',{})
  for source,update in updates.items():
   if source in latest['items']:latest['items'][source].update(update)
   if source in ledger:ledger[source].update(update)
  cloud.save('import-ledger.json',ledger)
  cloud.save(name,latest)
 return {'sessions':updates}

def poll_job(job_id):
 job=cloud.load('active-import.json')
 if not job or job_id!=job['hash']:raise ValueError('同步范围已变化，请刷新。')
 plan=cloud.load('imports/'+job_id+'.plan.json')
 if not plan or digest(plan)!=job_id:raise ValueError('同步计划无法核对。')
 status(plan)
 return onboarding.state()

def wait_status(plan,seconds):
 deadline=time.monotonic()+min(max(seconds,0),30)
 delay=2
 while True:
  value=status(plan)
  if all(i.get('state')=='reused' or i.get('task',{}).get('status') in ('completed','failed','cancelled','skipped') for i in value['items'].values()) or time.monotonic()>=deadline:return value
  time.sleep(min(delay,max(0,deadline-time.monotonic())));delay=min(delay*2,10)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('action',choices=['plan','apply','collect','status','verify']);ap.add_argument('file');ap.add_argument('--confirm');ap.add_argument('--wait',type=float,default=0);a=ap.parse_args()
 try:
  plan=validate(json.loads(Path(a.file).read_text()))
  output={'planHash':digest(plan),'sessionCount':len(plan['sessions']),'titles':[s.get('title',s['source_id']) for s in plan['sessions']]} if a.action=='plan' else apply(plan,a.confirm) if a.action=='apply' else collect(plan) if a.action=='collect' else verify(plan) if a.action=='verify' else wait_status(plan,a.wait)
  print(json.dumps(output,ensure_ascii=False,indent=2))
 except (ValueError,KeyError,cloud.CloudError) as e:print(str(e),file=sys.stderr);sys.exit(1)
