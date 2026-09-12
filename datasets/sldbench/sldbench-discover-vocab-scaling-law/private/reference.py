import numpy as np,math
def solve(d):
    def x(r):return [1,math.log(r['N']),math.log(r['V']),math.log(r['D']),math.log(r['V'])*math.log(r['D'])]
    coef=np.linalg.lstsq(np.array([x(r) for r in d['train']]),np.array([r['loss'] for r in d['train']]),rcond=None)[0]
    return (np.array([x(r) for r in d['test']])@coef).tolist()
