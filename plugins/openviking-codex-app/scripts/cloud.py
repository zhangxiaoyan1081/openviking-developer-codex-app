"""Commercial-only client. Shares the official plugin's ovcli.conf; no hooks."""
import hashlib,json,os,tempfile
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError,URLError
ENDPOINT='https://api.vikingdb.cn-beijing.volces.com/openviking'
CONFIG=Path.home()/'.openviking/ovcli.conf'
ROOT=Path.home()/'.openviking/personal'
class CloudError(RuntimeError):pass
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None

def atomic(path,value):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,name=tempfile.mkstemp(dir=path.parent,prefix='.'+path.name)
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f,ensure_ascii=False,indent=2)
  os.chmod(name,0o600);os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)

def check_environment():
 # Fail explicitly instead of silently differing from the official env resolver.
 overrides=[k for k in os.environ if k.startswith('OPENVIKING_') and k in ('OPENVIKING_URL','OPENVIKING_BASE_URL','OPENVIKING_MCP_URL','OPENVIKING_API_KEY','OPENVIKING_BEARER_TOKEN','OPENVIKING_CONFIG_FILE','OPENVIKING_ACCOUNT','OPENVIKING_USER','OPENVIKING_CREDENTIAL_SOURCE','OPENVIKING_CREDENTIALS_SOURCE','OPENVIKING_CLI_CONFIG_FILE','OPENVIKING_HOME','OPENVIKING_EXTRA_HEADERS') and os.environ[k]]
 if overrides:raise CloudError('检测到其他连接设置，请先在 Codex 中统一连接。')

def credentials():
 check_environment()
 try:c=json.loads(CONFIG.read_text())
 except FileNotFoundError:raise CloudError('请先在 Codex 中完成接入。') from None
 except (ValueError,OSError):raise CloudError('连接配置无法读取，请重新接入。') from None
 return validate_credentials(c)

def validate_credentials(c):
 if not isinstance(c,dict):raise CloudError('连接配置无法读取，请重新接入。')
 if c.get('url','').rstrip('/')!=ENDPOINT:raise CloudError('请连接火山 OpenViking。')
 if not isinstance(c.get('api_key'),str) or not c['api_key'].strip() or any(x in c['api_key'] for x in '\r\n'):raise CloudError('请补充有效 API Key。')
 if c.get('user',c.get('user_id','default')) not in ('','default'):raise CloudError('当前版本仅支持 default 用户，请核对连接身份。')
 return c

def folder():
 c=credentials();identity='\0'.join(str(c.get(k,'')) for k in ('url','api_key','account','account_id','user','user_id'))
 return ROOT/hashlib.sha256(identity.encode()).hexdigest()[:24]

def load(name,default=None):
 try:return json.loads((folder()/name).read_text())
 except FileNotFoundError:return default

def save(name,value):atomic(folder()/name,value)

def request(path,body=None,*,config=None,timeout=45):
 if not path.startswith('/api/v1/') and path!='/mcp':raise CloudError('不支持的请求。')
 c=credentials() if config is None else validate_credentials(config);headers={'Authorization':'Bearer '+c['api_key'],'Accept':'application/json, text/event-stream','Content-Type':'application/json'}
 for field,header in [('account','X-OpenViking-Account'),('user','X-OpenViking-User')]:
  if c.get(field):headers[header]=c[field]
 try:
  with build_opener(NoRedirect()).open(Request(ENDPOINT+path,data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=timeout) as response:
   raw=response.read(16*1024*1024+1)
  if len(raw)>16*1024*1024:raise CloudError('内容较多，请缩小范围。')
  text=raw.decode();result=json.loads(text) if not text.lstrip().startswith(('event:','data:')) else [json.loads(line[5:]) for line in text.splitlines() if line.startswith('data:') and line[5:].strip()!='[DONE]'][-1]
 except HTTPError as e:raise CloudError('连接权限不足，请核对 API Key。' if e.code in (401,403) else '云端请求失败，请稍后重试。') from None
 except (URLError,TimeoutError,ValueError,IndexError):raise CloudError('暂时无法连接，请稍后重试。') from None
 if result.get('error') or result.get('status')=='error':raise CloudError('云端未完成请求，请在 Codex 中检查。')
 return result

def personal_uri(uri):
 roots=('viking://user/default/resources','viking://user/default/peers','viking://user/default/memories')
 if not isinstance(uri,str) or any(x in ('.','..') for x in uri.split('/')) or '%' in uri or any(ord(x)<32 for x in uri) or not any(uri==b or uri.startswith(b+'/') for b in roots):raise CloudError('请选择个人空间内的资料。')
 return uri

def rpc(name,args):
 if name not in ('list','read','find'):raise CloudError('不支持的操作。')
 for u in args.get('uris',[])+[args[k] for k in ('uri','target_uri') if k in args]:personal_uri(u)
 r=request('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}).get('result',{})
 if r.get('isError'):raise CloudError('暂时无法读取这份资料。')
 return r
