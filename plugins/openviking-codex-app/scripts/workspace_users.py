"""Read-only workspace identity snapshots; explicit switching shares chat bindings.

The workspace may follow the device's selected connection. Conversation tools and
Hooks retain their existing restart/isolation guards. Credentials are pinned for
an entire request, including cache paths, and never returned to the browser.
"""
import cloud,connection,profiles

READS={'list_directory':'list','tree_directory':'tree','read_file':'read',
       'get_session_progress':'session_progress','read_session_overview':'session_detail'}

def snapshot():
 cloud.check_environment()
 if (profiles.ROOT/'switch.json').exists():raise cloud.CloudError('正在切换用户，请稍后刷新。')
 config,revision=connection.snapshot()
 rows=profiles.rows()
 active=next((r for r in rows if r['active']),None)
 if active and profiles.fingerprint(config)!=profiles.profile(active['name'])['fingerprint']:
  raise cloud.CloudError('连接配置已变化，请在对话中核对后刷新。')
 if connection.snapshot()[1]!=revision:raise cloud.CloudError('连接已变化，请刷新工作台。')
 return config,revision,rows

def state():
 config,revision,rows=snapshot()
 ready=False
 try:
  with cloud.pinned_credentials(config):ready=bool(cloud.load('connection.json',{}).get('verifiedAt'))
 except cloud.CloudError:pass
 with cloud.pinned_credentials(config) if ready else _empty():
  return {'configured':bool(config.get('api_key')),'connection':{'ready':ready,'revision':revision},
          'identity':{'user':config.get('user') or config.get('user_id') or 'default','account':config.get('account') or config.get('account_id') or 'default'} if config.get('api_key') else None,
          'boundUsers':rows,'reports':cloud.load('reports.json',[]) if ready else []}

from contextlib import nullcontext as _empty

def dispatch(action,value):
 if action=='workspace_state':return state()
 if action=='workspace_switch':
  # Called only by a user click. Uses the same isolation checks and rollback as chat.
  name=value.get('profile_name')
  if not value.get('revision'):raise cloud.CloudError('请刷新工作台后重试。')
  profiles.switch(name,live=True,expected_revision=value['revision'])
  return state()
 if action!='workspace_read' or value.get('tool') not in READS:raise cloud.CloudError('不支持的浏览操作。')
 config,revision,_=snapshot()
 if revision!=value.get('revision'):raise cloud.CloudError('连接已变化，请刷新工作台。')
 with cloud.pinned_credentials(config):
  if not cloud.load('connection.json',{}).get('verifiedAt'):raise cloud.CloudError('请先完成连接确认。')
  # Only this allowlist bypasses the conversation runtime restart check.
  from app_backend import read_action
  result=read_action(READS[value['tool']],value.get('arguments',{}))
 if connection.snapshot()[1]!=revision:raise cloud.CloudError('连接已变化，请刷新工作台。')
 return result
