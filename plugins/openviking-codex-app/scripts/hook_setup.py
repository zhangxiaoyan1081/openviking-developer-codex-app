"""Read-only host checks; user enables/trusts hooks in Codex, never in this app."""
import json, os, queue, shlex, shutil, subprocess, threading, time
from pathlib import Path
import cloud

OFFICIAL = 'openviking-memory@openviking'
HOST_TIMEOUT = 20

class HostError(cloud.CloudError):
    """Safe, actionable local-host error; never includes subprocess output."""

def bundle_candidates(bundle):
    return [bundle/'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
            bundle/'Contents/Resources/codex']

def desktop_candidates():
    for folder in (Path('/Applications'),Path.home()/'Applications'):
        for name in ('ChatGPT.app','Codex.app'):
            yield from bundle_candidates(folder/name)

def executable(value):
    if not value:return None
    path=Path(value).expanduser()
    if not path.is_absolute():
        found=shutil.which(str(path))
        if not found:return None
        path=Path(found).absolute()
    return str(path) if path.is_file() and os.access(path,os.X_OK) else None

def codex():
    # Old manifests and already-running MCP processes may retain an obsolete
    # OV_APP_CODEX after a desktop upgrade. Resolve on every operation, not install.
    hint=os.environ.get('OV_APP_CODEX')
    candidates=[hint]
    if hint:
        # Prefer the same app when it moved its bundled CLI. Also covers custom
        # install locations and names, without recursively searching the disk.
        path=Path(hint).expanduser()
        bundles=[p for p in reversed(path.parents) if p.suffix=='.app']
        if bundles:candidates.extend(bundle_candidates(bundles[0]))
    candidates.append(shutil.which('codex'))
    candidates.extend(desktop_candidates())
    for candidate in candidates:
        found=executable(candidate)
        if found:return found
    raise HostError('找不到可运行的 Codex。请安装或重新打开 Codex 后重试；原连接未切换。')

def installed_plugins():
    result=host_request('plugin/list',{'marketplaceKinds':['local'],'forceRefetch':False})
    return {'installed':[{'name':p['name'],'pluginId':p['id'],'marketplaceName':m['name'],'version':p.get('localVersion') or p.get('version'),'enabled':p.get('enabled',False)} for m in result.get('marketplaces',[]) for p in m.get('plugins',[]) if p.get('installed')]}

def official_plugins(value):
    return [p for p in value.get('installed',[]) if p.get('name')=='openviking-memory' or p.get('pluginId','').startswith('openviking-memory@')]

def cache_root(plugin):
    home=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))
    return home/'plugins/cache'/plugin['marketplaceName']/'openviking-memory'/plugin['version']

