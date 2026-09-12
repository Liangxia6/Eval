def solve(d):
    a=d['values']
    if not a:return {'type':'range','start':0,'stop':0,'step':1}
    step=a[1]-a[0] if len(a)>1 else 1
    if step and all(y-x==step for x,y in zip(a,a[1:])):return {'type':'range','start':a[0],'stop':a[-1]+step,'step':step}
    return {'type':'array','data':list(a)}
