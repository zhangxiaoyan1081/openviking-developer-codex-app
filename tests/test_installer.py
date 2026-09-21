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
  with patch('sys.argv',['install.py','--companion-only']),patch.object(Path,'home',return_value=self.root),patch.object(installer.shutil,'which',return_value='/test/bin'),patch.object(installer.shutil,'copytree'),patch.object(installer.subprocess,'check_output',side_effect=output),patch.object(installer.subprocess,'run') as run,patch.object(cloud,'request') as request:
   installer.main();request.assert_not_called()
   self.assertTrue(any(c.args[0]==['codex','plugin','add','openviking-codex-app@ov-personal-cloud'] for c in run.call_args_list))
  self.assertFalse(cloud.CONFIG.exists())
