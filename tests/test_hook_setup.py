import json,unittest
from unittest.mock import patch
import test_personal as fixtures
import hook_setup

class HookSetupTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def inspect(self,trust='trusted',enabled=True,node='/opt/node',flags=True,feature=True):
  root=self.root/'plugin';(root/'hooks').mkdir(parents=True,exist_ok=True)
  (root/'hooks/hooks.json').write_text(json.dumps({'hooks':{'Stop':[{'hooks':[{'command':'node a'}]}]}}))
  plugin={'pluginId':hook_setup.OFFICIAL,'name':'openviking-memory','enabled':True}
  host={'data':[{'hooks':[{'pluginId':hook_setup.OFFICIAL,'enabled':enabled,'trustStatus':trust,'command':node+' a'}]}]}
  def output(args,**kwargs):
   if 'features' in args:return 'hooks stable '+str(feature).lower()
   return json.dumps({'autoRecall':flags,'autoCapture':flags})
  with patch.object(hook_setup,'installed_plugins',return_value={'installed':[plugin]}),patch.object(hook_setup,'cache_root',return_value=root),patch.object(hook_setup,'host_hooks',return_value=host),patch.object(hook_setup.subprocess,'run'),patch.object(hook_setup.subprocess,'check_output',side_effect=output):
   return hook_setup.inspect(str(self.root))
 def test_trust_and_enablement_and_runtime_are_all_required(self):
  self.assertTrue(self.inspect()['automaticReady'])
  for status in ['untrusted','modified']:
   result=self.inspect(trust=status);self.assertFalse(result['automaticReady']);self.assertFalse(result['manualReady'])
  self.assertFalse(self.inspect(node='node')['automaticReady'])
  self.assertFalse(self.inspect(flags=False)['automaticReady'])
  disabled=self.inspect(enabled=False);self.assertTrue(disabled['manualReady']);self.assertFalse(disabled['automaticReady'])
  self.assertTrue(self.inspect(feature=False)['manualReady'])
 def test_missing_or_duplicate_installation(self):
  with patch.object(hook_setup,'installed_plugins',return_value={'installed':[]}):self.assertTrue(hook_setup.inspect(str(self.root))['manualReady'])
  with patch.object(hook_setup,'installed_plugins',return_value={'installed':[{'name':'openviking-memory'},{'name':'openviking-memory'}]}):self.assertFalse(hook_setup.inspect(str(self.root))['manualReady'])
