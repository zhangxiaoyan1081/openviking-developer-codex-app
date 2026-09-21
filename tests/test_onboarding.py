import json,unittest,fcntl
from unittest.mock import patch
import test_personal as fixtures
import cloud,history,onboarding,app_backend,workspace

class OnboardingTests(unittest.TestCase):
 setUp=fixtures.PersonalTests.setUp
 tearDown=fixtures.PersonalTests.tearDown
 plan=fixtures.PersonalTests.plan

 def prepare(self,**overrides):
  return onboarding.prepare_rules({'path':str(self.root/'AGENTS.md'),'mode':'merge','scope':'global','summary':['保存本次重要产出'],'block':'Save only approved work.',**overrides})

 def test_rules_need_consent_preserve_unrelated_and_detect_concurrent_edit(self):
  path=self.root/'AGENTS.md';before=path.read_text();r=self.prepare()
  self.assertEqual(path.read_text(),before)
  with self.assertRaises(ValueError):onboarding.apply_rules({'revision':r['revision']})
  onboarding.choose_rules({'revision':r['revision'],'choice':'adopt'})
  path.write_text(before+'\nUser added another rule.')
  with self.assertRaises(ValueError):onboarding.apply_rules({'revision':r['revision']})
  self.assertEqual(onboarding.state()['phase'],'collaboration')
  r=self.prepare();onboarding.choose_rules({'revision':r['revision'],'choice':'adopt'});onboarding.apply_rules({'revision':r['revision']})
  self.assertIn('User added another rule.',path.read_text())
  self.assertEqual(path.read_text().count(onboarding.START),1)
  onboarding.apply_rules({'revision':r['revision']})
  self.assertEqual(path.read_text().count(onboarding.START),1)
  self.assertEqual(onboarding.state()['phase'],'scope')

 def test_existing_rules_are_reused_without_file_mutation(self):
  before=(self.root/'AGENTS.md').read_bytes()
  self.assertEqual(onboarding.state()['collaboration']['mode'],'reuse')
  self.assertEqual((self.root/'AGENTS.md').read_bytes(),before)
  with self.assertRaises(ValueError):onboarding.prepare_rules({'path':str(self.root/'AGENTS.md'),'mode':'reuse','scope':'global','summary':['Use OV']})

 def test_legacy_auto_reuse_requires_visible_choice_and_never_rewrites_rules(self):
  path=self.root/'AGENTS.md';before=path.read_bytes();modified=path.stat().st_mtime_ns
  record=cloud.load('collaboration.json');record.pop('confirmedAt');cloud.save('collaboration.json',record)
  self.assertEqual(onboarding.state()['phase'],'collaboration')
  self.assertEqual(onboarding.rules_public()['status'],'proposed')
  with self.assertRaises(ValueError):app_backend.dispatch('scope',{'mode':'skip'})
  with self.assertRaises(ValueError):onboarding.apply_rules({'revision':record['revision']})
  onboarding.choose_rules({'revision':record['revision'],'choice':'adopt'})
  self.assertEqual(onboarding.state()['phase'],'scope')
  self.assertEqual(path.read_bytes(),before);self.assertEqual(path.stat().st_mtime_ns,modified)
  self.assertFalse((cloud.folder()/'rule-backups').exists())

 def test_new_connection_reopens_choice_but_resume_does_not(self):
  app_backend.dispatch('scope',{'mode':'skip'})
  record=cloud.load('collaboration.json')
  self.assertEqual(onboarding.state()['phase'],'ready')
  cloud.save('connection.json',{'verifiedAt':'new-connection-review'})
  self.assertEqual(onboarding.state()['phase'],'collaboration')
  self.assertIsNone(app_backend.state()['scope'])
  onboarding.choose_rules({'revision':record['revision'],'choice':'adopt'})
  self.assertEqual(onboarding.state()['phase'],'scope')
  self.assertEqual(onboarding.state()['phase'],'scope')
  self.assertEqual(cloud.load('scope.json')['mode'],'skip')

 def test_preparing_reuse_waits_for_choice_and_adjust_does_not_activate(self):
  args={'path':str(self.root/'AGENTS.md'),'mode':'reuse','scope':'global','summary':['确认后的协作方式'],'evidence':'Verified explicit rules'}
  r=onboarding.prepare_rules(args)
  self.assertEqual(r['status'],'proposed')
  onboarding.choose_rules({'revision':r['revision'],'choice':'adjust'})
  with self.assertRaises(ValueError):app_backend.dispatch('scope',{'mode':'skip'})
  r=onboarding.prepare_rules(args);self.assertEqual(r['status'],'proposed')
  onboarding.choose_rules({'revision':r['revision'],'choice':'adopt'})
  self.assertEqual(onboarding.prepare_rules(args)['status'],'active')

 def test_override_change_invalidates_review(self):
  override=self.root/'AGENTS.override.md';override.write_text('Existing exception')
  r=self.prepare(check_files=[str(override)])
  onboarding.choose_rules({'revision':r['revision'],'choice':'adopt'})
  override.write_text('New exception')
  with self.assertRaises(ValueError):onboarding.apply_rules({'revision':r['revision']})

 def test_skip_goes_to_expectations_not_complete(self):
  s=app_backend.dispatch('scope',{'mode':'skip'})
  self.assertEqual(s['onboarding']['phase'],'ready');self.assertIsNone(s['onboarding']['choice'])
  self.assertEqual(s['onboarding']['nextAction'],'choose_work')
  self.assertEqual(app_backend.dispatch('next',{'choice':'later'})['onboarding']['choice'],'later')
  self.assertEqual(app_backend.state()['onboarding']['choice'],'later')

 def test_rules_required_before_scope_and_next(self):
  (cloud.folder()/'collaboration.json').unlink()
  with self.assertRaises(ValueError):app_backend.dispatch('scope',{'mode':'skip'})
  with self.assertRaises(ValueError):onboarding.choose_next({'choice':'start'})

 def test_pending_extraction_does_not_block_summary_but_stale_summary_does(self):
  app_backend.dispatch('scope',{'mode':'recent','days':30})
  p=self.root/'plan.json';plan=self.plan();p.write_text(json.dumps(plan))
  app_backend.dispatch('review',{'path':str(p),'coverage':'one session'})
  app_backend.dispatch('confirm',{'hash':history.digest(plan)})
  with patch.object(cloud,'request',return_value={'result':{'task_id':'task','status':'accepted'}}):history.apply(plan,history.digest(plan))
  self.assertEqual(onboarding.state()['phase'],'import')
  work={'id':'a','title':'Project','goal':'Finish A','state':'Draft completed','next':'Review draft','coverage':'Original messages','sources':[{'label':'Readback','uri':'viking://user/default/resources/a.md'}]}
  revision=onboarding.scope_key()
  workspace.publish({'onboarding':True,'scopeRevision':revision,'works':[work]})
  self.assertEqual(onboarding.state()['phase'],'ready')
  self.assertFalse(onboarding.state()['import']['terminal'])
  app_backend.dispatch('scope',{'mode':'recent','days':90})
  self.assertEqual(onboarding.state()['phase'],'prepare')
  self.assertFalse(onboarding.state()['summaryReady'])
  with self.assertRaises(ValueError):workspace.publish({'onboarding':True,'scopeRevision':revision,'works':[work]})

 def test_poll_persists_terminal_and_never_resubmits(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t','status':'accepted'}}):history.apply(plan,history.digest(plan))
  with patch.object(cloud,'request',return_value={'result':{'status':'completed','result':{'memories_extracted':{}}}}) as request:
   history.status(plan);history.status(plan)
   self.assertEqual(request.call_count,1)
   self.assertEqual(cloud.load('imports/'+history.digest(plan)+'.json')['items']['source-a']['task']['status'],'completed')
  with patch.object(cloud,'request') as request:
   history.apply(plan,history.digest(plan));request.assert_not_called()
  self.assertTrue(onboarding.progress()['terminal'])

 def test_unknown_and_foreign_job_do_not_reupload(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t'}}):history.apply(plan,history.digest(plan))
  with patch.object(cloud,'request',side_effect=cloud.CloudError('network')) as request:
   history.status(plan);self.assertEqual(request.call_count,1)
  self.assertEqual(onboarding.progress()['items'][0]['status'],'unknown')
  with self.assertRaises(ValueError):history.poll_job('0'*64)

 def test_verify_and_collect_pin_completed_archive(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t','archive_uri':'viking://user/default/sessions/s/history/archive_001'}}):history.apply(plan,history.digest(plan))
  with patch.object(cloud,'request',return_value={'result':{'status':'completed'}}):history.status(plan)
  remote={'result':{'overview':'Correct archive','messages':[{'role':'user','parts':[{'text':'Hello'}],'source_message_ids':['0']}]}}
  with patch.object(cloud,'request',return_value=remote) as request:
   self.assertTrue(history.verify(plan)['sessions']['source-a']['verified'])
   self.assertEqual(history.collect(plan)['sessions'][0]['overview'],'Correct archive')
   self.assertTrue(all('/archives/archive_001' in c.args[0] for c in request.call_args_list))
  with patch.object(cloud,'request',return_value={'result':{'messages':[]}}):
   self.assertFalse(history.verify(plan)['sessions']['source-a']['verified'])

 def test_old_overview_is_not_current_commit(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t','archive_uri':'viking://user/default/sessions/s/history/archive_001'}}):history.apply(plan,history.digest(plan))
  with patch.object(cloud,'request',return_value={'result':{'latest_archive_overview':'old overview','messages':[]}}):
   self.assertEqual(history.collect(plan)['coverage']['withOverview'],0)

 def test_partial_failure_is_terminal_without_hiding_success(self):
  plan=self.plan();plan['sessions'].append({**plan['sessions'][0],'source_id':'source-b'})
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t'}}):history.apply(plan,history.digest(plan))
  with patch.object(cloud,'request',side_effect=[{'result':{'status':'completed'}},{'result':{'status':'failed'}}]):history.status(plan)
  self.assertTrue(onboarding.progress()['terminal'])
  self.assertEqual([r['status'] for r in onboarding.progress()['items']],['completed','failed'])

 def test_public_state_never_returns_rule_body_or_private_path(self):
  self.prepare(block='A private rule.')
  public=json.dumps(app_backend.state())
  self.assertNotIn('A private rule.',public);self.assertNotIn(str(self.root),public)

 def test_poll_does_not_block_or_query_while_import_is_writing(self):
  plan=self.plan()
  with patch.object(cloud,'request',return_value={'result':{'task_id':'t'}}):history.apply(plan,history.digest(plan))
  with open(cloud.folder()/'import.lock','a') as lock,patch.object(cloud,'request') as request:
   fcntl.flock(lock,fcntl.LOCK_EX)
   self.assertEqual(history.status(plan)['items']['source-a']['state'],'submitted')
   request.assert_not_called()
