def solve(d):
    rows=[{'id':i,'value':v} for i,v in sorted({(x['id'],x['value']) for x in d['left']+d['right']})]
    def ordered(k):
        return sorted(rows,key=lambda x:x[k.lstrip('-')],reverse=k.startswith('-'))
    base=ordered(d['original_order']);other=ordered(d['derived_order'])
    return {'original_before':base,'derived':[x[d['projection']] for x in other],'original_after':ordered(d['original_order'])}
