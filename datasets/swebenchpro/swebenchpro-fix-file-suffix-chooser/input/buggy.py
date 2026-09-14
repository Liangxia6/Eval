def solve(d):
    return d['filters']+[('*'+x) for x in d['mime_extensions']]
