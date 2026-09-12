import math
def solve(d):
    mat=[]
    for row in d['pwm']:
        p=[v+1 for v in row];norm=math.sqrt(sum(v*v for v in p));mat.append([v/norm for v in p])
    kld=sum(v*math.log(v/.25) for r in mat for v in r);hits=[];m=len(mat)
    for i in range(len(d['sequence'])-m+1):
        s=d['sequence'][i:i+m]
        if any(b not in 'ACGT' for b in s):continue
        score=sum(math.log(mat[j]['ACGT'.index(b)]/.25) for j,b in enumerate(s))
        if score>d['scale']*kld:hits.append(i)
    return {'matrix':mat,'kld':kld,'hits':hits,'position':hits[0] if hits else None}
