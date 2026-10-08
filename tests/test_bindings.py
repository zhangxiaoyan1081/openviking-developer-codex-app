import json,unittest
from unittest.mock import patch
import test_profiles
import bindings,profiles,cloud,connection,hook_setup

class BindingTests(unittest.TestCase):
 setUp=test_profiles.ProfilesTests.setUp
 tearDown=test_profiles.ProfilesTests.tearDown
 response=test_profiles.ProfilesTests.response
 def setup_binding(self,mode='reuse'):
  value=bindings.begin();bindings.choose_setup(value['revision'],mode);return value['revision']
 def test_begin_preserves_current_and_setup_is_explicit(self):
  revision=self.setup_binding('update')
  self.assertEqual(bindings.public()['phase'],'install')
  self.assertEqual(self.original,cloud.CONFIG.read_bytes())
  with self.assertRaises(cloud.CloudError):bindings.bind(revision,'key','db-1')
 def test_bind_activates_new_identity_and_preserves_original(self):
  revision=self.setup_binding()
  with patch.object(cloud,'request',side_effect=self.response()*2),patch.object(profiles,'assert_live_isolation'):
   bindings.bind(revision,'new-secret',service_name='公司研发')
  self.assertEqual(cloud.credentials()['user'],'alice')
  self.assertEqual(profiles.load(profiles.ROOT/'current/config.json')['api_key'],'old-secret')
  self.assertEqual(bindings.public()['phase'],'onboarding')
  rows=profiles.rows();self.assertEqual(len(rows),2)
  self.assertIsNone([r for r in rows if r['active']][0]['databaseId'])
  self.assertEqual([r for r in rows if r['active']][0]['serviceName'],'公司研发')
  self.assertNotIn('secret',json.dumps(rows)+json.dumps(bindings.public()))
 def test_restart_gate_preserves_saved_key_for_resume(self):
  revision=self.setup_binding()
  with patch.object(cloud,'request',side_effect=self.response()),patch.object(profiles,'assert_live_isolation',side_effect=cloud.CloudError('restart')):
   with self.assertRaises(cloud.CloudError):bindings.bind(revision,'new-secret','db-1')
  self.assertEqual(self.original,cloud.CONFIG.read_bytes());self.assertEqual(bindings.public()['phase'],'activate')
  with patch.object(profiles,'assert_live_isolation'),patch.object(cloud,'request',side_effect=self.response()):bindings.activate(revision)
  self.assertEqual(len(profiles.rows()),2)
 def test_host_failure_preserves_binding_and_retries_without_key(self):
  revision=self.setup_binding()
  with patch.object(cloud,'request',side_effect=self.response()),patch.object(profiles,'assert_live_isolation',side_effect=hook_setup.HostError('找不到可运行的 Codex。')):
   with self.assertRaisesRegex(cloud.CloudError,'无需再次提交 API Key'):
    bindings.bind(revision,'new-secret')
  self.assertEqual(self.original,cloud.CONFIG.read_bytes())
  self.assertEqual(bindings.public()['phase'],'activate')
  with patch.object(profiles,'assert_live_isolation'),patch.object(cloud,'request',side_effect=self.response()):bindings.activate(revision)
  self.assertEqual(len(profiles.rows()),2)
 def test_stale_card_cannot_add_or_switch(self):
  revision=self.setup_binding();bindings.begin()
  with patch.object(cloud,'request') as request:
   with self.assertRaises(cloud.CloudError):bindings.bind(revision,'new-secret','db-1')
   request.assert_not_called()
 def test_same_user_multiple_libraries_requires_disambiguation(self):
  for name,db in [('first','db-1'),('second','db-2')]:
   with patch.object(cloud,'request',side_effect=self.response()):profiles.add(name,'new-secret-'+name,database_id=db)
  with patch.object(profiles,'switch') as switch:
   r=bindings.switch_user('alice');self.assertEqual(r['status'],'choose_connection');switch.assert_not_called()
  with patch.object(profiles,'assert_live_isolation'),patch.object(cloud,'request',side_effect=self.response()):
   r=bindings.switch_user('alice','db-2');self.assertEqual(r['status'],'switched')
  self.assertEqual(profiles.active(),'second')
 def test_unknown_user_and_current_are_noops(self):
  with patch.object(profiles,'switch') as switch:
   self.assertEqual(bindings.switch_user('missing')['status'],'not_found')
   self.assertEqual(bindings.switch_user('default')['status'],'already_current');switch.assert_not_called()
 def test_database_identity_is_not_account_identity(self):
  revision=self.setup_binding()
  responses=self.response();responses[0]['database_id']='real-db'
  with patch.object(cloud,'request',side_effect=responses*2),patch.object(profiles,'assert_live_isolation'):
   bindings.bind(revision,'new-secret')
  row=next(r for r in profiles.rows() if r['active'])
  self.assertEqual(row['databaseId'],'real-db')
  self.assertEqual(row['databaseIdSource'],'server')
 def test_summary_only_after_onboarding_ready(self):
  value={'phase':'onboarding','profile':'current','revision':'test'};bindings.save(value)
  self.assertEqual(bindings.finish_if_ready({'phase':'hooks'})['phase'],'onboarding')
  self.assertEqual(bindings.finish_if_ready({'phase':'ready'})['phase'],'complete')
 def test_mcp_pins_profile_configuration(self):
  with patch.object(profiles.os,'execve') as execute:
   profiles.mcp('/node','/proxy.mjs')
  env=execute.call_args.args[2]
  self.assertEqual(env['OPENVIKING_CLI_CONFIG_FILE'],str(profiles.ROOT/'current/config.json'))
  self.assertEqual(env['OPENVIKING_CREDENTIAL_SOURCE'],'cli')
 def test_metadata_update_has_no_credential_side_effect(self):
  bindings.set_database('current','db-current')
  self.assertEqual(profiles.rows()[0]['databaseId'],'db-current')
  self.assertEqual(self.original,cloud.CONFIG.read_bytes())

 def test_switch_back_preserves_onboarding_review(self):
  cloud.save('connection.json',{'verifiedAt':'original-onboarding'})
  with patch.object(cloud,'request',side_effect=self.response()):profiles.add('enterprise','new-secret',database_id='db-new')
  with patch.object(profiles,'assert_live_isolation'),patch.object(connection,'verify',return_value={}):
   profiles.switch('enterprise',live=True);profiles.switch('current',live=True)
  self.assertEqual(cloud.load('connection.json')['verifiedAt'],'original-onboarding')
  self.assertIn('lastValidatedAt',cloud.load('connection.json'))

 def test_key_only_binding_uses_fallback_name(self):
  revision=self.setup_binding()
  with patch.object(cloud,'request',side_effect=self.response()*2),patch.object(profiles,'assert_live_isolation'):
   bindings.bind(revision,'key-only-secret')
  row=next(r for r in profiles.rows() if r['active'])
  self.assertIsNone(row['databaseId'])
  self.assertEqual(row['serviceName'],row['name'])
 def test_same_user_no_database_selects_by_service_name(self):
  for name,label in [('first','个人'),('second','公司')]:
   with patch.object(cloud,'request',side_effect=self.response()):profiles.add(name,'key-'+name,service_name=label)
  with patch.object(profiles,'switch') as switch:
   self.assertEqual(bindings.switch_user('alice')['status'],'choose_connection');switch.assert_not_called()
  with patch.object(profiles,'assert_live_isolation'),patch.object(cloud,'request',side_effect=self.response()):
   self.assertEqual(bindings.switch_user('alice',service_name='公司')['status'],'switched')
  self.assertEqual(profiles.active(),'second')
