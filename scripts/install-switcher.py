#!/usr/bin/env python3
"""Install the opt-in local switcher without changing credentials or hook trust."""
import argparse, json, os, shlex, shutil, sys, tempfile
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/'plugins/openviking-codex-app/scripts'
sys.path.insert(0,str(SOURCE))
import cloud, profiles, hook_setup

def launcher_script(root):
 return '#!/bin/sh\nexec '+shlex.quote(str(Path(sys.executable).absolute()))+' '+shlex.quote(str(root/'profiles.py'))+' "$@"\n'

def replace_file(path,content,mode):
 with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
  temporary=Path(f.name)
  try:
   f.write(content);f.flush();os.fchmod(f.fileno(),mode)
   os.replace(temporary,path)
  finally:temporary.unlink(missing_ok=True)

def refresh_host_support():
 """Update an existing switcher's resolver only. No trust/config/profile writes."""
 root=Path.home()/'.local/share/openviking-switcher'
 if not (root/'profiles.py').is_file():return False
 replace_file(root/'hook_setup.py',(SOURCE/'hook_setup.py').read_bytes(),0o600)
 launcher=Path.home()/'.local/bin/ov-user'
 if launcher.is_file():replace_file(launcher,launcher_script(root).encode(),0o700)
 return True

def main():
 root=Path.home()/'.local/share/openviking-switcher'
 root.mkdir(parents=True,exist_ok=True,mode=0o700)
 plugins=hook_setup.official_plugins(hook_setup.installed_plugins())
 if len(plugins)!=1:raise RuntimeError('请先安装且仅保留一个官方记忆插件。')
 hooks=hook_setup.cache_root(plugins[0])/'hooks/hooks.json'
 doc=json.loads(hooks.read_text());commands=[]
 node=shutil.which('node')
 if not node:raise RuntimeError('未找到 Node.js。')
 for groups in doc['hooks'].values():
  for group in groups:
   for h in group['hooks']:
    argv=shlex.split(h['command'])
    if len(argv)==2 and Path(argv[0]).name in ('node','nodejs'):
     script=argv[1]
    elif len(argv)==3 and argv[1]==str(root/'hook.mjs'):script=argv[2]
    else:raise RuntimeError('Hook 命令已有其他自定义，未覆盖；请先核对。')
    if not script.startswith('${PLUGIN_ROOT}/scripts/') or not script.endswith('.mjs'):raise RuntimeError('Hook 路径无法识别。')
    commands.append((h,script))
 # Preserve all current configuration and capture state before enabling the wrapper.
 before=cloud.CONFIG.read_bytes();profiles.initialize()
 for name in ('profiles.py','cloud.py','connection.py','hook_setup.py'):
  shutil.copy2(SOURCE/name,root/name)
 python=str(Path(sys.executable).absolute())
 wrapper="import {spawn} from 'node:child_process';\nconst p=spawn("+json.dumps(python)+",["+json.dumps(str(root/'profiles.py'))+",'hook',process.execPath,process.argv[2]],{stdio:'inherit'});\np.on('error',()=>process.exit(1));p.on('exit',code=>process.exit(code??1));\n"
 (root/'hook.mjs').write_text(wrapper)
 mcp_path=hooks.parent.parent/'.mcp.json'
 mcp_doc=json.loads(mcp_path.read_text());server=mcp_doc['mcpServers']['openviking-memory']
 if server.get('args',[None])[0]!=str(root/'mcp.mjs'):
  cloud.atomic(profiles.ROOT/'legacy-hosts.json',profiles.host_processes())
  shutil.copy2(mcp_path,root/'mcp-before-isolation.json')
 (root/'mcp.mjs').write_text(wrapper.replace("'hook'","'mcp'"))
 server['command']=node;server['args']=[str(root/'mcp.mjs'),str(hooks.parent.parent/'servers/mcp-proxy.mjs')]
 cloud.atomic(mcp_path,mcp_doc)
 backup=root/('hooks-before-'+__import__('datetime').datetime.now().strftime('%Y%m%d%H%M%S')+'.json')
 shutil.copy2(hooks,backup)
 for h,script in commands:
  h['command']=shlex.quote(node)+' '+shlex.quote(str(root/'hook.mjs'))+' "'+script+'"'
 cloud.atomic(hooks,doc)
 bin_dir=Path.home()/'.local/bin';bin_dir.mkdir(parents=True,exist_ok=True)
 # Resolve the host when the switcher runs; desktop upgrades can move its CLI.
 launcher=launcher_script(root)
 (bin_dir/'ov-user').write_text(launcher);os.chmod(bin_dir/'ov-user',0o700)
 ui='#!/bin/sh\n'+shlex.quote(str(bin_dir/'ov-user'))+'\nprintf "\\n按回车关闭窗口…"\nread answer\n'
 (root/'OpenViking Switcher.command').write_text(ui);os.chmod(root/'OpenViking Switcher.command',0o700)
 assert before==cloud.CONFIG.read_bytes()
 print(json.dumps({'current':profiles.active(),'launcher':str(root/'OpenViking Switcher.command'),'cli':str(bin_dir/'ov-user'),'hooks':len(commands),'trustChanged':True,'currentConfigUnchanged':True},ensure_ascii=False))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--host-only',action='store_true');args=parser.parse_args()
 if args.host_only:print(json.dumps({'hostSupportUpdated':refresh_host_support()}))
 else:main()
