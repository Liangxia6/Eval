def solve(d):
    return next((f['name'] for f in d['fields'] if f['target']==d['parent']),d['parent']+'_ptr')
