def solve(d):
    f=min(d['flavors'],key=lambda f:(f['start_year'],f['id']))['id'];photos=[p for p in d['photos'] if p['flavor_id']==f]
    h=next((h for p in photos for h in p['headstones'] if h['position']=='background'),None)
    return {'flavor_id':f,'last_line':h['lines'][-1] if h and h['lines'] else None}
