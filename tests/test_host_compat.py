"""Desktop upgrades, minimal GUI PATH, and sanitized RPC failure regressions."""
import json, os, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_personal  # register plugin scripts
import hook_setup


class HostCompatibilityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name)
  self.env=patch.dict(os.environ,{},clear=True);self.env.start();self.addCleanup(self.env.stop)
  self.which=patch.object(hook_setup.shutil,'which',return_value=None).start()
  self.desktop=patch.object(hook_setup,'desktop_candidates',return_value=[]).start()
  self.addCleanup(patch.stopall)

 def executable(self,relative,body='#!/bin/sh\nexit 0\n'):
  p=self.root/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(body);p.chmod(0o700);return str(p)

 def test_valid_explicit_override_wins(self):
  expected=self.executable('custom/codex')
  os.environ['OV_APP_CODEX']=expected
  self.which.return_value=self.executable('path/codex')
  self.assertEqual(hook_setup.codex(),expected)

 def test_old_bundle_hint_finds_relocated_cli_without_path(self):
  bundle='A folder/ChatGPT.app/Contents/'
  os.environ['OV_APP_CODEX']=str(self.root/bundle/'Resources/codex')
  expected=self.executable(bundle+'Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
  self.which.return_value=self.executable('different-version/codex')
  self.assertEqual(hook_setup.codex(),expected)

 def test_stale_override_falls_back_to_path_and_rechecks_each_call(self):
  os.environ['OV_APP_CODEX']=str(self.root/'gone')
  first=self.executable('path1/codex');self.which.return_value=first
  self.assertEqual(hook_setup.codex(),first)
  Path(first).unlink();second=self.executable('path2/codex');self.which.return_value=second
  self.assertEqual(hook_setup.codex(),second)

 def test_minimal_desktop_path_and_legacy_layout(self):
  os.environ['PATH']='/usr/bin:/bin'
  for relative in ('Codex.app/Contents/Resources/codex','ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'):
   expected=self.executable(relative);self.desktop.return_value=[Path(expected)]
   self.assertEqual(hook_setup.codex(),expected)

 def test_nonexecutable_and_dangling_paths_are_skipped(self):
  path=self.root/'not-executable';path.write_text('text');os.environ['OV_APP_CODEX']=str(path)
  dangling=self.root/'dangling';dangling.symlink_to(self.root/'missing')
  self.which.return_value=str(dangling)
  expected=self.executable('desktop/codex');self.desktop.return_value=[Path(expected)]
  self.assertEqual(hook_setup.codex(),expected)

 def test_no_binary_is_actionable_and_never_echoes_hint(self):
  os.environ['OV_APP_CODEX']='/secret-value/not-a-command'
  with self.assertRaises(hook_setup.HostError) as error:hook_setup.codex()
  self.assertIn('找不到',str(error.exception));self.assertNotIn('secret-value',str(error.exception))

 def fake_host(self,response):
  import sys
  body='#!'+sys.executable+'\nimport json,sys,time\nfor line in sys.stdin:\n r=json.loads(line)\n if "id" not in r:continue\n if r["method"]=="initialize":out={"result":{}}\n else:\n'+''.join('  '+s+'\n' for s in response.splitlines())+'\n print(json.dumps({"id":r["id"],**out}),flush=True)\n'
  os.environ['OV_APP_CODEX']=self.executable('rpc/codex',body)

 def test_rpc_reads_actual_result_and_terminates(self):
  self.fake_host('out={"result":{"data":["ok"]}}')
  with patch.object(hook_setup.subprocess,'Popen',wraps=subprocess.Popen) as launch:
   self.assertEqual(hook_setup.host_request('hooks/list',{}),{'data':['ok']})
   self.assertEqual(launch.call_args.args[0][1:],['app-server','--stdio'])

 def test_rpc_error_body_is_never_shown(self):
  self.fake_host('out={"error":{"code":-32601,"message":"secret API key in arbitrary upstream output"}}')
  with self.assertRaises(hook_setup.HostError) as error:hook_setup.host_request('plugin/list',{})
  self.assertIn('更新 Codex',str(error.exception));self.assertNotIn('secret',str(error.exception))

 def test_rpc_exit_and_timeout_are_explicit(self):
  self.fake_host('sys.exit(2)')
  with self.assertRaisesRegex(hook_setup.HostError,'退出'):hook_setup.host_request('plugin/list',{})
  self.fake_host('time.sleep(3)\nout={"result":{}}')
  with patch.object(hook_setup,'HOST_TIMEOUT',.15):
   with self.assertRaisesRegex(hook_setup.HostError,'超时'):hook_setup.host_request('plugin/list',{})

 def test_rpc_spawn_permission_error_is_sanitized(self):
  os.environ['OV_APP_CODEX']=self.executable('codex')
  with patch.object(hook_setup.subprocess,'Popen',side_effect=PermissionError('private file')):
   with self.assertRaisesRegex(hook_setup.HostError,'无法启动') as error:hook_setup.host_request('plugin/list',{})
  self.assertNotIn('private',str(error.exception))
