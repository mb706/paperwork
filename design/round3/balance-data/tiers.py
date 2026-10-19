from load import *
import collections
ORDER = ['memo','report','article','preprint','model-card','system-card']
def tier_of(t):
    c = t.get('cost')
    if not c: return 'trigger'
    ps = [p for p in c['packs'] if p != 'proceedings']
    hi = max(ps, key=ORDER.index) if ps else 'proceedings'
    return hi + ('+M' if 'proceedings' in c['packs'] else '')
def labsec(t):
    c = t.get('cost')
    if not c: return 0
    if t.get('max_level') == 'infinite': return None
    if 'count' in c: return c['count'] * c['time']
    # finite multi-level
    s = 0
    for L in range(t.get('first_level', 1), t['max_level'] + 1):
        s += eval(t['count_formula'].replace('^', '**'), {'L': L}) * c['time']
    return s
def closure(tid, acc=None):
    acc = set() if acc is None else acc
    if tid in acc: return acc
    acc.add(tid)
    for p in T[tid].get('prerequisites', []) or []:
        closure(p, acc)
    return acc
if __name__ == '__main__':
    by = collections.defaultdict(lambda: [0, 0])
    for t in techs:
        ls = labsec(t)
        if ls is None: continue
        k = tier_of(t); by[k][0] += 1; by[k][1] += ls
    for k, v in sorted(by.items()): print(k, v)
    gates = {'report': 'linear-programming', 'article': 'statistical-learning', 'preprint': 'deep-learning',
             'model-card': 'expected-utility', 'first-run': 'in-context-learning', 'closure': 'automated-research',
             'mg25': 'model-generation-25'}
    prev = set()
    for g, tid in gates.items():
        cl = closure(tid)
        ls = sum(labsec(T[x]) or 0 for x in cl if T[x].get('cost') and tier_of(T[x]) != 'system-card')
        packs = collections.Counter()
        for x in cl:
            c = T[x].get('cost')
            if not c or 'count' not in c: continue
            for p, a in c['packs'].items(): packs[p] += c['count'] * a
        print(f"{g:11s} {tid:22s} techs {len(cl):3d} lab-s(excl. white) {ls:9,.0f} packs {dict(packs)}")
