import unittest,json,threading
from unittest.mock import patch
from urllib.request import urlopen
from urllib.error import HTTPError
import test_personal as fixtures
import cloud,app_backend,panel

class BrowserTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def test_full_read_scope_does_not_expand_archive_scope(self):
  for uri in ['viking://','viking://resources','viking://agent/test/sessions','viking://user/default/privacy','viking://resources/中文 文件.md']:
   with patch.object(cloud,'request',return_value={'result':{'content':[]}}) as request:
    app_backend.dispatch('list',{'uri':uri})
    self.assertEqual(request.call_args.args[1]['params']['arguments']['uri'],uri)
  with self.assertRaises(cloud.CloudError):cloud.personal_uri('viking://resources')
 def test_user_alias_restores_canonical_identity(self):
  with patch.object(cloud,'request',return_value={'result':{'content':[{'type':'text','text':'[dir] memories\n[dir] resources'}]}}) as request:
   result=app_backend.dispatch('list',{'uri':'viking://user'})
   self.assertEqual(result['structuredContent']['entries'],[{'name':'default','uri':'viking://user/default','is_dir':True}])
   self.assertEqual(request.call_args.args[1]['params']['arguments'],{'uri':'viking://user/default'})
   self.assertNotIn('api_key',json.dumps(result))
  with patch.object(cloud,'request',return_value={'result':{'isError':True}}):
   with self.assertRaises(cloud.CloudError):app_backend.dispatch('list',{'uri':'viking://user'})
 def test_bad_paths_never_reach_cloud(self):
  for uri in ['https://evil.test/a','file:///tmp/a','viking://user/../secrets','viking://user/%2e%2e/secrets','viking://user/a\\b','viking://user/a?query','viking://user/a\n']:
   with patch.object(cloud,'request') as request:
    with self.assertRaises(cloud.CloudError):app_backend.dispatch('read',{'uri':uri})
    request.assert_not_called()
 def test_read_bounds_and_cloud_denial(self):
  with patch.object(cloud,'request',return_value={'result':{'content':[{'type':'text','text':'hello'}]}}) as request:
   app_backend.dispatch('read',{'uri':'viking://resources/a.md','offset':200})
   self.assertEqual(request.call_args.args[1]['params']['arguments'],{'uris':['viking://resources/a.md'],'offset':200,'limit':200})
  with patch.object(cloud,'request',return_value={'result':{'isError':True,'content':[{'type':'text','text':'upstream private details'}]}}):
   with self.assertRaisesRegex(cloud.CloudError,'访问权限'):app_backend.dispatch('list',{'uri':'viking://resources'})
 def test_http_tree_and_scope_switch(self):
  server=panel.ThreadingHTTPServer(('127.0.0.1',0),panel.Handler);server.token='fixture';server.connection_id=cloud.folder().name
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
  try:
   with patch.object(cloud,'request',return_value={'result':{'content':[]}}) as request:
    with urlopen(base+'/api/tree?uri=viking%3A%2F%2F') as response:json.load(response)
    self.assertEqual(request.call_args.args[1]['params'],{'name':'tree','arguments':{'uri':'viking://','level_limit':2,'node_limit':200}})
   cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'another-fixture'})
   for endpoint in ['/api/state','/api/list?uri=viking%3A%2F%2F']:
    with self.assertRaises(HTTPError) as error:urlopen(base+endpoint)
    self.assertEqual(error.exception.code,400);error.exception.close()
  finally:server.shutdown();server.server_close();thread.join()
