def solve(d):
    out=[]
    def walk(n):
        if n['kind']=='type' and n['name'] not in out:out.append(n['name'])
        elif n['kind']=='union':
            for a in n['args']:walk(a)
        elif n['kind'] not in ('type','literal'):raise ValueError('unknown node')
    walk(d)
    return {'refs':out}
