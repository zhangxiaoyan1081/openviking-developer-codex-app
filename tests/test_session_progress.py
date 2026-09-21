import json,unittest
from unittest.mock import patch
import test_personal as fixtures
import cloud,session_progress as progress

class SessionProgressTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 def entry(self,sid='one'):
  return {'uri':'viking://user/default/sessions/'+sid,'isDir':True}
 def fake(self,config,path,**args):
  uri=args['uri'];base=self.entry()['uri']
  if path=='/api/v1/fs/ls':
   self.assertEqual(args['node_limit'],2147483647)
   if uri==base:return [{'uri':base+'/history','isDir':True}]
   return [{'uri':base+'/history/archive_'+x,'isDir':True,'modTime':'2099-01-01'} for x in ['999','1000','002']]
  if path=='/api/v1/fs/stat':return {'modTime':self.stamp}
  if path=='/api/v1/content/read':return self.body
  raise AssertionError(path)
 def setup_row(self):
  self.stamp='2026-09-20T08:53:07Z';self.body='# Working Memory\n\n## Session Title\nReview design\n\n## Current State\nApproved layout.\n\n## Open Issues\nNeeds testing.'
  self.base=cloud.folder()/'session-progress';self.base.mkdir(parents=True,exist_ok=True)
 def test_field_markdown_and_absent_fields(self):
  self.assertEqual(progress.fields('## Session Title\n_Title_\n## Current State\n**Done**','id'),('Title','Done'))
  self.assertEqual(progress.fields('# Session Summary\n**Overview**: 2 turns, 77 messages','id'),('id',''))
 def test_latest_numeric_archive_and_exact_l1_timestamp(self):
  self.setup_row()
  with patch.object(progress,'request',side_effect=self.fake):r=progress.session_row(cloud.credentials(),self.entry(),self.base)
  self.assertEqual(r['title'],'Review design');self.assertEqual(r['state'],'Approved layout.')
  self.assertTrue(r['overviewUri'].endswith('/archive_1000/.overview.md'));self.assertEqual(r['updatedAt'],self.stamp)
 def test_cached_body_revalidated_by_l1_stat(self):
  self.setup_row()
  with patch.object(progress,'request',side_effect=self.fake) as req:
   progress.session_row(cloud.credentials(),self.entry(),self.base)
   self.body=self.body.replace('Approved layout.','New decision.');req.reset_mock()
   r=progress.session_row(cloud.credentials(),self.entry(),self.base)
   self.assertEqual(r['state'],'Approved layout.');self.assertFalse(any(x.args[1]=='/api/v1/content/read' for x in req.call_args_list))
   self.stamp='2026-09-21T08:53:07Z';r=progress.session_row(cloud.credentials(),self.entry(),self.base)
   self.assertEqual(r['state'],'New decision.')
 def test_missing_and_denied_sessions_not_silently_dropped(self):
  self.setup_row()
  with patch.object(progress,'listing',return_value=[]):self.assertEqual(progress.session_row(cloud.credentials(),self.entry(),self.base)['status'],'no_archive')
  with patch.object(progress,'listing',side_effect=cloud.CloudError('denied')):self.assertEqual(progress.session_row(cloud.credentials(),self.entry(),self.base)['status'],'unavailable')
 def test_full_inventory_pagination_and_search(self):
  base=cloud.folder()/'session-progress';path=base/'index.json';cloud.atomic(path,{'job':'fixture','status':'running','rows':[]})
  rows=[self.entry(str(i)) for i in range(1051)]
  def row(c,e,b):return {'id':e['uri'].split('/')[-1],'title':e['uri'],'state':'State','status':'ready','updatedAt':'2026-09-21T00:00:00Z'}
  with patch.object(progress,'listing',return_value=rows),patch.object(progress,'session_row',side_effect=row):progress.scan(base.parent.name,'fixture')
  data=progress.page({'offset':1040});self.assertEqual(data['total'],1051);self.assertEqual(data['done'],1051);self.assertEqual(len(data['items']),11);self.assertEqual(data['status'],'complete')
  filtered=progress.page({'query':'sessions/1050'});self.assertEqual(filtered['matched'],1)
 def test_one_scan_per_connection_and_no_cross_identity_results(self):
  with patch.object(progress.subprocess,'Popen') as popen:
   progress.page({'refresh':True});progress.page({'refresh':True});self.assertEqual(popen.call_count,1)
   cloud.atomic(cloud.CONFIG,{'url':cloud.ENDPOINT,'api_key':'different'})
   r=progress.page({});self.assertEqual(r['items'],[]);self.assertEqual(popen.call_count,2)
 def test_detail_readonly_scope_and_full_body(self):
  uri=self.entry()['uri']+'/history/archive_010/.overview.md'
  with patch.object(progress,'request',return_value='full body') as request:
   self.assertEqual(progress.detail({'uri':uri})['overview'],'full body');self.assertEqual(request.call_args.kwargs['limit'],-1)
   for wrong in ['viking://resources/x.md','viking://user/other/sessions/s/history/archive_1/.overview.md',self.entry()['uri']+'/messages.jsonl']:
    with self.assertRaises(ValueError):progress.detail({'uri':wrong})
 def test_list_failure_is_not_a_successful_empty_index(self):
  base=cloud.folder()/'session-progress';cloud.atomic(base/'index.json',{'job':'fixture','status':'running','rows':[]})
  with patch.object(progress,'listing',side_effect=cloud.CloudError('failed')):progress.scan(base.parent.name,'fixture')
  r=progress.page({});self.assertEqual(r['status'],'failed');self.assertTrue(r['error'])
