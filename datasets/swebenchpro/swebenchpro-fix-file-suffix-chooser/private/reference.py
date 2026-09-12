def solve(d):
    out=list(d['filters'])
    if (6,2,2)<tuple(d['version'])<(6,7,0):
        for suffix in d['mime_extensions']:
            if '*'+suffix not in out:out.append('*'+suffix)
    return out
