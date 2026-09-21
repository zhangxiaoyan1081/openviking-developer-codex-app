import json,unittest
from unittest.mock import patch
import test_personal as fixtures
import cloud,history,app_backend
class AppTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 plan=fixtures.PersonalTests.plan
 def test_new_connection_card_hides_previous_workspace_without_resetting_it(self):
  cloud.save('workspace.json',{'works':[{'title':'existing work'}]})
  result=app_backend.dispatch('onboarding_view',{'step':'connection'})
  self.assertFalse(result['connection']['ready'])
  self.assertTrue(result['connection']['canReuse'])
  self.assertEqual(result['workspace']['works'],[])
  self.assertTrue(app_backend.state()['connection']['ready'])
  self.assertEqual(app_backend.state()['workspace']['works'][0]['title'],'existing work')
 def test_review_confirmation_stale_hash(self):
  p=self.root/'plan.json';plan=self.plan();p.write_text(json.dumps(plan))
  with patch.object(cloud,'request') as request:
   preview=app_backend.dispatch('review',{'path':str(p),'coverage':'测试来源 1 个会话'})['plan']
   self.assertNotIn('messages',json.dumps(preview['items'][0].get('content',{})))
   self.assertFalse(preview['confirmed']);app_backend.dispatch('confirm',{'hash':preview['hash']})
   self.assertTrue(app_backend.state()['plan']['confirmed'])
   plan['sessions'][0]['title']='changed';p.write_text(json.dumps(plan));app_backend.dispatch('review',{'path':str(p),'coverage':'更新'})
   with self.assertRaises(ValueError):app_backend.dispatch('confirm',{'hash':preview['hash']})
   app_backend.dispatch('scope',{'mode':'recent','days':30});self.assertIsNone(app_backend.state()['plan'])
   request.assert_not_called()
 def test_report_needs_personal_sources_and_upserts(self):
  r={'id':'weekly-1','kind':'weekly','title':'测试周报','period':'2026-09-14 至 2026-09-20','body':'已完成 X','coverage':'1 个项目','sources':[{'label':'来源','uri':'viking://resources/a.md'}]}
  with self.assertRaises(cloud.CloudError):app_backend.dispatch('publish_report',r)
  r['sources'][0]['uri']='viking://user/default/resources/a.md'
  app_backend.dispatch('publish_report',r);r['body']='已核对';app_backend.dispatch('publish_report',r)
  self.assertEqual(len(app_backend.state()['reports']),1)
  self.assertEqual(app_backend.state()['reports'][0]['body'],'已核对')
  self.assertNotIn('api_key',json.dumps(app_backend.state()))
