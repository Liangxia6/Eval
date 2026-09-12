import math,itertools
def solve(d):
    airports=sorted([a for a in d['airports'] if a['country']=='MY'],key=lambda a:a['code']);arr=[];dist=[]
    for a in airports:arr.append({'airport':a['code'],'flight_count':len({f['id'] for f in d['flights'] if f['status']=='arrived' and f['arrival']==a['code']})})
    for a,b in itertools.combinations(airports,2):
        la,lb=math.radians(a['lat']),math.radians(b['lat']);dl=math.radians(b['lon']-a['lon'])
        h=math.sin((lb-la)/2)**2+math.cos(la)*math.cos(lb)*math.sin(dl/2)**2
        dist.append({'from':a['code'],'to':b['code'],'km':2*6371*math.asin(math.sqrt(min(1,max(0,h))))})
    return {'arrivals':arr,'distances':dist}
