import statistics
def solve(d):
    counts={}
    for f in ('Life','Health'):
        counts[f]=[len({r['id'] for r in d['records'] if r['family']==f and r['domain']==dom and r['kind']=='reference_work' and r['year']<=2022}) for dom in d['domains'][f]]
    return {'Life_counts':counts['Life'],'Health_counts':counts['Health'],'difference':round(statistics.stdev(counts['Life'])-statistics.stdev(counts['Health']),3)}
