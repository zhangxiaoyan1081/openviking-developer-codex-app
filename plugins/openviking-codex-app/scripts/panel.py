#!/usr/bin/env python3
"""Loopback-only personal workspace. No keys in browser, no history upload on click."""
import argparse,json,secrets,subprocess,sys,os,hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from urllib.request import urlopen
import cloud,connection
ASSET=Path(__file__).resolve().parents[1]/'assets/index.html'
BUILD=hashlib.sha256(ASSET.read_bytes()+Path(__file__).read_bytes()).hexdigest()[:16]

def scope(value):
 if value.get('mode') not in ('recent','projects','description','skip'):raise ValueError('请选择同步范围。')
 if value['mode']=='recent' and value.get('days') not in (7,30,90):raise ValueError('请选择时间范围。')
 if value['mode'] in ('projects','description') and not str(value.get('text','')).strip():raise ValueError('请填写同步范围。')
 return {'mode':value['mode'],'days':value.get('days'),'text':str(value.get('text',''))[:2000],'state':'skipped' if value['mode']=='skip' else 'selected'}

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,value,code=200,html=False):
  raw=value.encode() if html else json.dumps(value,ensure_ascii=False).encode();self.send_response(code)
  for k,v in {'Content-Type':'text/html; charset=utf-8' if html else 'application/json; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}.items():self.send_header(k,v)
  self.end_headers();self.wfile.write(raw)
 def allowed(self):
  origin='http://127.0.0.1:'+str(self.server.server_port)
  return self.headers.get('Host')==origin[7:] and self.headers.get('Origin',origin)==origin and self.headers.get('Sec-Fetch-Site','none') in ('none','same-origin')
 def do_GET(self):
  if not self.allowed():self.send({'error':'请从本机打开。'},403);return
  u=urlsplit(self.path);q=parse_qs(u.query)
  try:
   if u.path=='/':self.send(ASSET.read_text().replace('__TOKEN__',self.server.token),html=True)
   elif u.path=='/health':self.send({'app':'openviking-codex-app','instance':self.server.token,'build':BUILD})
   elif u.path=='/api/state':
    if getattr(self.server,'connection_id',cloud.folder().name)!=cloud.folder().name:raise ValueError('连接已更换，请重新打开工作台。')
    from app_backend import state
    self.send(state())
   elif u.path in ('/api/list','/api/tree','/api/read'):
    from app_backend import dispatch
    connection.require_ready()
    if getattr(self.server,'connection_id',cloud.folder().name)!=cloud.folder().name:raise ValueError('连接已更换，请重新打开工作台。')
    args={'uri':q.get('uri',['viking://'])[0],'offset':int(q.get('offset',['0'])[0])}
    self.send(dispatch(u.path.rsplit('/',1)[1],args))
   else:self.send({'error':'页面不存在。'},404)
  except (ValueError,cloud.CloudError) as e:self.send({'error':str(e)},400)
 def do_POST(self):
  if not self.allowed() or not secrets.compare_digest(self.headers.get('X-OV-Token',''),self.server.token):self.send({'error':'请重新打开页面。'},403);return
  try:
   if self.path!='/api/scope':raise ValueError('不支持的操作。')
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<16000:raise ValueError('内容过长。')
   connection.require_ready()
   value=scope(json.loads(self.rfile.read(size)));cloud.save('scope.json',value);self.send(value)
  except (ValueError,cloud.CloudError) as e:self.send({'error':str(e)},400)

def serve():
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.token=secrets.token_hex(24);server.connection_id=cloud.folder().name
 cloud.atomic(cloud.ROOT/'panel-v4.json',{'url':'http://127.0.0.1:'+str(server.server_port)+'/','instance':server.token,'connection':server.connection_id})
 server.serve_forever()

def start():
 import time
 path=cloud.ROOT/'panel-v4.json'
 try:
  state=json.loads(path.read_text());url=state['url'];u=urlsplit(url)
  if u.hostname=='127.0.0.1' and u.scheme=='http' and u.path=='/':
   with urlopen(url+'health',timeout=1) as response:live=json.load(response)
   if live.get('app')=='openviking-codex-app' and live.get('instance')==state['instance'] and live.get('build')==BUILD and state.get('connection')==cloud.folder().name:return url
 except Exception:pass
 subprocess.Popen([sys.executable,__file__,'serve'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 for _ in range(50):
  time.sleep(.1)
  try:
   state=json.loads(path.read_text())
   with urlopen(state['url']+'health',timeout=1) as response:
    live=json.load(response)
    if live.get('instance')==state['instance'] and live.get('build')==BUILD and state.get('connection')==cloud.folder().name:return state['url']
  except Exception:pass
 raise RuntimeError('工作台未能启动，请重试。')
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('action',choices=['start','serve','scope']);a=ap.parse_args()
 if a.action=='serve':serve()
 elif a.action=='start':print(start())
 else:print(json.dumps(cloud.load('scope.json'),ensure_ascii=False))
