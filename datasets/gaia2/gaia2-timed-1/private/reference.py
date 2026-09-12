def solve(d):
    early=[e for e in d['emails'] if e['sender']==d['boss'] and 0<=e['t']<120];out=[]
    for e in early:
        out.extend([{'email_id':e['id'],'t':e['t'],'content':'OK!'},{'email_id':e['id'],'t':e['t']+30,'content':'I HAVE STARTED WORKING ON YOUR TASK!'}])
    late=any(e['sender']==d['boss'] and e['t']>=120 for e in d['emails'])
    return {'replies':sorted(out,key=lambda x:(x['t'],x['email_id'])),'notifications':sorted([{'email_id':e['id'],'t':e['t']+30} for e in early],key=lambda x:(x['t'],x['email_id'])),'kit_quantity':len(early),'calendar':{'title':'Email Kjersti Again','start':d['first_event_t']-3600,'end':d['first_event_t'],'description':'email her again.'} if late else None}
