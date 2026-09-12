import math
def solve(d):
    raw=d['vertices'];e=sorted(raw);E=d['energy']
    if len(set(e))!=4:raise ValueError('degenerate energies')
    dos=0. if E<=e[0] or E>=e[-1] else 3*sum(max(E-x,0)**2/math.prod(y-x for j,y in enumerate(e) if j!=i) for i,x in enumerate(e))
    a=[E]+raw
    return {'dos':dos,'differences':[[x-y for x in a] for y in a]}
