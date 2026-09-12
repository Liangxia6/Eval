def solve(d):
    words=[]
    for i in d['program']:
        op=i['op']
        for key in ('rd','rt','rs','base'):
            if key in i and not 0<=i[key]<32:raise ValueError('register')
        for key in ('imm','offset'):
            if key in i and not -32768<=i[key]<=32767:raise ValueError('immediate')
        if op=='halt':w=0xffffffff
        elif op=='addiu':w=(9<<26)|(i['rs']<<21)|(i['rt']<<16)|(i['imm']&65535)
        elif op=='addu':w=(i['rs']<<21)|(i['rt']<<16)|(i['rd']<<11)|33
        elif op=='sw':w=(43<<26)|(i['base']<<21)|(i['rt']<<16)|(i['offset']&65535)
        else:raise ValueError('opcode')
        words.append(w)
    regs=[0]*32;mem={};halted=False
    for w in words:
        if w==0xffffffff:halted=True;break
        op=w>>26;rs=(w>>21)&31;rt=(w>>16)&31;rd=(w>>11)&31;imm=w&65535;imm=imm-65536 if imm>=32768 else imm
        if op==9:regs[rt]=(regs[rs]+imm)&0xffffffff
        elif op==0:regs[rd]=(regs[rs]+regs[rt])&0xffffffff
        else:
            addr=regs[rs]+imm
            if addr<0 or addr%4:raise ValueError('address')
            mem[addr]=regs[rt]
        regs[0]=0
    if not halted:raise ValueError('missing halt')
    return {'machine_hex':b''.join(w.to_bytes(4,'little') for w in words).hex(),'registers':regs,'memory':[{'address':a,'value':v} for a,v in sorted(mem.items())]}
