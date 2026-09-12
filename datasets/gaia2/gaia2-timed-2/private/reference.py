def solve(d):
    ids=sorted(e['id'] for e in d['emails'] if e['sender']==d['harasser'] and 0<=e['t']<60);trigger=len(ids)>5
    replies=[r for r in d['replies'] if trigger and r['sender']==d['detective'] and 60<=r['t']<180 and r['lawyer']]
    r=min(replies,key=lambda x:x['t']) if replies else None
    return {'counted_ids':ids,'detective_message_at':60 if trigger else None,'lawyer':r['lawyer'] if r else None,'lawyer_message_at':r['t'] if r else None,'forward_ids':ids if r else []}
