def solve(d):
    b=d['bytes'];return {'accepted':True,'payload':[b[i+1] for i in range(b[0])]}
