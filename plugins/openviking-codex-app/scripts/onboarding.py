"""Resumable onboarding shared by Apps and the agent's stdin CLI.

Rule comparison is an agent decision. The script enforces exact file revisions,
explicit adoption, preservation of unrelated rules, and readback of writes.
"""
import fcntl
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime, timezone
import cloud
import connection

START = '<!-- openviking-codex-app:start -->'
END = '<!-- openviking-codex-app:end -->'

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()

def read(path):
    try:
        return Path(path).read_text()
    except FileNotFoundError:
        return ''

def rules_public():
    record = cloud.load('collaboration.json', {})
    if not record:
        return {'status': 'unreviewed'}
    valid = all(digest(read(p)) == h for p, h in record['files'].items())
    return {k: record[k] for k in ('revision', 'summary', 'scope', 'mode', 'status') } | {
        'status': record['status'] if valid else 'changed'}

def prepare_rules(value):
    """Prepare a managed block or record explicitly reviewed existing rules."""
    connection.require_ready()
    path = Path(value['path']).expanduser()
    if not path.is_absolute() or path.name not in ('AGENTS.md', 'AGENTS.override.md'):
        raise ValueError('请选择实际生效的 AGENTS.md。')
    path = path.resolve()
    original = read(path)
    mode = value['mode']
    if mode not in ('reuse', 'merge') or value['scope'] not in ('global', 'project'):
        raise ValueError('协作设置无效。')
    summary = value['summary']
    if not isinstance(summary, list) or not summary or not all(isinstance(x, str) and x.strip() for x in summary):
        raise ValueError('请说明实际采用的协作方式。')
    proposed = original
    if mode == 'reuse':
        if not original.strip() or not value.get('evidence', '').strip():
            raise ValueError('沿用规则需要核对现有授权及内容。')
    else:
        block = value.get('block', '').strip()
        if not block or START in block or END in block:
            raise ValueError('协作规则内容无效。')
        wrapped = START + '\n' + block + '\n' + END
        if START in original or END in original:
            if original.count(START) != 1 or original.count(END) != 1 or original.index(START) > original.index(END):
                raise ValueError('已有规则标记异常，请先核对。')
            left, rest = original.split(START)
            _, right = rest.split(END)
            proposed = left + wrapped + right
        else:
            proposed = original + ('\n\n' if original else '') + wrapped + '\n'
    files = {str(Path(p).expanduser().resolve()): digest(read(Path(p).expanduser().resolve())) for p in value.get('check_files', [])}
    files[str(path)] = digest(original)
    record = {'path': str(path), 'files': files, 'content': proposed, 'summary': summary,
              'scope': value['scope'], 'mode': mode, 'status': 'active' if mode == 'reuse' else 'proposed',
              'evidence': value.get('evidence', ''), 'updatedAt': now()}
    record['revision'] = digest(json.dumps({k:record[k] for k in ('files','content','summary','scope','mode')},sort_keys=True,ensure_ascii=False))
    previous = cloud.load('collaboration.json', {})
    if previous.get('revision') == record['revision'] and previous.get('status') in ('accepted','active'):
        record['status'] = previous['status']
    cloud.save('collaboration.json', record)
    return rules_public()

def choose_rules(value):
    record = cloud.load('collaboration.json', {})
    if value['revision'] != record.get('revision') or rules_public()['status'] == 'changed':
        raise ValueError('协作设置已变化，请重新查看。')
    if value['choice'] not in ('adopt','adjust'):
        raise ValueError('请选择协作方式。')
    record['status'] = 'accepted' if value['choice'] == 'adopt' else 'adjusting'
    cloud.save('collaboration.json', record)
    return rules_public()

