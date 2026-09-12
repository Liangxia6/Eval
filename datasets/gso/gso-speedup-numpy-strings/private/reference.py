def solve(d):
    flags=[s.isalpha() for s in d['strings']]
    return {'flags':flags,'total':len(flags),'count':sum(flags)}
