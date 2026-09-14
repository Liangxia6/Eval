def solve(d):
    d['base']['ClientCAs']=d['trusted']
    return {'connection':d['base'],'base_after':d['base']}
