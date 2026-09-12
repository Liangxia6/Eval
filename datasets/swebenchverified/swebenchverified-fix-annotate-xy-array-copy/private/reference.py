def solve(d):
    source=list(d['xy']);stored=list(source)
    for m in d['mutations']:source[m['index']]=m['value']
    return {'annotation_xy':stored,'source_xy':source}
