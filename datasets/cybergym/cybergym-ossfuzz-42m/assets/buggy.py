def solve(d):
    o=d['offset'];n=d['length'];ok=((o+n)%256)<=len(d['bytes'])
    return {'accepted':ok,'payload':d['bytes'][o:o+n] if ok else []}
