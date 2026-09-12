def solve(d):
    base=d['K0'];shock=base;out=[]
    for year in d['years']:
        extra=d['shock_usd']*d['fx']/d['shock_years'] if d['shock_start']<=year<d['shock_start']+d['shock_years'] else 0
        base=(1-d['depreciation'])*base+d['base_investment'];shock=(1-d['depreciation'])*shock+d['base_investment']+extra
        y=lambda k:d['A']*k**d['alpha']*d['labor']**(1-d['alpha'])
        yb=y(base);ys=y(shock);out.append({'year':year,'Kbase':base,'Kwith':shock,'Ybase':yb,'Ywith':ys,'gap':ys-yb,'percent':100*(ys-yb)/yb})
    return out
