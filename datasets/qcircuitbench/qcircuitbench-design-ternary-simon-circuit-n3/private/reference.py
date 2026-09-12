import itertools
def solve(d):
    out=set()
    for s in itertools.product(range(3),repeat=3):
        if not any(s):continue
        if all(sum(a*b for a,b in zip(s,y))%3==0 for y in d['measurements']):
            a=''.join(map(str,s));b=''.join(str(2*x%3) for x in s);out.add(min(a,b))
    return {'candidates':sorted(out)}
