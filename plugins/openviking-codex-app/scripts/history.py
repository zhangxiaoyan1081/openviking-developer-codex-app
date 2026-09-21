"""Import an explicit, approved export; never scans private host session files."""
import argparse,hashlib,json,sys,fcntl
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import cloud,connection

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
    ctx=result(cloud.request('/api/v1/sessions/'+quote(sid,safe='')+'/context'))
    row.update(status='available' if ctx.get('latest_archive_overview') else 'no_overview',overview=ctx.get('latest_archive_overview',''),stats=ctx.get('stats',{}),activeMessageCount=len(ctx.get('messages',[])))
   except cloud.CloudError:row.update(status='unavailable',overview='')
  rows.append(row)
 return {'sessions':rows,'coverage':{'selected':len(rows),'withOverview':sum(x['status']=='available' for x in rows)}}

def status(plan):
 state=cloud.load('imports/'+digest(plan)+'.json',{'items':{}})
 for item in state['items'].values():
  task=item.get('receipt',{}).get('task_id')
  if task:
   try:item['task']=result(cloud.request('/api/v1/tasks/'+quote(task,safe='')))
   except cloud.CloudError:item['task']={'status':'unknown'}
 return state
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('action',choices=['plan','apply','collect','status']);ap.add_argument('file');ap.add_argument('--confirm');a=ap.parse_args()
 try:
  plan=validate(json.loads(Path(a.file).read_text()))
  output={'planHash':digest(plan),'sessionCount':len(plan['sessions']),'titles':[s.get('title',s['source_id']) for s in plan['sessions']]} if a.action=='plan' else apply(plan,a.confirm) if a.action=='apply' else collect(plan) if a.action=='collect' else status(plan)
  print(json.dumps(output,ensure_ascii=False,indent=2))
 except (ValueError,KeyError,cloud.CloudError) as e:print(str(e),file=sys.stderr);sys.exit(1)
