#!/usr/bin/env python3
"""Asks the Finance Ministry's own calculator (bmf-steuerrechner.de, external interface
"for checking your own calculation", code LSt2026ext) for its answers to a spread of
cases, and keeps them in tests/lohnsteuer-vectors.json. Run rarely and slowly — it is a
public service. tests/lohnsteuer.test.ts holds the generated code to these answers."""
import json, time, itertools, random, urllib.request, urllib.parse, re, sys

random.seed(2026)
base = 'https://www.bmf-steuerrechner.de/interface/2026Version1.xhtml'
cases = []
# monthly pay (cent) from a student's few hours to well above every ceiling
pays = [15000, 45000, 60300, 60400, 90000, 130000, 175000, 200000, 250000, 340000, 520000, 780000, 1250000, 2500000]
for re4, stkl in itertools.product(pays, [1, 2, 3, 4, 5, 6]):
    cases.append(dict(LZZ=2, RE4=re4, STKL=stkl, KVZ='2.9', PVZ=1, R=0, ZKF=0, KRV=0, ALV=0))
# the other switches, each varied on its own and in random mixes
for _ in range(170):
    c = dict(LZZ=2, RE4=random.choice(pays + [random.randint(10000, 900000)]), STKL=random.choice([1, 1, 1, 2, 3, 4, 5, 6]),
             KVZ=random.choice(['1.7', '2.5', '2.9', '3.4']), PVZ=random.choice([0, 1]), R=random.choice([0, 0, 1]),
             ZKF=random.choice(['0', '0', '0.5', '1', '2']), KRV=random.choice([0, 0, 1]), ALV=random.choice([0, 0, 1]),
             PVA=random.choice(['0', '0', '1', '2']), PVS=random.choice([0, 0, 1]))
    if c['STKL'] in (5, 6): c['ZKF'] = '0'
    if random.random() < 0.15: c.update(PKV=1, PKPV=random.choice([30000, 60000]), PKPVAGZ=random.choice([0, 25000]))
    if random.random() < 0.1: c.update(LZZ=1, RE4=c['RE4'] * 12)    # a whole year at once
    cases.append(c)

out = []
for i, c in enumerate(cases):
    q = urllib.parse.urlencode({'code': 'LSt2026ext', **c})
    for attempt in range(3):
        try:
            x = urllib.request.urlopen(f'{base}?{q}', timeout=30).read().decode()
            break
        except Exception as e:
            time.sleep(3)
    else:
        sys.exit(f'case {i} failed')
    got = dict(re.findall(r'<ausgabe name="(\w+)" value="([^"]*)"', x))
    bad = re.findall(r'<eingabe name="(\w+)" value="[^"]*" status="(?!ok)([^"]*)"', x)
    if bad: sys.exit(f'case {i} rejected: {bad} {c}')
    out.append({'in': c, 'out': got})
    time.sleep(0.4)
    if i % 50 == 0: print(i, file=sys.stderr)
json.dump({'source': base + ' (code LSt2026ext)', 'fetched': time.strftime('%Y-%m-%d'), 'cases': out},
          open('tests/lohnsteuer-vectors.json', 'w'), indent=0)
print(len(out), 'cases')
