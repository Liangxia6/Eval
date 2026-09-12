def solve(d):
    t=d['template'];p=d['position'];N=len(t);comp=str.maketrans('ACGT','TGCA');best=None
    def tm(s):return 2*sum(c in 'AT' for c in s)+4*sum(c in 'GC' for c in s)
    for nf in range(15,min(45,N)+1):
        f=''.join(t[(p+i)%N] for i in range(nf));tf=tm(f)
        for nr in range(15,min(45,N)+1):
            r=''.join(t[(p-nr+i)%N] for i in range(nr))[::-1].translate(comp);tr=tm(r)
            if 58<=tf<=72 and 58<=tr<=72 and abs(tf-tr)<=5:
                key=(nf+nr,nf,nr)
                if best is None or key<best[0]:best=(key,{'forward':d['insert']+f,'reverse':r,'nf':nf,'nr':nr,'tm_forward':tf,'tm_reverse':tr,'pairs':1})
    return best[1] if best else None
