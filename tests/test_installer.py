import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
import test_personal as fixtures
import cloud
spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'install.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
class InstallerTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def test_companion_install_without_key_does_not_verify_or_accept_connection(self):
  cloud.CONFIG.unlink()
  def output(args,**kwargs):return 'v22.0.0' if args[0]=='node' else json.dumps({'installed':[]})
  with patch('sys.argv',['install.py','--companion-only']),patch.object(Path,'home',return_value=self.root),patch.object(installer.shutil,'which',return_value='/test/bin'),patch.object(installer.shutil,'copytree'),patch.object(installer,'stage_companion') as stage,patch.object(installer.subprocess,'check_output',side_effect=output),patch.object(installer.subprocess,'run') as run,patch.object(cloud,'request') as request:
   installer.main();request.assert_not_called()
   stage.assert_called_once()
   self.assertTrue(any(c.args[0]==['codex','plugin','add','openviking-codex-app@ov-personal-cloud'] for c in run.call_args_list))
  self.assertFalse(cloud.CONFIG.exists())

 def test_launch_snapshot_is_outside_replaceable_cache_and_immutable(self):
  dest=self.root/'marketplace'
  installer.shutil.copytree(installer.ROOT/'plugins',dest/'plugins')
  with patch.object(installer.shutil,'which',return_value='/test/bin/node'):
   runtime=installer.stage_companion(dest)
  config=json.loads((dest/'plugins/openviking-codex-app/.mcp.json').read_text())['mcpServers']['openviking-codex-app']
  self.assertTrue(Path(config['command']).is_absolute())
  self.assertTrue(Path(config['env']['OV_APP_PYTHON']).is_file())
  self.assertEqual(Path(config['cwd']),runtime)
  self.assertEqual(Path(config['args'][0]),runtime/'scripts/app_server.mjs')
  with patch.object(installer.shutil,'which',return_value='/test/bin/node'):
   self.assertEqual(installer.stage_companion(dest),runtime)
  installer.shutil.rmtree(dest)
  self.assertTrue(Path(config['args'][0]).is_file())

 def test_existing_official_is_never_downloaded_or_reinstalled(self):
  existing={'installed':[{'name':'openviking-memory','pluginId':'openviking-memory@openviking','version':'newer','enabled':False}]}
  with patch('sys.argv',['install.py']),patch.object(Path,'home',return_value=self.root),patch.object(installer.hook_setup,'installed_plugins',return_value=existing),patch.object(installer.shutil,'which',return_value='/test/bin/node'),patch.object(installer.shutil,'copytree'),patch.object(installer,'stage_companion'),patch.object(installer.subprocess,'check_output',return_value='v22.0.0'),patch.object(installer.subprocess,'run') as run,patch.object(installer,'urlopen') as fetch,patch.object(installer.hook_setup,'pin_new_install') as pin:
   installer.main();fetch.assert_not_called();pin.assert_not_called()
   self.assertFalse(any(c.args[0][0]=='bash' for c in run.call_args_list))
   self.assertFalse(any('openviking-memory@openviking' in c.args[0] for c in run.call_args_list))

 def test_new_official_gets_absolute_node_without_trusting_hooks(self):
  root=self.root/'official';(root/'hooks').mkdir(parents=True)
  cloud.atomic(root/'.mcp.json',{'mcpServers':{'openviking-memory':{'command':'node'}}})
  cloud.atomic(root/'hooks/hooks.json',{'hooks':{'Stop':[{'hooks':[{'command':'node "${PLUGIN_ROOT}/capture.mjs"'}]}]}})
  with patch.object(installer.hook_setup,'cache_root',return_value=root),patch.object(installer.hook_setup.subprocess,'run') as run:
   installer.hook_setup.pin_new_install({'installed':[{'name':'openviking-memory','pluginId':'openviking-memory@openviking'}]},'/opt/node')
   self.assertEqual(run.call_args.args[0],['/opt/node','--version'])
  self.assertEqual(json.loads((root/'.mcp.json').read_text())['mcpServers']['openviking-memory']['command'],'/opt/node')
  self.assertEqual(json.loads((root/'hooks/hooks.json').read_text())['hooks']['Stop'][0]['hooks'][0]['command'],'/opt/node "${PLUGIN_ROOT}/capture.mjs"')
  self.assertFalse((self.root/'.codex/config.toml').exists())
