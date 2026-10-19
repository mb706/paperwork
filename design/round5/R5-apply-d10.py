"""R5-apply: R5-gate D10's scheduler sentence under its two readings, in takeoff_r4.py's model (04 §5.1, §13 #6).

  SEQ  the sim's own sequential order (the reference: G's tech list = meta.endgame.takeoff_order)
  B    strict (adopted): the first entry neither researched nor queued is appended once its prerequisites are
       all researched; while it waits, nothing is appended
  A2   the first entry neither researched nor queued whose prerequisites are each researched or queued ahead of it
  A    the sentence read as a search: the first entry anywhere in the order that is neither researched nor
       queued and whose prerequisites are all researched
Queue cap 7, refilled right after every completion (and at closure). Nothing else of the model changes. The adopted
rule's pass-over clause (04 §5.1) never applies here: the reference closure state has Nuclear power and Liquid cooling.
Run: gamedev-python design/round5/R5-apply-d10.py   (from /home/mewse/browsergame)
"""
import math, os, sys
SIM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'round4', 'world-sim')
sys.path.insert(0, SIM)

import takeoff_r4 as K
T, R = K.T, K.R

PRE = {"Weight transplant": ["Wafer-scale integration"], "Photonic interconnect": ["Wafer-scale integration"],
       "Microfluidic cooling": ["Two-phase cooling"], "Self-reproducing automata": ["Fleet scheduling"],
       "Nanofabrication": ["Wafer-scale integration"], "Reversible logic": ["Photonic interconnect"]}

def prereqs(name):
    if name.startswith("Model generation "):
        L = int(name.split()[-1])
        return [] if L == 6 else [f"Model generation {L-1}"]
    return PRE.get(name, [])

RULE = {'r': 'SEQ'}

def fill(queue, done, techs):
    names = [t[0] for t in techs]
    while len(queue) < 7:
        qn = {techs[i][0] for i in queue}
        pick = None
        for i, n in enumerate(names):
            if n in done or n in qn:
                continue
            pr = prereqs(n)
            if RULE['r'] == 'A':
                if all(p in done for p in pr):
                    pick = i; break
            elif RULE['r'] == 'B':
                if all(p in done for p in pr):
                    pick = i
                break
            elif RULE['r'] == 'A2':
                if all(p in done or p in qn for p in pr):
                    pick = i; break
        if pick is None:
            return
        queue.append(pick)

def _simulate(p, log_every):
    st = R.init_state(p)
    techs = R.tech_list(p)
    done_names, done, log = set(), [], []
    queue = list(range(len(techs))) if RULE['r'] == 'SEQ' else []
    if RULE['r'] != 'SEQ':
        fill(queue, done_names, techs)
    next_log = 0.0; t = 0.0; t_cap = None
    order = []
    while t < p.max_t:
        R_, W, u, bind, D = T.rates(st, p)
        if t >= next_log:
            log.append(T._snap(t, st, p)); next_log += log_every
        rem = p.dt
        while rem > 1e-12 and queue:
            name, kind, cost, eff = techs[queue[0]]
            need = cost - st.progress
            if R_ > 0 and R_ * rem >= need:
                rem -= need / R_
                st.progress = 0.0
                R.patched_apply(kind, eff, st, p)
                queue.pop(0)
                done_names.add(name); order.append(name)
                tc = t + (p.dt - rem)
                done.append((name, kind, tc, cost))
                if kind == T.CAP:
                    t_cap = tc
                if RULE['r'] != 'SEQ':
                    fill(queue, done_names, techs)
                R_, W, u, bind, D = T.rates(st, p)
            else:
                st.progress += R_ * rem; rem = 0.0
        if t_cap is not None:
            break
        if p.policy != "frozen":
            st.cards += st.A_rate / 60.0 * p.dt
            while st.cards >= p.cards_per_hall:
                old_k = next((k for k in range(st.tier) if st.halls[k] > 0), None)
                if p.upgrade and st.transplant and old_k is not None:
                    st.halls[old_k] -= 1; st.halls[st.tier] += 1
                elif st.slots_free >= 1:
                    st.slots_free -= 1; st.halls[st.tier] += 1
                else:
                    break
                st.cards -= p.cards_per_hall
        for task in list(st.tasks):
            task[1] -= p.dt
            st.task_time[task[0]] = st.task_time.get(task[0], 0.0) + p.dt
            if task[1] <= 0:
                T.finish_task(task, st, p); st.tasks.remove(task)
        while len(st.tasks) < st.parallel:
            k = T.choose_task(st, p, [x[0] for x in st.tasks])
            if k is None:
                break
            T.start_task(k, st, p)
        t += p.dt
    log.append(T._snap(t, st, p))
    return dict(done=done, log=log, finished=t_cap is not None, task_time=st.task_time,
                t_end=t_cap if t_cap is not None else math.inf, params=p, techs=techs, order=order)

R._simulate = _simulate
for rule in ['SEQ', 'B', 'A2', 'A']:
    RULE['r'] = rule
    res = K.run()
    s = T.summary(res)
    print(rule, round(s['t_end_min'], 2), 'min; last10', round(s['last10_min'] * 60), 's;', ' > '.join(n.replace('Model generation ', 'MG') for n in res['order'][:16]))
    for r in [1.2, 2.0]:
        m = 1.5 ** r
        print('   r', r, round(T.summary(K.run(m=m))['t_end_min'], 1))
