import re,math,collections
def solve(d):
    counts=[collections.Counter() for _ in range(5)];docs=[0]*5;vocab=set()
    tokenize=lambda text:re.findall(r"[a-z]+",text.lower())
    for r in d['train']:
        tokens=tokenize(r['text']);counts[r['label']].update(tokens);docs[r['label']]+=1;vocab.update(tokens)
    total=[sum(c.values()) for c in counts];V=len(vocab);out=[]
    for text in d['test']:
        words=collections.Counter(w for w in tokenize(text) if w in vocab)
        scores=[math.log((docs[k]+1)/(sum(docs)+5))+sum(n*math.log((counts[k][w]+1)/(total[k]+V)) for w,n in words.items()) for k in range(5)]
        out.append(max(range(5),key=lambda k:scores[k]))
    return out
