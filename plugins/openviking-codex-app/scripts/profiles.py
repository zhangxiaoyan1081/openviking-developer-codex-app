"""Local named connections. Credentials never appear in arguments or output."""
import argparse, contextlib, fcntl, getpass, hashlib, json, os, re, subprocess, sys, time, uuid
from pathlib import Path
import cloud, connection

ROOT = Path.home()/'.openviking/connections'
STATE = Path.home()/'.openviking/codex-plugin-state'

def name_ok(name):
 if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,47}',name):
  raise cloud.CloudError('连接名称只支持字母、数字、短横线和下划线。')
 return name

def fingerprint(config):
 return hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()

def load(path):
 return json.loads(path.read_text())

@contextlib.contextmanager
def locked():
 ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
 with (ROOT/'lock').open('a') as f:
  os.chmod(ROOT/'lock',0o600);fcntl.flock(f,fcntl.LOCK_EX)
  yield

def profile(name):
 return load(ROOT/name_ok(name)/'profile.json')

def active():
 return load(ROOT/'active.json')['name']

def assert_stopped():
 result=subprocess.run(['/bin/ps','-axo','pid=,comm=,args='],capture_output=True,text=True,check=True)
 for line in result.stdout.splitlines():
  parts=line.strip().split(None,2)
  if len(parts)<3 or int(parts[0])==os.getpid():continue
  comm,args=parts[1:]
  if Path(comm).name in ('ChatGPT','Codex','codex') or any(x in args for x in ('/scripts/auto-capture.mjs','/scripts/session-end.mjs','/scripts/session-start-commit.mjs','/scripts/pre-compact-capture.mjs','/scripts/mcp-proxy.mjs','/servers/mcp-proxy.mjs','/scripts/app_server.mjs','/scripts/panel.py')):
   raise cloud.CloudError('请先完全退出 Codex，并等待记忆后台进程结束，再切换连接。')

def initialize(name='current'):
 """Register current configuration byte-for-byte without switching or uploading."""
 with locked():
  if (ROOT/'active.json').exists():return active()
  name_ok(name);config=cloud.credentials();directory=ROOT/name
  directory.mkdir(mode=0o700)
  cloud.atomic(directory/'config.json',config)
  cloud.atomic(directory/'profile.json',{'name':name,'stateDir':str(STATE),'createdAt':0,'fingerprint':fingerprint(config)})
  cloud.atomic(ROOT/'active.json',{'name':name})
  return name

