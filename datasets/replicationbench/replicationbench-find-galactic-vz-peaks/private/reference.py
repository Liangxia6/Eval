def solve(d):
    bins=sorted([b for b in d['bins'] if 5<=b['radius']<=12],key=lambda b:b['radius'])
    means=[max(b['components'],key=lambda c:c['amplitude'])['mean_vz'] for b in bins]
    peaks=[bins[i]['radius'] for i in range(1,len(bins)-1) if means[i]>means[i-1] and means[i]>means[i+1]]
    return {'value':peaks,'dominant_means':means}
