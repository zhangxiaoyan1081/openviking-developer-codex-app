import json, os, tempfile, time, unittest, uuid
from pathlib import Path
from unittest.mock import patch
import test_personal
import cloud, connection, profiles

def sid(ms):
 return str(uuid.UUID(int=(ms<<80)|(7<<76)|(2<<62)|123))

class ProfilesTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.patches=[patch.object(cloud,'CONFIG',self.root/'ovcli.conf'),patch.object(cloud,'ROOT',self.root/'personal'),patch.object(profiles,'ROOT',self.root/'connections'),patch.object(profiles,'STATE',self.root/'state'),patch.dict(os.environ,{},clear=True),patch.object(profiles,'assert_hook_isolation')]
  for p in self.patches:p.start()
  cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'old-secret'})
  self.original=cloud.CONFIG.read_bytes();profiles.initialize()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def response(self,user='alice',account='enterprise'):
  return [{'account_id':account,'user_id':user,'role':'user'},{'result':{'tools':[]}},{'result':{'content':[]}}]
 def add(self):
  with patch.object(cloud,'request',side_effect=self.response()):profiles.add('work','new-secret')
 def switch(self,name):
  with patch.object(profiles,'assert_stopped'),patch.object(connection,'verify'):profiles.switch(name)
 def test_register_and_add_preserve_current_and_hide_keys(self):
  self.add();self.assertEqual(self.original,cloud.CONFIG.read_bytes())
  self.assertNotIn('secret',json.dumps(profiles.rows()))
  self.assertEqual((profiles.ROOT/'work/config.json').stat().st_mode&0o777,0o600)
  self.assertEqual(profiles.load(profiles.ROOT/'work/config.json')['user'],'alice')
 def test_enterprise_scope_and_headers_alias(self):
  self.add();self.switch('work')
  self.assertEqual(cloud.user_root(),'viking://user/alice')
  cloud.personal_uri('viking://user/alice/resources/x.md')
  with self.assertRaises(cloud.CloudError):cloud.personal_uri('viking://user/default/resources/x.md')
 def test_mismatched_identity_never_saves(self):
  with patch.object(cloud,'request',side_effect=self.response()):
   with self.assertRaises(cloud.CloudError):profiles.add('work','new-secret',user='bob')
  self.assertFalse((profiles.ROOT/'work').exists());self.assertEqual(self.original,cloud.CONFIG.read_bytes())
 def test_failed_auth_does_not_save(self):
  with patch.object(cloud,'request',side_effect=cloud.CloudError('auth')):
   with self.assertRaises(cloud.CloudError):profiles.add('work','new-secret')
  self.assertEqual(profiles.rows()[0]['name'],'current')
 def test_roundtrip_preserves_capture_and_config(self):
  profiles.STATE.mkdir();(profiles.STATE/'existing.json').write_text('original-state')
  self.add();self.switch('work');self.switch('current')
  self.assertEqual(self.original,cloud.CONFIG.read_bytes())
  self.assertEqual((profiles.STATE/'existing.json').read_text(),'original-state')
 def test_old_task_and_cross_profile_task_blocked(self):
  old=sid(1000);profiles.hook_environment({'session_id':old})
  self.add();self.switch('work')
  with self.assertRaises(cloud.CloudError):profiles.hook_environment({'session_id':old})
  with self.assertRaises(cloud.CloudError):profiles.hook_environment({'session_id':sid(2000)})
  new=sid(int(time.time()*1000)+1000);env=profiles.hook_environment({'session_id':new})
  self.assertEqual(env['OPENVIKING_CODEX_STATE_DIR'],str(profiles.ROOT/'work/hook-state'))
  self.assertEqual(env['OPENVIKING_CLI_CONFIG_FILE'],str(profiles.ROOT/'work/config.json'))
  self.switch('current')
  with self.assertRaises(cloud.CloudError):profiles.hook_environment({'session_id':new})
 def test_external_change_pauses_hooks_and_switch(self):
  cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'outside'})
  with self.assertRaises(cloud.CloudError):profiles.hook_environment({'session_id':sid(1000)})
  with patch.object(profiles,'assert_stopped'):
   with self.assertRaises(cloud.CloudError):profiles.switch('current')
 def test_live_codex_prevents_switch(self):
  result=type('Result',(),{'stdout':'123 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT app'})()
  with patch.object(subprocess_module(),'run',return_value=result):
   with self.assertRaises(cloud.CloudError):profiles.switch('current')
 def test_interrupted_switch_recovers(self):
  self.add();cloud.atomic(profiles.ROOT/'switch.json',{'previous':'current','target':'work'})
  cloud.atomic(cloud.CONFIG,profiles.load(profiles.ROOT/'work/config.json'))
  with self.assertRaises(cloud.CloudError):profiles.hook_environment({'session_id':sid(1000)})
  with profiles.locked():profiles.recover()
  self.assertEqual(self.original,cloud.CONFIG.read_bytes());self.assertEqual(profiles.active(),'current')
 def test_bad_names_and_identity(self):
  for name in ('../bad','a/b','a b'):
   with self.assertRaises(cloud.CloudError):profiles.add(name,'new-secret')
  for user in ('../bob','a/b','a\nb'):
   with self.assertRaises(cloud.CloudError):cloud.validate_credentials({'url':cloud.ENDPOINT,'api_key':'x','user':user})

def subprocess_module():
 return profiles.subprocess