def add(name,key,account=None,user=None,database_id=None,service_name=None):
 name_ok(name)
 if service_name is not None:
  if not isinstance(service_name,str) or len(service_name)>80 or any(ord(c)<32 for c in service_name):raise cloud.CloudError("服务展示名需为不超过 80 字的单行文字。")
  service_name=service_name.strip() or None
 # Validate candidate independently. Never inherit identity or plugin settings from another user.
 config={'url':cloud.ENDPOINT,'api_key':key}
 for field,value in (('account',account),('user',user)):
  if value:config[field]=value
 cloud.validate_credentials(config);identity=connection.verify(config) or {}
 actual_db=identity.get('database_id') or identity.get('databaseId')
 if database_id and actual_db and database_id!=actual_db:raise cloud.CloudError('库 ID 与服务端返回不一致，未保存绑定。')
 database_id=actual_db or database_id
 if database_id is not None and (not isinstance(database_id,str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}',database_id)):raise cloud.CloudError('库 ID 格式无效。')
 with locked():
  for row in rows():
   old=load(ROOT/row['name']/'config.json')
   same_identity=(old.get('account') or old.get('account_id') or 'default')==(config.get('account') or 'default') and (old.get('user') or old.get('user_id') or 'default')==(config.get('user') or 'default')
   if same_identity and (old.get('api_key')==config.get('api_key') or (database_id and row.get('databaseId')==database_id)):
    raise cloud.CloudError('此用户与库已有绑定，请使用切换用户，不必重复添加。')
  directory=ROOT/name
  if directory.exists():raise cloud.CloudError('此连接名称已存在，请使用其他名称。')
  directory.mkdir(mode=0o700)
  cloud.atomic(directory/'config.json',config)
  cloud.atomic(directory/'profile.json',{'name':name,'stateDir':str(directory/'hook-state'),'createdAt':int(time.time()*1000),'fingerprint':fingerprint(config),'serviceName':service_name,'databaseId':database_id,'databaseIdSource':'server' if actual_db else 'user' if database_id else 'unknown'})
 return name

def recover():
 """Fail-safe rollback if interrupted between active config and active marker."""
 journal=ROOT/'switch.json'
 if not journal.exists():return
 previous=load(journal)['previous']
 cloud.atomic(cloud.CONFIG,load(ROOT/previous/'config.json'))
 cloud.atomic(ROOT/'active.json',{'name':previous})
 journal.unlink()

def assert_hook_isolation():
 import hook_setup, shlex
 plugins=hook_setup.official_plugins(hook_setup.installed_plugins())
 if len(plugins)!=1:raise cloud.CloudError('无法确认官方插件，请重新安装切换器。')
 hooks=load(hook_setup.cache_root(plugins[0])/'hooks/hooks.json')
 wrapper=str(Path.home()/'.local/share/openviking-switcher/hook.mjs')
 commands=[h.get('command','') for groups in hooks['hooks'].values() for group in groups for h in group['hooks']]
 if not commands or any(len(a:=shlex.split(c))!=3 or a[1]!=wrapper for c in commands):
  raise cloud.CloudError('官方插件更新或 Hook 包装已变化，请重新安装切换器后再切换。')

def host_processes():
 result=subprocess.run(['/bin/ps','-axo','pid=,lstart=,comm='],capture_output=True,text=True,check=True)
 return [line.strip() for line in result.stdout.splitlines() if Path(line.split()[-1]).name in ('ChatGPT','Codex','codex')]

def assert_live_isolation():
 assert_hook_isolation()
 marker=ROOT/'legacy-hosts.json'
 if not marker.exists():raise cloud.CloudError('请先更新连接隔离组件。')
 if set(load(marker)).intersection(host_processes()):raise cloud.CloudError('连接隔离组件刚完成升级，请重启 Codex 一次后继续；当前连接未切换。')
 import hook_setup
 plugin=hook_setup.official_plugins(hook_setup.installed_plugins())[0]
 mcp=load(hook_setup.cache_root(plugin)/'.mcp.json')['mcpServers']['openviking-memory']
 if not mcp.get('args') or mcp['args'][0]!=str(Path.home()/'.local/share/openviking-switcher/mcp.mjs'):
  raise cloud.CloudError('MCP 连接隔离未就绪，请更新插件后继续。')

def mcp(node,script):
 with locked():
  if (ROOT/'switch.json').exists():raise cloud.CloudError('连接切换尚未完成。')
  name=active();meta=profile(name)
  if fingerprint(cloud.credentials())!=meta['fingerprint']:raise cloud.CloudError('连接配置不一致。')
  env={**os.environ,'OPENVIKING_CLI_CONFIG_FILE':str(ROOT/name/'config.json'),'OPENVIKING_CREDENTIAL_SOURCE':'cli'}
 os.execve(node,[node,script],env)

def switch(name,live=False):
 name_ok(name)
 if live:assert_live_isolation()
 else:assert_stopped();assert_hook_isolation()
 with locked():
  recover();old=active();current=cloud.credentials()
  if fingerprint(current)!=profile(old)['fingerprint']:
   raise cloud.CloudError('当前配置在切换器之外发生变化，已停止切换；请先核对。')
  candidate=load(ROOT/name/'config.json');meta=profile(name)
  if fingerprint(candidate)!=meta['fingerprint']:raise cloud.CloudError('已保存配置发生变化，请先核对。')
  identity=connection.verify(dict(candidate)) or {}
  actual_db=identity.get('database_id') or identity.get('databaseId')
  if actual_db and meta.get('databaseId') and actual_db!=meta['databaseId']:raise cloud.CloudError('库 ID 已变化，未切换连接，请核对绑定。')
  if fingerprint(candidate)!=meta['fingerprint']:raise cloud.CloudError('服务端身份已变化，请重新登记连接。')
  if not live:assert_stopped()
  cloud.atomic(ROOT/'switch.json',{'previous':old,'target':name})
  try:
   cloud.atomic(cloud.CONFIG,candidate)
   cloud.atomic(ROOT/'active.json',{'name':name})
   previous=cloud.load('connection.json',{});now=connection.datetime.now(connection.timezone.utc).isoformat()
   cloud.save('connection.json',{**previous,'verifiedAt':previous.get('verifiedAt') or now,'lastValidatedAt':now,'source':'profile-switch','changedAt':time.time(),'blockedRuntime':os.environ.get('OV_APP_RUNTIME_ID')})
   (ROOT/'switch.json').unlink()
  except BaseException:
   recover();raise
 return name

def rows():
 chosen=active() if (ROOT/'active.json').exists() else None
 result=[]
 for p in sorted(ROOT.glob('*/profile.json')):
  meta=load(p);c=load(p.parent/'config.json')
  result.append({'name':meta['name'],'active':meta['name']==chosen,'account':c.get('account') or c.get('account_id') or 'default','user':c.get('user') or c.get('user_id') or 'default','serviceName':meta.get('serviceName') or meta['name'],'databaseId':meta.get('databaseId'),'databaseIdSource':meta.get('databaseIdSource','unknown')})
 return result

def hook_environment(payload):
 with locked():
  if (ROOT/'switch.json').exists():raise cloud.CloudError('连接切换未完成，自动记忆已暂停。请退出 Codex 后运行切换器。')
  name=active();meta=profile(name);candidate=load(ROOT/name/'config.json')
  if fingerprint(cloud.credentials())!=meta['fingerprint'] or fingerprint(candidate)!=meta['fingerprint']:
   raise cloud.CloudError('连接配置不一致，自动记忆已暂停，请使用切换器。')
  sid=payload.get('session_id')
  try:session=uuid.UUID(sid)
  except (ValueError,TypeError,AttributeError):raise cloud.CloudError('无法识别任务归属，已跳过自动记忆。') from None
  if session.version!=7:raise cloud.CloudError('无法识别任务创建时间，已跳过自动记忆。')
  owners=ROOT/'sessions';owners.mkdir(exist_ok=True,mode=0o700)
  owner=owners/(str(session)+'.json')
  if owner.exists():
   if load(owner)['name']!=name:raise cloud.CloudError('此任务属于另一 OpenViking 连接，已跳过自动记忆；请为当前连接新建任务。')
  else:
   created=session.int>>80
   if created<meta['createdAt']:raise cloud.CloudError('此任务早于当前连接创建，已跳过自动记忆；请新建任务。')
   cloud.atomic(owner,{'name':name})
  return {**os.environ,'OPENVIKING_CODEX_STATE_DIR':meta['stateDir'],'OPENVIKING_CLI_CONFIG_FILE':str(ROOT/name/'config.json'),'OPENVIKING_CREDENTIAL_SOURCE':'cli'}

def hook(node,script):
 raw=sys.stdin.read()
 try:
  env=hook_environment(json.loads(raw))
 except (cloud.CloudError,ValueError) as e:
  print(json.dumps({'systemMessage':str(e) if isinstance(e,cloud.CloudError) else '无法识别 Hook 输入，已跳过自动记忆。'},ensure_ascii=False));return
 subprocess.run([node,script],input=raw,text=True,env=env,check=True)

def main():
 ap=argparse.ArgumentParser(description='OpenViking 多用户连接切换器')
 sub=ap.add_subparsers(dest='action')
 sub.add_parser('init').add_argument('--name',default='current')
 sub.add_parser('list')
 a=sub.add_parser('add');a.add_argument('name');a.add_argument('--account');a.add_argument('--user')
 sub.add_parser('switch').add_argument('name')
 a=sub.add_parser('hook');a.add_argument('node');a.add_argument('script')
 a=sub.add_parser('mcp');a.add_argument('node');a.add_argument('script')
 args=ap.parse_args()
 if args.action=='hook':hook(args.node,args.script);return
 if args.action=='mcp':mcp(args.node,args.script);return
 if args.action=='init':print('已保留当前连接：'+initialize(args.name));return
 if args.action=='list':print(json.dumps(rows(),ensure_ascii=False,indent=2));return
 if args.action=='add':
  if not sys.stdin.isatty():raise cloud.CloudError('请在本地终端运行，API Key 通过隐藏输入录入。')
  key=getpass.getpass('API Key（输入不显示）: ')
  add(args.name,key,args.account,args.user);print('连接已验证并保存，当前连接未切换。');return
 if args.action=='switch':switch(args.name);print('已切换到 '+args.name+'。请重新打开 Codex，并为此连接使用独立任务。');return
 initialize()
 for row in rows():print(('● ' if row['active'] else '  ')+row['name']+'  '+row['account']+' / '+row['user'])
 action=input('\n输入连接名称进行切换；输入 + 添加连接；回车退出：').strip()
 if not action:return
 if action=='+':
  name=input('连接名称（英文）: ').strip();account=input('Account（可留空自动识别）: ').strip();user=input('User（可留空自动识别）: ').strip()
  add(name,getpass.getpass('API Key（输入不显示）: '),account,user);print('已保存，当前连接未切换。')
 else:switch(action);print('已切换。请重新打开 Codex，为该连接使用独立任务。')

if __name__=='__main__':
 try:main()
 except (cloud.CloudError,OSError,ValueError,subprocess.SubprocessError) as e:
  print(str(e) if isinstance(e,cloud.CloudError) else '操作未完成，当前连接未成功切换。',file=sys.stderr);sys.exit(1)
