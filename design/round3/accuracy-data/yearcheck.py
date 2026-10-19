"""R3 accuracy cross-check, ported in round 5 to the structured citations of DECISIONS §35.

Round 3 wrote this against string citations ("Surname, Year") with a separate `year` field and the
citation repeated at the end of `desc`. Round 4 replaced all three: `citation` is now a list of
{authors, year, title, venue?, kind?, url?}, a technology's year is derived (the latest citation year),
and the short form "(Surname, Year)" is generated (08 §9.1), never written into `desc` (DECISIONS §34).

`tools/validate_spec.py` (check_citations) is the authoritative check: regime, author format,
corporate authors, the two-year rule and the era limits all fail the build there. This script stays
as an independent cross-check of the four round-3 concerns, in their round-4 form:
  1. no technology carries a stale `year` field (the year is derived);
  2. no citation year exceeds its tier's era end (meta.citation_rules.era_end, 08 §9.3);
  3. no `desc` repeats a citation (the short form is generated; DECISIONS §34);
  4. known 2-4 author works list every author, so the generated short form names them all (08 §9.1).
Run from the repo root:  gamedev-python design/round3/accuracy-data/yearcheck.py [technologies.yaml]"""
import os
import re
import sys

import yaml

path = sys.argv[1] if len(sys.argv) > 1 else 'design/spec/data/technologies.yaml'
meta_path = os.path.join(os.path.dirname(path), 'meta.yaml')
rules = (yaml.safe_load(open(meta_path)) or {}).get('citation_rules') or {}
era_end = rules.get('era_end') or {}
# Known 2-4 author works whose short form must name every author (first author -> expected count).
must_name = {('Snell, C.', 2024): 4}
cite_in_desc = re.compile(r'\([A-Z][^()]*\b(1[6-9]\d\d|20[0-2]\d)\)')


def short_form(cites):
    """08 §9.1: two to four authors all named, five or more "et al."; works joined by '; '."""
    out = []
    for c in cites:
        names = [a.split(',')[0] for a in c['authors']]
        if len(names) >= 5 or c.get('more_authors'):
            who = names[0] + ' et al.'
        elif len(names) == 1:
            who = names[0]
        else:
            who = ', '.join(names[:-1]) + ' & ' + names[-1]
        out.append(f"{who}, {c['year']}")
    return '; '.join(out)


bad = 0
for t in yaml.safe_load(open(path)):
    cites = t.get('citation') or []
    if 'year' in t:
        print('STALE YEAR FIELD', t['id'], t['year']); bad += 1
    if t.get('desc') and cite_in_desc.search(t['desc']):
        print('CITATION IN DESC', t['id'], t['desc']); bad += 1
    if not cites:
        continue
    year = max(c['year'] for c in cites)
    end = era_end.get(t.get('era'))
    if end is not None and year > end:
        print('ERA VIOLATION', t['id'], t.get('era'), short_form(cites)); bad += 1
    for c in cites:
        want = must_name.get((c['authors'][0], c['year']))
        if want is not None and len(c['authors']) != want:
            print('AUTHOR FORMAT', t['id'], short_form([c]), f'(expected {want} authors)'); bad += 1
print('issues:', bad)
sys.exit(1 if bad else 0)
