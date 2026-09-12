def solve(d):
    term=d['started'] and d['finished'] and d['crashed'] and d['code']==15
    state=('not started' if not d['started'] else 'running' if not d['finished'] else 'terminated' if term else 'crashed' if d['crashed'] else 'exited successfully' if d['code']==0 else 'exited')
    msg=None;level=None
    if d['started'] and d['finished']:
        info=term or (not d['crashed'] and d['code']==0)
        if d['verbose'] or not info:
            level='info' if info else 'error'
            sig={11:'SIGSEGV',15:'SIGTERM',9:'SIGKILL'}.get(d['code']) if d['crashed'] else None
            msg=f"{d['name']} {state} with status {d['code']}"+(f' ({sig})' if sig else '')+f". See :process {d['pid']} for details."
    return {'state':state,'was_sigterm':bool(term),'message':msg,'level':level}
