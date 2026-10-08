"""Conversation-native onboarding and user selection; only UI receives key input."""
import time, uuid
import cloud, connection, profiles, hook_setup

def saved():
 try:return profiles.load(profiles.ROOT/'binding.json')
 except FileNotFoundError:return None

def public():
 value=saved()
 return value

def save(value):cloud.atomic(profiles.ROOT/'binding.json',value)

def begin():
 profiles.initialize()
 value={'phase':'setup','revision':uuid.uuid4().hex,'startedAt':time.time()}
 with profiles.locked():save(value)
 return value

def checked(revision):
 value=saved()
 if not value or value['revision']!=revision:raise cloud.CloudError('这张绑定卡片已过期，请刷新后继续。')
 return value

def choose_setup(revision,mode):
 if mode not in ('reuse','update','reinstall'):raise cloud.CloudError('请选择插件安装方式。')
 with profiles.locked():
  value=checked(revision)
  if value['phase']!='setup':raise cloud.CloudError('安装方式已选择，请继续当前步骤。')
  value.update(setup=mode,phase='connection' if mode=='reuse' else 'install')
  save(value)

def complete_setup(revision):
 value=checked(revision)
 if value['phase']!='install':raise cloud.CloudError('没有待完成的插件更新。')
 installed=hook_setup.installed_plugins()['installed']
 if not any(p['name']=='openviking-codex-app' and p.get('enabled') for p in installed):raise cloud.CloudError('插件 App 尚未安装并启用。')
 if not hook_setup.official_plugins({'installed':installed}):raise cloud.CloudError('官方记忆插件尚未安装。')
 profiles.assert_hook_isolation()
 with profiles.locked():
  value=checked(revision);value.update(phase='connection',installationCheckedAt=time.time());save(value)

def bind(revision,api_key,database_id=None,account=None,user=None,service_name=None):
 value=checked(revision)
 if value['phase']!='connection':raise cloud.CloudError('请先完成插件选择，再绑定新用户。')
 # Network validation and persistence happen once; activation can resume without the key.
 name='user-'+value['revision'][:16]
 if (profiles.ROOT/name).exists():raise cloud.CloudError('此绑定已保存，请刷新卡片后继续，无需再次提交 Key。')
 profiles.add(name,api_key,account,user,service_name=service_name)
 with profiles.locked():
  value=checked(revision);value.update(phase='activate',profile=name);save(value)
 return activate(revision)

def activate(revision):
 value=checked(revision)
 if value['phase']!='activate':raise cloud.CloudError('没有待启用的用户绑定。')
 try:profiles.switch(value['profile'],live=True)
 except hook_setup.HostError as e:
  raise cloud.CloudError('绑定已保存，无需再次提交 API Key。'+str(e)) from None
 with profiles.locked():
  value=checked(revision);value.update(phase='onboarding');save(value)
 return {'status':'switched','newTaskRequired':True}

def finish_if_ready(flow):
 value=saved()
 if value and value.get('phase')=='onboarding' and value.get('profile')==profiles.active() and flow.get('phase')=='ready':
  # Completion is derived; do not mutate from the read-only state endpoint.
  return {**value,'phase':'complete'}
 return value

def switch_user(user_id,database_id=None,service_name=None,profile_name=None):
 matches=[r for r in profiles.rows() if r['user']==user_id and (database_id is None or r['databaseId']==database_id) and (service_name is None or r['serviceName']==service_name) and (profile_name is None or r['name']==profile_name)]
 if not matches:return {'status':'not_found','message':'没有这个 User ID 的绑定，请先新增绑定。','users':profiles.rows()}
 if len(matches)>1:return {'status':'choose_connection','message':'这个 User ID 绑定了多个连接，请选择服务展示名。','matches':matches}
 target=matches[0]
 if target['active']:return {'status':'already_current','user':target,'newTaskRequired':False}
 profiles.switch(target['name'],live=True)
 return {'status':'switched','user':next(r for r in profiles.rows() if r['name']==target['name']),'newTaskRequired':True}

def set_database(name,database_id):
 if not isinstance(database_id,str) or not profiles.re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}',database_id):raise cloud.CloudError('库 ID 格式无效。')
 with profiles.locked():
  meta=profiles.profile(name)
  if meta.get('databaseIdSource')=='server' and meta.get('databaseId')!=database_id:raise cloud.CloudError('不能覆盖服务端验证的库 ID。')
  meta.update(databaseId=database_id,databaseIdSource='user');cloud.atomic(profiles.ROOT/name/'profile.json',meta)
 return profiles.rows()
