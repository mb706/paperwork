import re, sys, json
src = open(sys.argv[1]).read()
# split into top-level recipe tables by scanning braces
out = []
i = 0
while True:
    m = re.search(r'type\s*=\s*"recipe"', src[i:])
    if not m: break
    start = src.rfind('{', 0, i + m.start())
    depth = 0; j = start
    while True:
        c = src[j]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    block = src[start:j+1]
    i = j + 1
    name = re.search(r'name\s*=\s*"([^"]+)"', block)
    if not name: continue
    name = name.group(1)
    cat = re.search(r'category\s*=\s*"([^"]+)"', block)
    t = re.search(r'energy_required\s*=\s*([0-9.]+)', block)
    def parse_list(key):
        mm = re.search(key + r'\s*=\s*\n?\s*{', block)
        if not mm: return []
        k = mm.end() - 1; d = 0; e = k
        while True:
            if block[e] == '{': d += 1
            elif block[e] == '}':
                d -= 1
                if d == 0: break
            e += 1
        body = block[k:e+1]
        items = []
        for it in re.finditer(r'{[^{}]*}', body):
            s = it.group(0)
            n = re.search(r'name\s*=\s*"([^"]+)"', s)
            a = re.search(r'amount\s*=\s*([0-9.]+)', s)
            p = re.search(r'probability\s*=\s*([0-9.]+)', s)
            ty = re.search(r'type\s*=\s*"([^"]+)"', s)
            if n:
                items.append((n.group(1), a.group(1) if a else '?', ty.group(1) if ty else '', p.group(1) if p else ''))
        return items
    ing = parse_list('ingredients'); res = parse_list('results')
    out.append((name, cat.group(1) if cat else 'crafting', t.group(1) if t else '0.5', ing, res))
want = set(sys.argv[2:])
for name, cat, t, ing, res in out:
    if want and name not in want: continue
    f = lambda L: ' + '.join(f"{a} {n}{'(F)' if ty=='fluid' else ''}{'@p'+p if p else ''}" for n,a,ty,p in L)
    print(f"{name} [{cat}, {t}s]: {f(ing)} -> {f(res)}")
