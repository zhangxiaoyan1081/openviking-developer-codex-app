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
import hook_setup

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

def connection_review():
    return cloud.load('connection.json', {}).get('verifiedAt')

def memory_public():
    record = cloud.load('memory-mode.json', {})
    current = record.get('connectionReview') == connection_review()
    check = record.get('check', {}) if current else {}
    mode = record.get('mode') if current else None
    ready = bool(mode and check.get('automaticReady' if mode == 'automatic' else 'manualReady'))
    return {'mode':mode,'ready':ready,'check':check,'revision':record.get('revision') if current else None}

def require_memory():
    value = memory_public()
    if not value['ready']:
        raise ValueError('请先选择记忆方式并检查 Hooks。')
    return value

def check_memory(value):
    connection.require_ready()
    record = cloud.load('memory-mode.json', {})
    cwd = value.get('cwd') or record.get('cwd')
    if not cwd or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
        raise ValueError('请先由 Codex 检查当前项目的记忆设置。')
    try:
        check = hook_setup.inspect(cwd)
    except (OSError,ValueError,RuntimeError,hook_setup.queue.Empty,hook_setup.subprocess.SubprocessError):
        check = {'status':'unknown','automaticReady':False,'manualReady':False,'message':'暂时无法核对，请让 Codex 检查官方插件。'}
    if record.get('connectionReview') != connection_review():
        record = {}
    record.update(cwd=cwd,check=check,connectionReview=connection_review())
    cloud.save('memory-mode.json',record)
    return memory_public()

def choose_memory(value):
    connection.require_ready()
    if value['mode'] not in ('automatic','manual'):
        raise ValueError('请选择记忆方式。')
    record = cloud.load('memory-mode.json', {})
    if record.get('connectionReview') != connection_review():
        record = {'connectionReview':connection_review()}
    # A click is consent, not evidence that hooks have been enabled or disabled.
    record.update(mode=value['mode'],revision=digest(connection_review()+value['mode']),chosenAt=now())
    cloud.save('memory-mode.json',record)
    return memory_public()

def rules_public():
    record = cloud.load('collaboration.json', {})
    if not record:
        return {'status': 'unreviewed'}
    valid = all(digest(read(p)) == h for p, h in record['files'].items())
    confirmed = bool(record.get('confirmedAt')) and record.get('connectionReview') == connection_review() and record.get('memoryRevision') == memory_public()['revision']
    status = record['status']
    if record.get('memoryRevision') != memory_public()['revision']:
        status = 'changed'
    if status in ('active', 'accepted') and not confirmed:
        status = 'proposed'
    return {k: record[k] for k in ('revision', 'summary', 'scope', 'mode', 'status') } | {
        'status': status if valid else 'changed'}

def prepare_rules(value):
    """Prepare a managed block or record explicitly reviewed existing rules."""
    connection.require_ready()
    memory = require_memory()
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
              'scope': value['scope'], 'mode': mode, 'status': 'proposed', 'connectionReview': connection_review(),
              'memoryRevision':memory['revision'], 'evidence': value.get('evidence', ''), 'updatedAt': now()}
    record['revision'] = digest(json.dumps({k:record[k] for k in ('files','content','summary','scope','mode','connectionReview','memoryRevision')},sort_keys=True,ensure_ascii=False))
    previous = cloud.load('collaboration.json', {})
    if all(previous.get(k) == record[k] for k in ('files','content','summary','scope','mode','connectionReview','memoryRevision')) and previous.get('confirmedAt') and previous.get('status') in ('accepted','active'):
        record['status'] = previous['status']
        record['confirmedAt'] = previous['confirmedAt']
    cloud.save('collaboration.json', record)
    return rules_public()

def choose_rules(value):
    memory = require_memory()
    record = cloud.load('collaboration.json', {})
    if value['revision'] != record.get('revision') or rules_public()['status'] == 'changed' or record.get('memoryRevision') != memory['revision']:
        raise ValueError('协作设置已变化，请重新查看。')
    if value['choice'] not in ('adopt','adjust'):
        raise ValueError('请选择协作方式。')
    record['status'] = 'adjusting'
    if value['choice'] == 'adopt':
        record['confirmedAt'] = now()
        record['connectionReview'] = connection_review()
        # Reuse is a user-facing choice, not another file write.
        record['status'] = 'active' if record['mode'] == 'reuse' or read(record['path']) == record['content'] else 'accepted'
    cloud.save('collaboration.json', record)
    return rules_public()

def apply_rules(value):
    connection.require_ready()
    require_memory()
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
    scope_current = bool(scope) and scope.get('connectionReview') == connection_review()
    plan = cloud.load('review.json')
    record = cloud.load('onboarding.json', {})
    summary_ready = scope_current and record.get('summaryFor') == scope_key() and bool(cloud.load('workspace.json',{}).get('works'))
    memory = memory_public()
    phase = 'hooks' if not memory['ready'] else 'collaboration' if rules['status'] != 'active' else 'scope' if not scope_current else 'ready' if scope['mode'] == 'skip' else 'ready' if summary_ready else 'import' if plan and plan.get('confirmed') else 'review' if plan else 'prepare'
    return {'phase':phase, 'memory':memory, 'collaboration':rules, 'import':progress() if scope_current else None, 'scopeCurrent':scope_current, 'summaryReady':summary_ready,'scopeRevision':scope_key(),
            'choice':record.get('choice'), 'capabilities':record.get('capabilities',{}),
            'nextAction': {'hooks':'configure_memory','collaboration':'review_rules','scope':'select_scope','prepare':'prepare_import','review':'confirm_import','import':'restore_summary','ready':'choose_work'}[phase]}

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
        actions = {'state':lambda _:state(),'prepare_rules':prepare_rules,'choose_rules':choose_rules,'apply_rules':apply_rules,'choose_next':choose_next,'capabilities':capabilities,'check_memory':check_memory,'choose_memory':choose_memory}
        print(json.dumps(actions[sys.argv[1]](json.load(sys.stdin)),ensure_ascii=False))
    except (ValueError,KeyError,OSError,cloud.CloudError) as error:
        print(json.dumps({'error':str(error) if isinstance(error,(ValueError,cloud.CloudError)) else '设置未完成，请核对文件权限。'},ensure_ascii=False));sys.exit(1)
