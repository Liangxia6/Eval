def solve(d):
    groups={}
    fields=['country','project','contractor','start','completion']
    for r in d['records']:
        if not(r['overseas'] and r['bri'] and r['event']=='commissioned' and r['completion'] and '2025-01'<=r['completion']<='2025-05'):continue
        g=groups.setdefault(r['project_id'],{'project_id':r['project_id'],**{k:None for k in fields},'sources':[]})
        for k in fields:
            if r[k] is not None:
                if g[k] is not None and g[k]!=r[k]:raise ValueError('conflicting sources')
                g[k]=r[k]
        if r['source_id'] not in g['sources']:g['sources'].append(r['source_id'])
    for g in groups.values():g['sources'].sort()
    return [groups[k] for k in sorted(groups)]
