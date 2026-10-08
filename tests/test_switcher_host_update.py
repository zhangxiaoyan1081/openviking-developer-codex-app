import importlib.util, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_personal

spec=importlib.util.spec_from_file_location('switcher_installer',Path(__file__).resolve().parents[1]/'scripts/install-switcher.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class SwitcherHostUpdateTests(unittest.TestCase):
 def test_refresh_changes_only_host_support_and_never_calls_full_installer(self):
  with tempfile.TemporaryDirectory() as folder:
   home=Path(folder);root=home/'.local/share/openviking-switcher';root.mkdir(parents=True)
   for name in ('profiles.py','hook.mjs','mcp.mjs','cloud.py','config.json'):(root/name).write_text('preserve '+name)
   (root/'hook_setup.py').write_text('old resolver')
   launcher=home/'.local/bin/ov-user';launcher.parent.mkdir(parents=True)
   launcher.write_text('#!/bin/sh\nexport OV_APP_CODEX=/old/codex\n')
   before={p:p.read_bytes() for p in root.iterdir() if p.name!='hook_setup.py'}
   with patch.object(Path,'home',return_value=home),patch.object(installer.profiles,'initialize') as init,patch.object(installer.hook_setup,'installed_plugins') as plugins:
    self.assertTrue(installer.refresh_host_support());init.assert_not_called();plugins.assert_not_called()
   self.assertTrue(all(p.read_bytes()==body for p,body in before.items()))
   self.assertEqual((root/'hook_setup.py').read_bytes(),(installer.SOURCE/'hook_setup.py').read_bytes())
   self.assertNotIn('OV_APP_CODEX',launcher.read_text())
   self.assertEqual(launcher.stat().st_mode&0o777,0o700)

 def test_absent_switcher_is_not_installed(self):
  with tempfile.TemporaryDirectory() as folder,patch.object(Path,'home',return_value=Path(folder)):
   self.assertFalse(installer.refresh_host_support())
   self.assertEqual(list(Path(folder).iterdir()),[])
