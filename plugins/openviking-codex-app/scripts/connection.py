"""Explicit, verified selection of the official cloud connection. Never echo keys."""
import fcntl,hashlib,json,os,time
from datetime import datetime,timezone
import cloud

def snapshot():
 try:raw=cloud.CONFIG.read_bytes()
 except FileNotFoundError:raw=b''
 try:value=json.loads(raw) if raw else {}
 except ValueError:raise cloud.CloudError('连接配置无法读取，请先在 Codex 中修复。') from None
 if not isinstance(value,dict):raise cloud.CloudError('连接配置无法读取，请先在 Codex 中修复。')
 return value,hashlib.sha256(raw).hexdigest()

def status():
 try:
  old,revision=snapshot();has_key=bool(old.get('api_key'));can_reuse=False
  cloud.check_environment()
  try:cloud.validate_credentials(old);can_reuse=True
  except cloud.CloudError:pass
  mark=cloud.load('connection.json',{}) if can_reuse else {}
  # A key switch must not keep using the official proxy's old in-process credentials.
  runtime=os.environ.get('OV_APP_RUNTIME_ID')
  restart=bool((mark.get('blockedRuntime') and mark['blockedRuntime']==runtime) or (os.environ.get('OV_APP_STARTED_AT') and float(os.environ['OV_APP_STARTED_AT'])<=mark.get('changedAt',0)))
  accepted=bool(mark.get('verifiedAt'))
  return {'hasKey':has_key,'canReuse':can_reuse,'revision':revision,'ready':accepted and not restart,'restartRequired':restart,'verifiedAt':mark.get('verifiedAt'),'endpoint':cloud.ENDPOINT}
 except (cloud.CloudError,OSError) as e:
  return {'hasKey':False,'canReuse':False,'ready':False,'blocked':True,'message':str(e) if isinstance(e,cloud.CloudError) else '连接配置无法读取。','endpoint':cloud.ENDPOINT}

def require_ready():
 if not status().get('ready'):raise cloud.CloudError('请先完成连接确认。')

def verify(candidate):
 listing=cloud.request('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/list'},config=candidate,timeout=15)
 if not isinstance(listing.get('result',{}).get('tools'),list):raise cloud.CloudError('无法验证连接，请稍后重试。')
 result=cloud.request('/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'list','arguments':{'uri':'viking://user/default/resources'}}},config=candidate,timeout=15).get('result',{})
 if result.get('isError') or not isinstance(result.get('content'),list):raise cloud.CloudError('当前 Key 无法读取个人空间，请核对后重试。')

def select(*,revision,api_key=None,source='card'):
 cloud.check_environment()
 cloud.ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(cloud.ROOT/'connection.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  old,current=snapshot()
  if revision!=current:raise cloud.CloudError('连接已变化，请刷新卡片后重试。')
  if api_key is None:candidate=cloud.validate_credentials(old)
  else:
   if not isinstance(api_key,str) or not api_key.strip() or len(api_key)>8192 or any(c.isspace() for c in api_key) or api_key.startswith(('<','{{')) or api_key=='mock':raise cloud.CloudError('请填写有效的 API Key。')
   candidate={**old,'url':cloud.ENDPOINT,'api_key':api_key}
   if old.get('api_key')!=api_key or old.get('url','').rstrip('/')!=cloud.ENDPOINT:
    for field in ('account','account_id','user','user_id','peer_id'):candidate.pop(field,None)
  cloud.validate_credentials(candidate)
  verify(candidate)
  if snapshot()[1]!=current:raise cloud.CloudError('连接已变化，请刷新卡片后重试。')
  changed=candidate!=old
  if changed:cloud.atomic(cloud.CONFIG,candidate)
  # A repeated click must not clear a pending restart for this same runtime.
  previous=cloud.load('connection.json',{})
  blocked=os.environ.get('OV_APP_RUNTIME_ID') if changed else previous.get('blockedRuntime')
  cloud.save('connection.json',{'verifiedAt':datetime.now(timezone.utc).isoformat(),'source':source,'blockedRuntime':blocked,'changedAt':time.time() if changed else previous.get('changedAt',0)})
  return status()
