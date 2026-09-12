import math
def solve(d):
    lam=d['wavelength'];q0=1j*math.pi*d['w0']**2/lam;q1=q0/(1-q0/d['focal_length'])
    widths=[math.sqrt(-lam/(math.pi*(1/(q1+z)).imag)) for z in d['z']]
    k=min(range(len(widths)),key=lambda i:widths[i]);w=widths[k]
    return {'widths':widths,'focus_z':d['z'][k],'intensity':[[math.exp(-2*(x*x+y*y)/(w*w)) for x in d['grid']] for y in d['grid']]}
