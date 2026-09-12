def solve(d):
    if not(len(d['shape'])==len(d['chunks'])==len(d['backend'])):raise ValueError('dimensions')
    grids=[];aligned=[]
    for n,cs,b in zip(d['shape'],d['chunks'],d['backend']):
        if b<=0 or n<0 or sum(cs)!=n or any(c<=0 for c in cs):raise ValueError('invalid chunks')
        grids.append([min(b,n-i) for i in range(0,n,b)])
        edges={0,n};pos=0
        for c in cs:pos+=c;edges.add(pos)
        edges.update(range(0,n,b));edges=sorted(edges)
        aligned.append([y-x for x,y in zip(edges,edges[1:])])
    return {'grid':grids,'aligned':aligned}
