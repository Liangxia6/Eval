def solve(d):
    products=sorted(p['id'] for p in d['products'] if p['name']=='Pressman Chinese Checkers Board Game');emails=[e for e in d['emails'] if e['sender']=='Astrid']
    return {'saved_ids':sorted(x['id'] for x in d['saved'] if x['price']>=1500),'purchase_id':products[0] if len(products)==1 else None,'clarify_ids':products if len(products)>1 else [],'reply_to':max(emails,key=lambda x:x['time'])['id'] if emails else None,'event':{'title':'Grocery Trip','date':d['saturday'],'start':14,'end':16,'location':"Hashbro Farmer's Market"}}
