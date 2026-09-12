def solve(d):
    if not d['points']:raise ValueError('no data')
    bounds=[]
    for j in (0,1):
        lo=min(p[j] for p in d['points']);hi=max(p[j] for p in d['points'])
        if lo==hi:lo-=.5;hi+=.5
        delta=(hi-lo)*d['margin'];bounds.extend([lo-delta,hi+delta])
    return {'before':bounds,'after':list(bounds),'selection':d['selection']}
