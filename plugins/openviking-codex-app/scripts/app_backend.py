"""MCP App adapter. Never return credentials or transcripts to the UI."""
import json,sys,re
from pathlib import Path
from datetime import datetime,timezone
import cloud,history,panel,connection,onboarding,workspace

def state():
 c=connection.status()
 empty={'configured':c['canReuse'],'connection':c,'scope':None,'plan':None,'reports':[],'workspace':{'works':[]}}
 if not c['ready']:return empty
 return {**empty,'scope':cloud.load('scope.json'),'plan':cloud.load('review.json'),'workspace':cloud.load('workspace.json',{'works':[]}), 'reports':cloud.load('reports.json',[]),'onboarding':onboarding.state()}

def dispatch(action,value):
 if action=='state':return state()
 if action=='connect_existing':
  connection.select(revision=value['revision']);return state()
 if action=='connect_key':
  connection.select(revision=value['revision'],api_key=value['api_key']);return state()
 connection.require_ready()
 if action=='rules_prepare':onboarding.prepare_rules(value);return state()
 if action=='rules_choose':onboarding.choose_rules(value);return state()
 if action=='next':onboarding.choose_next(value);return state()
 if action=='import_status':history.poll_job(value['jobId']);return state()
 if action=='publish_work':workspace.publish(value);return state()
 if action=='scope':
  if onboarding.rules_public()['status']!='active':raise ValueError('请先核对协作方式。')
  selected=panel.scope(value);cloud.save('scope.json',selected);cloud.save('review.json',None)
  cloud.save('active-import.json',None);cloud.save('onboarding.json',{k:v for k,v in cloud.load('onboarding.json',{}).items() if k=='capabilities'})
  return state()
 if action=='review':
  plan=history.validate(json.loads(Path(value['path']).read_text()))
  preview={'hash':history.digest(plan),'coverage':value['coverage'],'items':[{'title':s.get('title',s['source_id']),'project':s.get('project',''),'source':s['source_id'],'messages':len(s.get('messages',[])),'reuse':bool(s.get('existing_session_id'))} for s in plan['sessions']], 'confirmed':False}
  cloud.save('review.json',preview);return state()
 if action=='confirm':
  plan=cloud.load('review.json')
  if not plan or plan['hash']!=value['hash']:raise ValueError('清单已更新，请重新查看。')
  plan['confirmed']=True;cloud.save('review.json',plan);return state()
 if action=='list':return cloud.rpc('list',{'uri':cloud.personal_uri(value['uri'])})
 if action=='read':
  uri=cloud.personal_uri(value['uri']);offset=int(value.get('offset',0))
  if offset<0:raise ValueError('读取位置无效。')
  return cloud.rpc('read',{'uris':[uri],'offset':offset,'limit':200})
 if action=='publish_report':
  r=value
  if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',r['id']):raise ValueError('报告标识无效。')
  if r['kind'] not in ('progress','daily','weekly','insight'):raise ValueError('报告类型无效。')
  for key in ('title','period','body','coverage'):
   if not isinstance(r.get(key),str) or not r[key].strip():raise ValueError('报告需要正文、时间范围和覆盖说明。')
  if not r.get('sources'):raise ValueError('报告需要来源。')
  for s in r['sources']:cloud.personal_uri(s['uri'])
  r['updatedAt']=datetime.now(timezone.utc).isoformat()
  reports=cloud.load('reports.json',[]);reports=[x for x in reports if x['id']!=r['id']];reports.insert(0,r)
  cloud.save('reports.json',reports);return {'saved':r['id']}
 if action=='panel':return {'url':panel.start()}
 raise ValueError('不支持的操作。')

if __name__=='__main__':
 try:print(json.dumps(dispatch(sys.argv[1],json.load(sys.stdin)),ensure_ascii=False))
 except cloud.CloudError as e:
  print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)
 except (ValueError,KeyError,OSError):
  # Files and upstream errors can contain private data. Keep transport errors generic.
  print(json.dumps({'error':'操作未完成，请核对连接、范围或清单后重试。'},ensure_ascii=False));sys.exit(1)
