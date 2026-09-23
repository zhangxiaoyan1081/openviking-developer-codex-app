#!/usr/bin/env python3
"""Install official upstream plus the personal UI; never install a server."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile,sys
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'plugins/openviking-codex-app/scripts'))
import cloud,connection
import hook_setup

def stage_companion(dest):
 """Keep launch paths valid even after Codex replaces a versioned cache."""
 source=ROOT/'plugins/openviking-codex-app'
 files=sorted(p for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc')
 digest=hashlib.sha256()
 for p in files:
  digest.update(str(p.relative_to(source)).encode()+b'\0'+p.read_bytes())
 runtime_parent=dest.parent/'runtimes';runtime_parent.mkdir(parents=True,exist_ok=True)
 runtime=runtime_parent/digest.hexdigest()[:24]
 if not runtime.exists():
  with tempfile.TemporaryDirectory(dir=runtime_parent) as tmp:
   staged=Path(tmp)/'plugin'
   shutil.copytree(source,staged,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
   try:staged.rename(runtime)
   except FileExistsError:pass
 node=shutil.which('node')
 if not node:raise RuntimeError('请先安装 Node.js 22 或以上。')
 config={'mcpServers':{'openviking-codex-app':{'command':str(Path(node).absolute()),'args':[str(runtime/'scripts/app_server.mjs')],'cwd':str(runtime),'env':{'OV_APP_PYTHON':sys.executable,'OV_APP_CODEX':shutil.which('codex') or 'codex'}}}}
 (dest/'plugins/openviking-codex-app/.mcp.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
 return runtime

def commands(lock):
 return ['bash','<verified-official-installer>','--harness','codex','--dist','github','--source','remote','--lang','zh','--url',cloud.ENDPOINT,'--yes']

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--configure-stdin',action='store_true');ap.add_argument('--replace-connection',action='store_true');ap.add_argument('--plan',action='store_true');ap.add_argument('--companion-only',action='store_true');ap.add_argument('--official-only',action='store_true');a=ap.parse_args()
 if a.companion_only and a.official_only:ap.error('不能同时指定 --companion-only 和 --official-only')
 lock=json.loads((ROOT/'upstream.lock.json').read_text())
 installed=hook_setup.installed_plugins()
 existing=hook_setup.official_plugins(installed)
 if a.plan:print(json.dumps({'official':None if a.companion_only or existing else commands(lock),'officialAction':'reuse' if existing else 'skip' if a.companion_only else 'install','commit':lock['commit'],'endpoint':cloud.ENDPOINT,'companion':'openviking-codex-app@ov-personal-cloud'},ensure_ascii=False));return
 if sys.version_info<(3,10):raise RuntimeError('需要 Python 3.10 或以上。')
 for cmd in ('node','codex','git'):
  if not shutil.which(cmd):raise RuntimeError('请先安装 '+cmd+'。')
 if int(subprocess.check_output(['node','--version'],text=True).strip().lstrip('v').split('.')[0])<22:raise RuntimeError('需要 Node.js 22 或以上。')
 if a.configure_stdin:
  data=json.load(sys.stdin);key=data.get('api_key','')
  if not isinstance(key,str) or not key.strip() or key.startswith('{{') or key in ('<API-Key>','mock') or any(c in key for c in '\r\n'):raise RuntimeError('请提供有效 API Key。')
  old,revision=connection.snapshot()
  if old.get('api_key') and (old.get('api_key')!=key or old.get('url')!=cloud.ENDPOINT) and not a.replace_connection:raise RuntimeError('已有其他连接。确认切换后使用 --replace-connection。')
  connection.select(revision=revision,api_key=key,source='console')
 if not a.companion_only and not existing:
  cloud.credentials()
  if not a.configure_stdin:connection.verify(cloud.credentials())
  url='https://raw.githubusercontent.com/volcengine/OpenViking/'+lock['commit']+'/'+lock['installerPath']
  raw=urlopen(url,timeout=45).read()
  if hashlib.sha256(raw).hexdigest()!=lock['installerSha256']:raise RuntimeError('官方安装文件校验失败。')
  with tempfile.TemporaryDirectory() as tmp:
   script=Path(tmp)/'install.sh';script.write_bytes(raw)
   env={**os.environ,'OPENVIKING_REPO_REF':lock['commit'],'OPENVIKING_REPO_URL':lock['repository']}
   cmd=commands(lock);cmd[1]=str(script);subprocess.run(cmd,env=env,check=True)
  # Only a fresh install is normalized; never overwrite an existing plugin or its trust.
  hook_setup.pin_new_install(hook_setup.installed_plugins(),shutil.which('node'))
 elif existing and not a.companion_only:
  print('沿用已安装的官方记忆插件。')
 if a.official_only:return
 # Retain the registered marketplace location and cloud state across the plugin rename.
 installed=hook_setup.installed_plugins()
 legacy_installed=any(p.get('pluginId')=='ov-personal@ov-personal-cloud' for p in installed.get('installed',[]))
 dest=Path.home()/'.local/share/ov-personal/marketplace';dest.mkdir(parents=True,exist_ok=True)
 for name in ('plugins','.agents'):shutil.copytree(ROOT/name,dest/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 stage_companion(dest)
 subprocess.run(['codex','plugin','marketplace','add',str(dest)],check=True)
 subprocess.run(['codex','plugin','add','openviking-codex-app@ov-personal-cloud'],check=True)
 if legacy_installed:subprocess.run(['codex','plugin','remove','ov-personal@ov-personal-cloud'],check=True)
 print('安装完成。请在 Codex 中加载插件，继续接入。')
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e) if isinstance(e,(RuntimeError,cloud.CloudError)) else '安装未完成，请检查依赖和网络。',file=sys.stderr);sys.exit(1)
