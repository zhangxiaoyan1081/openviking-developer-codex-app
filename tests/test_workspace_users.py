import json,os,unittest
from unittest.mock import patch
import test_profiles as fixtures
import cloud,connection,profiles,workspace_users,app_backend

class WorkspaceUsersTests(unittest.TestCase):
 setUp=fixtures.ProfilesTests.setUp
 tearDown=fixtures.ProfilesTests.tearDown
 add=fixtures.ProfilesTests.add
 response=fixtures.ProfilesTests.response
 def prepare(self):
  cloud.save('connection.json',{'verifiedAt':'fixture'})
  self.add()
  return workspace_users.state()['connection']['revision']
 def test_switch_refreshes_workspace_but_does_not_unlock_old_conversation(self):
  revision=self.prepare()
  with patch.object(profiles,'assert_live_isolation'),patch.object(connection,'verify'),patch.dict(os.environ,{'OV_APP_RUNTIME_ID':'old-runtime'}):
   state=workspace_users.dispatch('workspace_switch',{'revision':revision,'profile_name':'work'})
   self.assertEqual(state['identity']['user'],'alice');self.assertTrue(state['connection']['ready'])
   self.assertFalse(connection.status()['ready'])
   with self.assertRaises(cloud.CloudError):app_backend.dispatch('read',{'uri':'viking://'})
   with patch.object(cloud,'browse_rpc',return_value={'content':[]}) as rpc:
    workspace_users.dispatch('workspace_read',{'revision':state['connection']['revision'],'tool':'list_directory','arguments':{'uri':'viking://'}})
    rpc.assert_called_once()
   self.assertNotIn('secret',json.dumps(state))
 def test_stale_click_and_failed_verification_preserve_current(self):
  revision=self.prepare()
  with patch.object(profiles,'assert_live_isolation'),patch.object(connection,'verify') as verify:
   with self.assertRaises(cloud.CloudError):workspace_users.dispatch('workspace_switch',{'revision':'stale','profile_name':'work'})
   verify.assert_not_called()
  with patch.object(profiles,'assert_live_isolation'),patch.object(connection,'verify',side_effect=cloud.CloudError('连接失败')):
   with self.assertRaises(cloud.CloudError):workspace_users.dispatch('workspace_switch',{'revision':revision,'profile_name':'work'})
  self.assertEqual(cloud.CONFIG.read_bytes(),self.original);self.assertEqual(profiles.active(),'current')
 def test_isolation_required(self):
  revision=self.prepare()
  with patch.object(profiles,'assert_live_isolation',side_effect=cloud.CloudError('请先更新连接隔离组件。')):
   with self.assertRaises(cloud.CloudError):workspace_users.dispatch('workspace_switch',{'revision':revision,'profile_name':'work'})
  self.assertEqual(cloud.CONFIG.read_bytes(),self.original)
 def test_read_pins_credentials_and_discards_result_after_switch(self):
  revision=self.prepare()
  def read(*args):
   before=cloud.credentials();cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'external'})
   self.assertEqual(cloud.credentials(),before)
   return {'content':[]}
  with patch.object(cloud,'browse_rpc',side_effect=read):
   with self.assertRaisesRegex(cloud.CloudError,'连接已变化'):workspace_users.dispatch('workspace_read',{'revision':revision,'tool':'read_file','arguments':{'uri':'viking://resources/file'}})
  self.assertEqual(cloud.credentials()['api_key'],'external')
 def test_read_disallows_mutations_and_unverified_connections(self):
  revision=self.prepare()
  for tool in ('bind_user','publish_report','switch_user'):
   with self.assertRaises(cloud.CloudError):workspace_users.dispatch('workspace_read',{'revision':revision,'tool':tool})
  cloud.save('connection.json',{})
  with self.assertRaises(cloud.CloudError):workspace_users.dispatch('workspace_read',{'revision':revision,'tool':'list_directory'})
 def test_chat_binding_appears_without_advancing_onboarding(self):
  self.prepare()
  with patch.object(app_backend.onboarding,'state') as flow:
   state=workspace_users.state()
   self.assertEqual([r['user'] for r in state['boundUsers']],['default','alice']);flow.assert_not_called()
 def test_progress_worker_receives_pinned_identity_without_key_in_argv(self):
  import session_progress
  self.prepare();config=cloud.credentials()
  with cloud.pinned_credentials(config),patch.object(session_progress.subprocess,'Popen') as start:
   session_progress.page({})
   args,kwargs=start.call_args
   self.assertNotIn(config['api_key'],json.dumps(args))
   self.assertEqual(json.loads(start.return_value.stdin.write.call_args.args[0]),config)
   start.return_value.stdin.close.assert_called_once()