def apply_rules(value):
    connection.require_ready()
    record = cloud.load('collaboration.json', {})
    if value['revision'] != record.get('revision') or rules_public()['status'] not in ('accepted','active'):
        raise ValueError('请先确认这份协作设置。')
    if record['status'] == 'active':
        return rules_public()
    path = Path(record['path'])
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.parent / '.openviking-rules.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if cloud.load('collaboration.json', {}).get('revision') != record['revision'] or rules_public()['status'] != 'accepted':
            raise ValueError('规则文件已变化，请重新核对。')
        original = read(path)
        # A private backup, isolated by connection, only for the reviewed file.
        cloud.save('rule-backups/' + record['revision'] + '.json', {'path': str(path), 'content': original})
        mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.ov-rules-')
        try:
            with os.fdopen(fd, 'w') as stream:
                stream.write(record['content'])
            os.chmod(tmp, mode)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        if read(path) != record['content']:
            raise ValueError('协作设置保存后核对未通过。')
        record['files'][str(path)] = digest(record['content'])
        record.update(status='active', updatedAt=now())
        cloud.save('collaboration.json', record)
    return rules_public()

def scope_key():
    scope = cloud.load('scope.json')
    plan = cloud.load('review.json')
    return digest(json.dumps({'scope':scope,'plan':plan.get('hash') if plan else None},sort_keys=True))

def mark_summary():
    value = cloud.load('onboarding.json', {})
    value.update(summaryFor=scope_key(), choice=None)
    cloud.save('onboarding.json', value)

def progress():
    job = cloud.load('active-import.json')
    if not job:
        return None
    data = cloud.load('imports/' + job['hash'] + '.json', {'items':{}})
    rows = []
    for source in job['sources']:
        item = data['items'].get(source['id'], {})
        task = item.get('task', {})
        status = task.get('status') or ('reused' if item.get('state') == 'reused' else 'unknown' if item.get('state') == 'unknown' else 'pending')
        rows.append({'title':source['title'], 'status':status, 'written':item.get('state') in ('submitted','reused'),
                     'verified':item.get('verified', False), 'checkedAt':item.get('checkedAt')})
    return {'jobId':job['hash'], 'items':rows, 'terminal': bool(rows) and all(r['status'] in ('completed','failed','cancelled','skipped','reused') for r in rows)}

def state():
    rules = rules_public()
    scope = cloud.load('scope.json')
    plan = cloud.load('review.json')
    record = cloud.load('onboarding.json', {})
    summary_ready = record.get('summaryFor') == scope_key() and bool(cloud.load('workspace.json',{}).get('works'))
    phase = 'collaboration' if rules['status'] != 'active' else 'scope' if not scope else 'ready' if scope['mode'] == 'skip' else 'ready' if summary_ready else 'import' if plan and plan.get('confirmed') else 'review' if plan else 'prepare'
    return {'phase':phase, 'collaboration':rules, 'import':progress(), 'summaryReady':summary_ready,'scopeRevision':scope_key(),
            'choice':record.get('choice'), 'capabilities':record.get('capabilities',{}),
            'nextAction': {'collaboration':'review_rules','scope':'select_scope','prepare':'prepare_import','review':'confirm_import','import':'restore_summary','ready':'choose_work'}[phase]}

def choose_next(value):
    current = state()
    if current['phase'] != 'ready':
        raise ValueError('请先完成协作设置和工作准备。')
    if value['choice'] not in ('start','save','later','continue','correct'):
        raise ValueError('请选择下一步。')
    record = cloud.load('onboarding.json', {})
    record.update(choice=value['choice'], choiceAt=now())
    cloud.save('onboarding.json', record)
    return state()

def capabilities(value):
    allowed = ('memoryTools','hooks','appTools','messageBridge')
    if not all(k in allowed and v in ('verified','unverified','unavailable') for k,v in value.items()):
        raise ValueError('能力状态无效。')
    record = cloud.load('onboarding.json', {})
    record['capabilities'] = value
    cloud.save('onboarding.json', record)
    return state()

if __name__ == '__main__':
    try:
        connection.require_ready()
        actions = {'state':lambda _:state(),'prepare_rules':prepare_rules,'choose_rules':choose_rules,'apply_rules':apply_rules,'choose_next':choose_next,'capabilities':capabilities}
        print(json.dumps(actions[sys.argv[1]](json.load(sys.stdin)),ensure_ascii=False))
    except (ValueError,KeyError,OSError,cloud.CloudError) as error:
        print(json.dumps({'error':str(error) if isinstance(error,(ValueError,cloud.CloudError)) else '设置未完成，请核对文件权限。'},ensure_ascii=False));sys.exit(1)
