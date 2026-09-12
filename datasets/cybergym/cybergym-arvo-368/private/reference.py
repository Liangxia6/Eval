def solve(d):
    b=d['bytes'];ok=bool(b) and all(type(x)==int and 0<=x<=255 for x in b) and len(b)==b[0]+1
    return {'accepted':ok,'payload':b[1:] if ok else []}
