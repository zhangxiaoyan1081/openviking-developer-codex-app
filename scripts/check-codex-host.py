"""Read-only fresh Codex app-server probe. No model turn or UI interaction."""
import subprocess,json,threading,queue,time
p=subprocess.Popen(['codex','app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
q=queue.Queue()
def reader():
 for line in p.stdout:
  try:q.put(json.loads(line))
  except ValueError:pass
threading.Thread(target=reader,daemon=True).start()
def call(i,method,params):
 p.stdin.write(json.dumps({'id':i,'method':method,'params':params})+'\n');p.stdin.flush()
 until=time.monotonic()+45
 while time.monotonic()<until:
  value=q.get(timeout=max(.1,until-time.monotonic()))
  if value.get('id')==i:
   if 'error' in value:raise RuntimeError(str(value['error'])[:400])
   return value.get('result',{})
 raise RuntimeError('timeout')
try:
 call(1,'initialize',{'clientInfo':{'name':'ov-acceptance','version':'1'},'capabilities':{'experimentalApi':True}})
 p.stdin.write(json.dumps({'method':'initialized'})+'\n');p.stdin.flush()
 r=call(2,'mcpServerStatus/list',{'limit':100,'detail':'full'})
 rows=r.get('data',[])
 assert any(x.get('name')=='openviking-codex-app' for x in rows), 'Plugin missing from Codex registry'
 for x in rows:
  if 'openviking-codex-app' in str(x.get('name','')):
   assert not x.get('toolsError'), 'Codex failed to load App tools'
   names=list(x.get('tools',{}))
   assert 'show_onboarding' in names and 'publish_work' in names, 'App tools missing'
   print(json.dumps({'codexToolRegistry':'passed','serverInfo':x.get('serverInfo'),'toolNames':names},ensure_ascii=False))
 r=call(3,'mcpServer/resource/read',{'server':'openviking-codex-app','uri':'ui://openviking/personal.html'})
 assert any(x.get('mimeType')=='text/html;profile=mcp-app' for x in r.get('contents',[])), 'Card resource missing'
 print(json.dumps({'codexHostResourceRead':bool(r),'responseFields':list(r),'nativeRendering':'not_verified'}))
finally:
 p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill()