def pin_new_install(installed,node):
    """Called only immediately after installing an absent official plugin."""
    plugins=official_plugins(installed)
    if len(plugins)!=1 or plugins[0]['pluginId']!=OFFICIAL:
        raise RuntimeError('官方插件安装结果不明确，请在 Codex 中检查。')
    root=cache_root(plugins[0]);node=str(Path(node).absolute())
    # Check the same absolute executable with a desktop-like PATH, no hooks run.
    subprocess.run([node,'--version'],env={**os.environ,'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},check=True,capture_output=True,timeout=5)
    paths=[root/'.mcp.json',root/'hooks/hooks.json']
    docs=[json.loads(p.read_text()) for p in paths]
    server=docs[0]['mcpServers']['openviking-memory']
    if server.get('command')=='node':server['command']=node
    for groups in docs[1]['hooks'].values():
        for group in groups:
            for hook in group.get('hooks',[]):
                if hook.get('command','').startswith('node '):
                    hook['command']=shlex.quote(node)+hook['command'][4:]
    for p,doc in zip(paths,docs):
        cloud.atomic(p,doc)
    print('官方插件已安装。请在 Codex 的 /hooks 中启用并信任 OpenViking Hooks。')

def host_hooks(cwd):
    return host_request('hooks/list',{'cwds':[cwd]})

def host_request(method,params):
    try:
        p=subprocess.Popen([codex(),'app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    except OSError:
        raise HostError('Codex 本机检查无法启动，请重新打开 Codex 后重试；原连接未切换。') from None
    q=queue.Queue()
    def reader():
        for line in p.stdout:
            try:q.put(json.loads(line))
            except ValueError:pass
        q.put(None)
    threading.Thread(target=reader,daemon=True).start()
    deadline=time.monotonic()+HOST_TIMEOUT
    def call(i,method,params):
        p.stdin.write(json.dumps({'id':i,'method':method,'params':params})+'\n');p.stdin.flush()
        while time.monotonic()<deadline:
            v=q.get(timeout=max(.01,deadline-time.monotonic()))
            if v is None:raise HostError('Codex 本机检查进程已退出，请重新打开 Codex 后重试；原连接未切换。')
            if not isinstance(v,dict):continue
            if v.get('id')==i:
                if 'error' in v:raise HostError('当前 Codex 无法完成插件检查，请更新 Codex 后重试；原连接未切换。')
                if not isinstance(v.get('result'),dict):raise HostError('Codex 检查返回异常，请重试；原连接未切换。')
                return v['result']
        raise queue.Empty()
    try:
        call(1,'initialize',{'clientInfo':{'name':'ov-hook-check','version':'1'},'capabilities':{'experimentalApi':True}})
        p.stdin.write('{"method":"initialized"}\n');p.stdin.flush()
        return call(2,method,params)
    except queue.Empty:
        raise HostError('Codex 本机检查超时，请稍后重试；原连接未切换。') from None
    except OSError:
        raise HostError('Codex 本机检查已中断，请重试；原连接未切换。') from None
    finally:
        p.terminate()
        try:p.wait(timeout=2)
        except subprocess.TimeoutExpired:p.kill();p.wait()
        p.stdin.close();p.stdout.close()

def inspect(cwd):
    """No API credentials, transcripts, trust mutations or hook execution."""
    plugins=official_plugins(installed_plugins())
    if not plugins:return {'status':'absent','automaticReady':False,'manualReady':True,'message':'尚未安装官方记忆插件。'}
    if len(plugins)!=1:return {'status':'conflict','automaticReady':False,'manualReady':False,'message':'检测到多个记忆插件，请先保留一个。'}
    plugin=plugins[0];root=cache_root(plugin)
    manifest=json.loads((root/'hooks/hooks.json').read_text())
    expected=sum(len(g.get('hooks',[])) for groups in manifest['hooks'].values() for g in groups)
    response=host_hooks(cwd)
    entries=response.get('data',[])
    if not entries or any(e.get('errors') for e in entries):raise RuntimeError('无法核对 Hooks')
    hooks=[h for e in entries for h in e.get('hooks',[]) if h.get('pluginId')==plugin['pluginId']]
    enabled=[h for h in hooks if h.get('enabled')]
    # Trust alone cannot prove execution; disabled hooks are safe for manual mode.
    manual=not enabled and (bool(hooks) or plugin.get('enabled') is False)
    trusted=bool(hooks) and len(hooks)==expected and all(h.get('enabled') and h.get('trustStatus') in ('trusted','managed') for h in hooks)
    launch_ok=True
    for h in enabled:
        argv=shlex.split(h.get('command',''))
        if not argv or not Path(argv[0]).is_absolute() or Path(argv[0]).name not in ('node','nodejs'):launch_ok=False;continue
        try:subprocess.run([argv[0],'--version'],env={**os.environ,'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},check=True,capture_output=True,timeout=3)
        except (OSError,subprocess.SubprocessError):launch_ok=False
    # Official config loader accounts for environment and project overrides.
    automatic=False
    if trusted and launch_ok:
        node=shlex.split(enabled[0]['command'])[0]
        js="const {loadConfig}=await import(process.argv[1]);const c=loadConfig(process.argv[2]);console.log(JSON.stringify({autoRecall:c.autoRecall,autoCapture:c.autoCapture}));"
        flags=json.loads(subprocess.check_output([node,'--input-type=module','-e',js,(root/'scripts/config.mjs').as_uri(),cwd],text=True,timeout=5,stderr=subprocess.DEVNULL))
        automatic=flags.get('autoRecall') is True and flags.get('autoCapture') is True
    features=subprocess.check_output([codex(),'features','list'],text=True,timeout=5,stderr=subprocess.DEVNULL)
    effective={p[0]:p[-1] for line in features.splitlines() if len(p:=line.split())>=3}
    hooks_on=effective.get('hooks',effective.get('plugin_hooks'))
    if hooks_on not in ('true','false'):raise RuntimeError('无法核对 Hooks 开关')
    if hooks_on=='false':automatic=False;manual=True
    status='ready' if automatic else 'disabled' if manual else 'runtime' if not launch_ok else 'review'
    message={'ready':'自动记忆已启用。','disabled':'自动记忆已关闭。','runtime':'启动环境需要修复，请让 Codex 检查 Node 路径。','review':'在 Codex 输入 /hooks，启用并信任 OpenViking Hooks。'}[status]
    return {'status':status,'automaticReady':automatic,'manualReady':manual,'message':message,'count':len(hooks),'enabled':len(enabled),'checkedAt':time.time()}
