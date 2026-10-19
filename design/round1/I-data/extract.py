import sys,re
lines=open(sys.argv[1],encoding='utf-8').read().split('\n')
keep_sections=set(sys.argv[2].split(','))
ver=None;sec=None;out=[]
for ln in lines:
    m=re.match(r'^Version: (.*)',ln)
    if m: ver=m.group(1);sec=None;continue
    m=re.match(r'^  (\S.*):\s*$',ln)
    if m: sec=m.group(1);continue
    if ver is None: continue
    major=ver.split('.')[0]
    if major!='2': continue
    if sec in keep_sections and ln.strip():
        out.append(f"[{ver}|{sec}] {ln.strip()}")
print('\n'.join(out))
