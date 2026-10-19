import re,sys
lines=open(sys.argv[1],encoding='utf-8').read().split('\n')
def cells(l):
    s=re.sub(r'\\\|','',l)
    # remove code spans
    s=re.sub(r'`[^`]*`','X',s)
    return s.count('|')
in_code=False; tbl=None; bad=0
for i,l in enumerate(lines,1):
    if l.strip().startswith('```'): in_code=not in_code; continue
    if in_code: continue
    if l.startswith('|'):
        c=cells(l)
        if tbl is None: tbl=(i,c)
        elif c!=tbl[1]:
            print(f"line {i}: {c} pipes vs header {tbl[1]} (table at {tbl[0]}): {l[:90]}"); bad+=1
    else:
        tbl=None
print('issues:',bad)
