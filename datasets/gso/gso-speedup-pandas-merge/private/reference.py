def solve(d):
    right={}
    for r in d['right']:right.setdefault(r['key'],[]).append(r['val2'])
    return [{'key':l['key'],'val1':l['val1'],'val2':v} for l in sorted(d['left'],key=lambda x:x['key']) for v in right.get(l['key'],[])]
