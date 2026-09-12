from urllib.parse import quote,urlsplit,urlunsplit
def solve(d):
    enc=lambda x:quote(x,safe='~-._')
    header='OAuth '+', '.join(enc(k)+'="'+enc(v)+'"' for k,v in d['params'])
    p=urlsplit(d['uri']);extra='&'.join(enc(k)+'='+enc(v) for k,v in d['params'])
    query=p.query+('&' if p.query and extra else '')+extra
    return {'header':header,'uri':urlunsplit((p.scheme,p.netloc,p.path,query,p.fragment))}
