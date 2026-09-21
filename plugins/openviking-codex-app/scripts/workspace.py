"""Publish evidence-backed work cards, not inferred completion claims."""
import json,sys
from datetime import datetime,timezone
import cloud

def publish(value):
 if not isinstance(value,dict) or not isinstance(value.get('works'),list):raise ValueError('需要工作清单。')
 for w in value['works']:
  if not all(isinstance(w.get(k),str) and w[k].strip() for k in ('id','title','state','next')) or not isinstance(w.get('sources'),list) or not w['sources']:raise ValueError('每项工作需要进展、下一步和来源。')
  for source in w['sources']:
   if not isinstance(source,dict) or not source.get('label') or not source.get('uri'):raise ValueError('来源需要标题和地址。')
   cloud.personal_uri(source['uri'])
  if not isinstance(w.get('coverage',''),str):raise ValueError('覆盖说明格式错误。')
 value['updatedAt']=datetime.now(timezone.utc).isoformat();cloud.save('workspace.json',value);return {'saved':len(value['works'])}
if __name__=='__main__':
 try:print(json.dumps(publish(json.load(sys.stdin)),ensure_ascii=False))
 except (ValueError,cloud.CloudError) as e:print(str(e),file=sys.stderr);sys.exit(1)
