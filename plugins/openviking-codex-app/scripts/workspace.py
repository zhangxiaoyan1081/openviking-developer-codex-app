"""Publish evidence-backed work cards, not inferred completion claims."""
import json,sys
from datetime import datetime,timezone
import cloud,connection,onboarding

def publish(value):
 connection.require_ready()
 if not isinstance(value,dict) or not isinstance(value.get('works'),list):raise ValueError('需要工作清单。')
 for w in value['works']:
  if not all(isinstance(w.get(k),str) and w[k].strip() for k in ('id','title','state','next')) or not isinstance(w.get('sources'),list) or not w['sources']:raise ValueError('每项工作需要进展、下一步和来源。')
  for source in w['sources']:
   if not isinstance(source,dict) or not source.get('label') or not source.get('uri'):raise ValueError('来源需要标题和地址。')
   cloud.personal_uri(source['uri'])
  if not isinstance(w.get('coverage',''),str):raise ValueError('覆盖说明格式错误。')
 for w in value['works']:
  for key in ('goal','decisions','openIssues'):
   if key in w and not isinstance(w[key],str):raise ValueError('工作摘要格式错误。')
 if value.get('onboarding') and (not value['works'] or any(not w.get('goal') or not w.get('coverage') for w in value['works'])):raise ValueError('接续摘要需要目标、进展、下一步、来源和覆盖说明。')
 if value.get('onboarding') and value.get('scopeRevision')!=onboarding.scope_key():raise ValueError('工作范围已变化，请按当前范围核对摘要。')
 value['updatedAt']=datetime.now(timezone.utc).isoformat();cloud.save('workspace.json',value)
 if value.get('onboarding'):onboarding.mark_summary()
 return {'saved':len(value['works'])}
if __name__=='__main__':
 try:print(json.dumps(publish(json.load(sys.stdin)),ensure_ascii=False))
 except (ValueError,cloud.CloudError) as e:print(str(e),file=sys.stderr);sys.exit(1)
