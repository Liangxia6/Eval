import hashlib,copy
def solve(d):
    r=copy.deepcopy(d['records'])
    for k in ('rows','bytes'):
        if k in r:r[k]=int(r[k])
    return {'tags':[[x['key'],x['value']] for x in (d['tags'] or [])],'records':r,'inputs':copy.deepcopy(d['schema_inputs']),'digest':d['digest'] or hashlib.sha256(d['name'].encode()).hexdigest()}
