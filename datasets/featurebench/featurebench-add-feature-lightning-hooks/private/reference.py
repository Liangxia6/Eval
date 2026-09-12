import copy
def solve(d):
    if d['op']=='callbacks':return {k:next((c['name'] for c in d['callbacks'] if c['kind']==k),None) for k in ['checkpoint','progress']}
    if not d['model']:raise RuntimeError('no model')
    if d['op']=='stage':
        if d['loaders'] is not None and d['datamodule'] is not None:raise ValueError('conflict')
        s=d['stage'];return ['setup','on_'+s+'_start',s+'_step','on_'+s+'_end','teardown']
    state={'weights':d['state']['weights']} if d['weights_only'] else d['state']
    return {'state':copy.deepcopy(state),'events':['save','barrier']}
