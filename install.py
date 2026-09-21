#!/usr/bin/env python3
"""Install official upstream plus the personal UI; never install a server."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile,sys
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'plugins/ov-personal/scripts'))
import cloud

def commands(lock):
 return ['bash','<verified-official-installer>','--harness','codex','--dist','github','--source','remote','--lang','zh','--url',cloud.ENDPOINT,'--yes']

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--configure-stdin',action='store_true');ap.add_argument('--replace-connection',action='store_true');ap.add_argument('--plan',action='store_true');ap.add_argument('--companion-only',action='store_true');a=ap.parse_args()
 lock=json.loads((ROOT/'upstream.lock.json').read_text())
 if a.plan:print(json.dumps({'official':None if a.companion_only else commands(lock),'commit':lock['commit'],'endpoint':cloud.ENDPOINT,'companion':'ov-personal@ov-personal-cloud'},ensure_ascii=False));return
 if sys.version_info<(3,10):raise RuntimeError('需要 Python 3.10 或以上。')
 for cmd in ('node','codex','git'):
  if not shutil.which(cmd):raise RuntimeError('请先安装 '+cmd+'。')
 if int(subprocess.check_output(['node','--version'],text=True).strip().lstrip('v').split('.')[0])<22:raise RuntimeError('需要 Node.js 22 或以上。')
 if a.configure_stdin:
  data=json.load(sys.stdin);key=data.get('api_key','')
  if not isinstance(key,str) or not key.strip() or key.startswith('{{') or key in ('<API-Key>','mock') or any(c in key for c in '\r\n'):raise RuntimeError('请提供有效 API Key。')
  old=json.loads(cloud.CONFIG.read_text()) if cloud.CONFIG.exists() else {}
  if old.get('api_key') and (old.get('api_key')!=key or old.get('url')!=cloud.ENDPOINT) and not a.replace_connection:raise RuntimeError('已有其他连接。确认切换后使用 --replace-connection。')
  cloud.atomic(cloud.CONFIG,{**old,'url':cloud.ENDPOINT,'api_key':key})
 cloud.credentials()
 # Authentication/read availability must be checked before replacing official registration.
 cloud.request('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/list'})
 if not a.companion_only:
  url='https://raw.githubusercontent.com/volcengine/OpenViking/'+lock['commit']+'/'+lock['installerPath']
  raw=urlopen(url,timeout=45).read()
  if hashlib.sha256(raw).hexdigest()!=lock['installerSha256']:raise RuntimeError('官方安装文件校验失败。')
  with tempfile.TemporaryDirectory() as tmp:
   script=Path(tmp)/'install.sh';script.write_bytes(raw)
   env={**os.environ,'OPENVIKING_REPO_REF':lock['commit'],'OPENVIKING_REPO_URL':lock['repository']}
   cmd=commands(lock);cmd[1]=str(script);subprocess.run(cmd,env=env,check=True)
 dest=Path.home()/'.local/share/ov-personal/marketplace';dest.mkdir(parents=True,exist_ok=True)
 for name in ('plugins','.agents'):shutil.copytree(ROOT/name,dest/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 subprocess.run(['codex','plugin','marketplace','add',str(dest)],check=True)
 subprocess.run(['codex','plugin','add','ov-personal@ov-personal-cloud'],check=True)
 print('安装完成。请在 Codex 中加载插件，继续接入。')
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e) if isinstance(e,(RuntimeError,cloud.CloudError)) else '安装未完成，请检查依赖和网络。',file=sys.stderr);sys.exit(1)
