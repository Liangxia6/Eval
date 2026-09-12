def solve(d):
    start=d['start'];n=d['length']
    if start<0 or n<0:raise ValueError('negative slice')
    rows=d['rows'][start:start+n];v=[r['value'] for r in rows]
    return {'selected_rows':len(rows),'start_index':start,'end_index':start+len(rows)-1,'first_id':rows[0]['id'] if rows else None,'first_text':rows[0]['text'] if rows else None,'last_id':rows[-1]['id'] if rows else None,'last_text':rows[-1]['text'] if rows else None,'total_value':sum(v),'min_value':min(v) if v else None,'max_value':max(v) if v else None}
