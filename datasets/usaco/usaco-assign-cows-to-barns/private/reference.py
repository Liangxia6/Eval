def solve(d):
    n=len(d['cows']);M=1000000007;events=sorted([(v,0) for v in d['cows']]+[(v,1) for v in d['barns']]);dp={(0,0):1}
    for _,kind in events:
        out={}
        def inc(key,v):out[key]=(out.get(key,0)+v)%M
        for (a,skipped),value in dp.items():
            if kind==0:inc((a+1,skipped),value);inc((a,1),value)
            else:
                if a:inc((a-1,skipped),a*value)
                if not skipped:inc((a,0),value)
        dp=out
    return (dp.get((0,0),0)+dp.get((0,1),0))%M
