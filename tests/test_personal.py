import sys,json,tempfile,unittest,copy
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'plugins/openviking-codex-app/scripts'))
import cloud,history,workspace,panel,onboarding
class PersonalTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.patches=[patch.object(cloud,'CONFIG',self.root/'ovcli.conf'),patch.object(cloud,'ROOT',self.root/'state'),patch.dict('os.environ',{},clear=True)]
  for p in self.patches:p.start()
  cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'test-only'})
  cloud.save('connection.json',{'verifiedAt':'2026-09-21T00:00:00Z'})
  rules=self.root/'AGENTS.md';rules.write_text('Use OV for relevant context and save approved deliverables.')
  prepared=onboarding.prepare_rules({'path':str(rules),'mode':'reuse','scope':'global','summary':['沿用已有规则'],'evidence':'Fixture explicit existing authorization'})
  onboarding.choose_rules({'revision':prepared['revision'],'choice':'adopt'})
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def plan(self,n=1):return {'sessions':[{'source_id':'source-a','title':'Project A','ended':True,'capture_checked':True,'messages':[{'role':'user','content':'Hello','created_at':'2026-09-20T09:00:00+08:00','source_message_id':str(i)} for i in range(n)]}]}
 def test_commercial_only(self):
  cloud.atomic(cloud.CONFIG,{'url':'http://localhost:1933','api_key':'test'})
  with self.assertRaises(cloud.CloudError):cloud.credentials()
 def test_environment_override_stops(self):
  with patch.dict('os.environ',{'OPENVIKING_API_KEY':'other'}):
   with self.assertRaises(cloud.CloudError):cloud.credentials()
 def test_config_private(self):self.assertEqual(cloud.CONFIG.stat().st_mode&0o777,0o600)
 def test_identity_changes_partition(self):
  before=cloud.folder();cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'different'});self.assertNotEqual(before,cloud.folder())
 def test_resource_scope(self):
  self.assertEqual(cloud.personal_uri('viking://user/default/resources/projects/a'), 'viking://user/default/resources/projects/a')
  for uri in ['viking://resources','viking://user/other/resources','viking://user/default/resources/../secrets','viking://user/default/resources/%2e%2e']:
   with self.assertRaises(cloud.CloudError):cloud.personal_uri(uri)
 def test_scope_not_upload(self):
  for mode in ['projects','description']:
   self.assertEqual(panel.scope({'mode':mode,'text':'a and b'})['state'],'selected')
  self.assertEqual(panel.scope({'mode':'recent','days':90})['days'],90)
  with self.assertRaises(ValueError):panel.scope({'mode':'recent','days':0})
 def test_confirmation_required(self):
  with patch.object(cloud,'request') as request:
   with self.assertRaises(ValueError):history.apply(self.plan(),'wrong')
   request.assert_not_called()
 def test_import_batches_and_no_replay(self):
  plan=self.plan(101)
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t'}}) as request:
   first=history.apply(plan,history.digest(plan));self.assertEqual(request.call_count,4);self.assertEqual(first['items']['source-a']['state'],'submitted')
   history.apply(plan,history.digest(plan));self.assertEqual(request.call_count,4)
   other={**plan,'scope':'new plan same session'};history.apply(other,history.digest(other));self.assertEqual(request.call_count,4)
 def test_uncertain_never_replays(self):
  plan=self.plan()
  with patch.object(cloud,'request',side_effect=cloud.CloudError('timeout')) as request:
   with self.assertRaises(cloud.CloudError):history.apply(plan,history.digest(plan))
   with self.assertRaises(ValueError):history.apply(plan,history.digest(plan))
   self.assertEqual(request.call_count,1)
 def test_revised_source_requires_reconciliation(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{}}):history.apply(plan,history.digest(plan))
  plan['sessions'][0]['messages'][0]['content']='changed'
  with self.assertRaises(ValueError):history.apply(plan,history.digest(plan))
 def test_existing_session_read_only(self):
  plan={'sessions':[{'source_id':'s','existing_session_id':'cx-s'}]}
  with patch.object(cloud,'request',return_value={'result':{}}) as request:
   history.apply(plan,history.digest(plan));self.assertEqual(request.call_count,1);self.assertEqual(len(request.call_args.args),1)
 def test_empty_overview_is_not_success(self):
  plan={'sessions':[{'source_id':'s','existing_session_id':'cx-s'}]}
  with patch.object(cloud,'request',return_value={'result':{'latest_archive_overview':'','messages':[{}]}}):
   r=history.collect(plan);self.assertEqual(r['coverage']['withOverview'],0);self.assertEqual(r['sessions'][0]['activeMessageCount'],1)
 def test_active_sessions_rejected(self):
  p=self.plan();p['sessions'][0]['ended']=False
  with self.assertRaises(ValueError):history.validate(p)
 def test_cards_require_sources(self):
  with self.assertRaises(ValueError):workspace.publish({'works':[{'id':'1','title':'A','state':'done','next':'go','sources':[]}]})
 def test_duplicate_messages_rejected(self):
  p=self.plan(2);p['sessions'][0]['messages'][1]['source_message_id']='0'
  with self.assertRaises(ValueError):history.validate(p)
if __name__=='__main__':unittest.main()
