from datetime import date
def solve(d):
    out=[]
    for s in d['dates']:
        x=date.fromisoformat(s);out.append(f'{x.year:04d}-{x.month:02d}')
    return out
