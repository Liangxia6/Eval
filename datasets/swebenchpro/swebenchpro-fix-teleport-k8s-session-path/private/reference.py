def solve(d):
    key=d['request'];c=d['clusters'].get(key)
    if not key or c is None:return {'error':'NotFound'}
    if c['kind']=='local':return {'addr':c['addr'],'tls':c['tls'],'new_certificate':False}
    if c['kind']=='remote':return {'addr':'tunnel:'+key,'tls':'remote-root-ca','new_certificate':True}
    if not c['endpoints']:return {'error':'BadParameter'}
    e=c['endpoints'][0]
    return {'addr':e['addr'],'server_id':e['name']+'.'+key,'new_certificate':True}
