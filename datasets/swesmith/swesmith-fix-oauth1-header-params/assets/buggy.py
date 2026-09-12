def solve(d):
    text='&'.join(k+'='+v for k,v in d['params'])
    return {'header':'OAuth '+text,'uri':d['uri']+'?'+text}
