def solve(d):
    maps={'int':dict(zip([1,2,3,5,8,13,21,34,55,89],list('ABCDEFGHIJ'))),'str':{'foo':'X','barbaz':'Y','qux_quux':'Z'},'float':{.1:'LOW',3.1415:'MID',2.71828:'HIGH'}}
    out=[]
    for w in d['workloads']:
        if w['kind']=='single':out.append(['ONLY']*len(w['values']));continue
        k=w['kind'];types={'int':(int,),'str':(str,),'float':(int,float)}[k]
        out.append([maps[k].get(v,'ValidationError') if type(v) in types else 'ValidationError' for v in w['values']])
    return out
