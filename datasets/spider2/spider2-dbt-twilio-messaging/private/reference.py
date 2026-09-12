from decimal import Decimal
def solve(d):
    seen=set();phone={};account={}
    def acc(store,key,m):
        r=store.setdefault(key,{'inbound':0,'outbound':0,'statuses':{},'spend':Decimal(0)})
        r[m['direction']]+=1;r['statuses'][m['status']]=r['statuses'].get(m['status'],0)+1;r['spend']+=abs(Decimal(m['price'] or '0'))
    for m in d['messages']:
        if m['id'] in seen:continue
        seen.add(m['id']);p=m['to'] if m['direction']=='inbound' else m['from'];acc(phone,(m['account'],p),m);acc(account,m['account'],m)
    def clean(r):return {**r,'spend':format(r['spend'],'.2f')}
    return {'phones':[{'account':a,'phone':p,**clean(r)} for (a,p),r in sorted(phone.items())],'accounts':[{'account':a,**clean(r)} for a,r in sorted(account.items())]}
