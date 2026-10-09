import json,threading,unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import test_personal as fixtures
import panel,workspace_users
class HttpTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def test_loopback_api_and_csrf(self):
  server=panel.ThreadingHTTPServer(('127.0.0.1',0),panel.Handler);server.token='test-token'
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
  try:
   with urlopen(base+'/api/state') as r:self.assertTrue(json.load(r)['configured'])
   for route in ('workspace_state','workspace_read','workspace_switch'):
    with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/'+route,data=b'{}',headers={'Content-Type':'application/json'}))
    self.assertEqual(error.exception.code,403);error.exception.close()
   with patch.object(workspace_users,'dispatch',return_value={'identity':{'user':'fixture'}}) as action:
    with urlopen(Request(base+'/api/workspace_switch',data=b'{"profile_name":"work","revision":"fixture"}',headers={'Content-Type':'application/json','X-OV-Token':'test-token'})) as r:self.assertEqual(json.load(r)['identity']['user'],'fixture')
    action.assert_called_once_with('workspace_switch',{'profile_name':'work','revision':'fixture'})
   data=json.dumps({'mode':'recent','days':90}).encode()
   with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/scope',data=data,headers={'Content-Type':'application/json'}))
   self.assertEqual(error.exception.code,403);error.exception.close()
   with urlopen(Request(base+'/api/scope',data=data,headers={'Content-Type':'application/json','X-OV-Token':'test-token'})) as r:self.assertEqual(json.load(r)['state'],'selected')
   with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/api/state',headers={'Origin':'https://example.com'}))
   error.exception.close()
   with self.assertRaises(HTTPError) as error:urlopen(base+'/api/read?offset=-1')
   error.exception.close()
  finally:server.shutdown();server.server_close();thread.join()
