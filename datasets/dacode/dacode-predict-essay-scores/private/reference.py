import math,numpy as np
def solve(d):
    def features(t):
        words=t.split();n=len(words)
        return [1,math.log1p(n),math.log1p(n)**2,len(set(x.lower() for x in words))/max(n,1),sum(c in '.!?' for c in t)/max(n,1)]
    X=np.array([features(r['text']) for r in d['train']]);y=np.array([r['score'] for r in d['train']])
    coef=np.linalg.lstsq(X,y,rcond=None)[0]
    return np.clip(np.rint(np.array([features(r['text']) for r in d['test']])@coef),1,6).astype(int).tolist()
