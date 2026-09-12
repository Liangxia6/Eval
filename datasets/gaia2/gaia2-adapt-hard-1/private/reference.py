import copy
def solve(d):
    date=d['initial_date'];film={'date':date,'start':8,'end':20,'title':'Film Production Day','attendees':[d['friend']]};status='scheduled'
    cancelled={date};r=d['reply']
    if r and not r['can_attend']:
        if r['proposed_date'] is None:film=None;status='cancelled'
        else:film.update(date=r['proposed_date'],start=r['start'],end=r['end']);cancelled.add(r['proposed_date']);status='rescheduled'
    return {'remaining_events':sorted([copy.deepcopy(e) for e in d['events'] if e['date'] not in cancelled],key=lambda e:e['id']),'film':film,'initial_invitation':{'date':date,'start':8,'end':20,'recipient':d['friend']},'status':status}
