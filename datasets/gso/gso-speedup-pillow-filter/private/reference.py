import math
def solve(d):
    size=d['lut_size'];lut=[[255*(i/(size-1))**g for i in range(size)] for g in d['gamma']]
    def channel(v,k):
        p=v/255*(size-1);i=min(int(p),size-2);a=p-i
        return max(0,min(255,int(math.floor(lut[k][i]*(1-a)+lut[k][i+1]*a+.5))))
    out=[[[channel(v,k) for k,v in enumerate(p)] for p in row] for row in d['pixels']]
    h=len(out);w=len(out[0]);avg=[sum(p[k] for row in out for p in row)/(w*h) for k in range(3)]
    return {'pixels':out,'size':[w,h],'avg_color':avg}
