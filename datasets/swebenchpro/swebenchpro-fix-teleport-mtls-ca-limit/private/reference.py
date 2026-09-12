import copy
def solve(d):
    size=lambda xs:sum(2+len(x.encode('utf-8')) for x in xs)
    selected=d['trusted'] if size(d['trusted'])<=65535 else d['host']
    if size(selected)>65535:raise ValueError('host CA list too large')
    base=copy.deepcopy(d['base']);cfg=copy.deepcopy(base);cfg['ClientCAs']=list(selected)
    return {'connection':cfg,'base_after':base}
