def solve(d):
    z=min(d['locations'],key=lambda x:(x['violent_rate'],x['zip']))['zip']
    initial={a['id'] for a in d['apartments'] if a['saved'] or a['zip']==z};final=set(initial)
    people=sorted(c['id'] for c in d['contacts'] if c['occupation']=='data scientist');r=d['reply'];to=None
    if r and r['contact_id'] in people:
        final-={a['id'] for a in d['apartments'] if a['zip']==z and a['price']<r['min_price']};to=r['contact_id']
    return {'selected_zip':z,'initial_saved_ids':sorted(initial),'final_saved_ids':sorted(final),'notified_contacts':people,'change_message_to':to,'silent_no_reply':r is None}
