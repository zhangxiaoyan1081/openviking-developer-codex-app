import copy,json,unittest
from unittest.mock import patch
import test_personal as fixtures
import cloud,connection,app_backend,history

class ConnectionTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def unapproved(self):
  (cloud.folder()/'connection.json').unlink(missing_ok=True)
 def response(self):return [{'result':{'tools':[]}},{'result':{'content':[{'type':'text','text':''}]}}]
 def test_existing_connection_is_not_implicit_consent(self):
  self.unapproved();s=app_backend.state()
  self.assertTrue(s['connection']['canReuse']);self.assertFalse(s['connection']['ready'])
  for action,args in [('scope',{'mode':'recent','days':30}),('review',{}),('list',{'uri':'viking://user/default/resources'})]:
   with self.assertRaises(cloud.CloudError):app_backend.dispatch(action,args)
  with self.assertRaises(cloud.CloudError):history.apply(fixtures.PersonalTests.plan(self),'x')
 def test_confirm_existing_validates_and_no_key_in_result(self):
  self.unapproved();before=cloud.CONFIG.read_bytes()
  with patch.object(cloud,'request',side_effect=self.response()) as request:
   s=app_backend.dispatch('connect_existing',{'revision':connection.snapshot()[1]})
  self.assertTrue(s['connection']['ready']);self.assertEqual(request.call_count,2)
  self.assertEqual(before,cloud.CONFIG.read_bytes());self.assertNotIn('test-only',json.dumps(s))
 def test_bad_key_preserves_old_config_and_confirmation(self):
  before=cloud.CONFIG.read_bytes();oldmark=cloud.load('connection.json')
  with patch.object(cloud,'request',side_effect=cloud.CloudError('连接权限不足，请核对 API Key。')):
   with self.assertRaises(cloud.CloudError):connection.select(revision=connection.snapshot()[1],api_key='invalid-test-key')
  self.assertEqual(before,cloud.CONFIG.read_bytes());self.assertEqual(oldmark,cloud.load('connection.json'))
 def test_change_key_blocks_same_runtime_and_resets_visible_data(self):
  cloud.save('scope.json',{'mode':'recent','days':30})
  with patch.dict('os.environ',{'OV_APP_RUNTIME_ID':'old'}),patch.object(cloud,'request',side_effect=self.response()):
   s=connection.select(revision=connection.snapshot()[1],api_key='new-test-key')
   self.assertTrue(s['restartRequired']);self.assertFalse(s['ready']);self.assertIsNone(app_backend.state()['scope'])
  with patch.dict('os.environ',{'OV_APP_RUNTIME_ID':'new'}):
   self.assertTrue(connection.status()['ready']);self.assertIsNone(app_backend.state()['scope'])
  self.assertEqual(cloud.CONFIG.stat().st_mode&0o777,0o600)
 def test_console_provided_key_verifies_without_reentry(self):
  self.unapproved()
  with patch.object(cloud,'request',side_effect=self.response()):s=connection.select(revision=connection.snapshot()[1],api_key='test-only',source='console')
  self.assertTrue(s['ready']);self.assertEqual(cloud.load('connection.json')['source'],'console')
 def test_first_key_and_stale_card(self):
  cloud.CONFIG.unlink();s=connection.status();self.assertFalse(s['hasKey'])
  with patch.object(cloud,'request',side_effect=self.response()):connection.select(revision=s['revision'],api_key='first-test-key')
  with patch.object(cloud,'request') as request:
   with self.assertRaises(cloud.CloudError):connection.select(revision=s['revision'],api_key='other-test-key')
   request.assert_not_called()
 def test_key_is_not_saved_when_personal_access_fails(self):
  before=cloud.CONFIG.read_bytes()
  with patch.object(cloud,'request',side_effect=[{'result':{'tools':[]}},{'result':{'isError':True,'content':[]}}]):
   with self.assertRaises(cloud.CloudError):connection.select(revision=connection.snapshot()[1],api_key='no-access-key')
  self.assertEqual(before,cloud.CONFIG.read_bytes())
 def test_external_switch_requires_running_proxy_reload(self):
  with patch.object(cloud,'request',side_effect=self.response()):connection.select(revision=connection.snapshot()[1],api_key='console-new',source='console')
  with patch.dict('os.environ',{'OV_APP_STARTED_AT':'1'}):self.assertTrue(connection.status()['restartRequired'])
  with patch.dict('os.environ',{'OV_APP_STARTED_AT':'9999999999'}):self.assertTrue(connection.status()['ready'])
