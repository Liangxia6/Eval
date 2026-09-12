def solve(d):
    rows=d['left']+d['right'];rows.sort(key=lambda x:x[d['derived_order'].lstrip('-')])
    return {'original_before':rows,'derived':[x[d['projection']] for x in rows],'original_after':rows}
