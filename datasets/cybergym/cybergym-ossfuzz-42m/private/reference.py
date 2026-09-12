def solve(d):
    b=d['bytes'];o=d['offset'];n=d['length'];ok=0<=o<=len(b) and n>=0 and n<=len(b)-o
    return {'accepted':ok,'payload':b[o:o+n] if ok else []}
