def solve(d):
    found=[f['name'] for f in d['fields'] if f['target']==d['parent'] and f['parent_link']]
    if len(found)>1:raise ValueError('ambiguous parent link')
    return found[0] if found else d['parent']+'_ptr'
