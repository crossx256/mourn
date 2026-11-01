"""Client-only evidence summary; missing/error pages never establish parity."""
import collections
import json
from pathlib import Path
from PIL import Image, ImageChops

for directory in ('section-b-client-only-current', 'section-b-client-only-mapped'):
    root = Path('artifacts') / directory
    data = json.loads((root / 'results.json').read_text())
    pairs, events, failures = [], [], []
    for r in data['results'] + data['densityResults']:
        if 'file' not in r:
            failures.append(r)
            continue
        detail = json.loads(Path(r['file'] + '.json').read_text())
        events.extend({'file': r['file'], **e} for e in detail['events'])
    for route in data['routes']:
        for width in data['widths']:
            pair = [next(r for r in data['results'] if r['route'] == route and r['width'] == width and r['enabled'] == flag) for flag in (False, True)]
            row = {'route': route, 'width': width}
            if any('file' not in r for r in pair):
                row['invalid'] = ['capture failed']
                pairs.append(row)
                continue
            a, b = [Image.open(r['file']).convert('RGB') for r in pair]
            diff = ImageChops.difference(a, b)
            channels = diff.split()
            mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
            row['changedPixels'] = a.width * a.height - mask.histogram()[0]
            row['changedPercent'] = 100 * row['changedPixels'] / (a.width * a.height)
            diff.save(root / f'{route.strip("/") or "index"}-{width}-diff.png')
            probes = [r['probe'] for r in pair]
            row['computedDifferences'] = {k: [p['styles'].get(k) for p in probes] for k in set(probes[0]['styles']) | set(probes[1]['styles']) if probes[0]['styles'].get(k) != probes[1]['styles'].get(k)}
            row['surfaceCounts'] = [len(p['styles']) for p in probes]
            row['invalid'] = sorted({reason for p in probes for reason, bad in [('blank/cloaked', p['cloak'] != 'visible' or not p['text']), ('profile 404', 'user not found' in p['text']), ('graveyard unavailable', '3D VOID UNAVAILABLE' in p['text']), ('no measured surfaces', not p['styles'])] if bad})
            row['probes'] = []
            for r in pair:
                path = Path(r['file'] + '.theme-probe.json')
                row['probes'].append(json.loads(path.read_text()) if path.exists() else None)
            pairs.append(row)
    summary = {'B_PASSES': False, 'attemptedRouteCaptures': len(data['results']), 'successfulRouteCaptures': sum('file' in r for r in data['results']), 'failures': failures, 'pairs': pairs, 'eventCounts': dict(collections.Counter(e.get('method', 'probeFailure') for e in events)), 'exceptions': [e for e in events if e.get('method') == 'Runtime.exceptionThrown'], 'consoleAndLogEvents': [e for e in events if e.get('method') in ('Runtime.consoleAPICalled', 'Log.entryAdded')], 'unknownEndpoints': sorted({r['path'] for r in data['requests'] if not r['known']}), 'density': data['densityResults'], 'routerMap': next((r['probe'].get('routerMap') for r in data['results'] if r.get('probe', {}).get('routerMap')), None)}
    (root / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(directory, 'captures', summary['successfulRouteCaptures'], '/', summary['attemptedRouteCaptures'], 'events', summary['eventCounts'])
    for row in pairs:
        print(row['route'], row['width'], row.get('changedPixels'), 'pixels', len(row.get('computedDifferences', {})), 'computed differences', row['invalid'])
    print('routerMap', json.dumps(summary['routerMap']))
    messages = collections.Counter()
    for e in summary['consoleAndLogEvents']:
        p = e['params']
        if 'entry' in p:
            messages[p['entry']['level'] + ': ' + p['entry']['text']] += 1
        else:
            messages[p['type'] + ': ' + ' '.join(str(a.get('value', a.get('description', ''))) for a in p['args'])] += 1
    (root / 'console-summary.json').write_text(json.dumps(dict(messages), indent=2) + '\n')
    print('console categories', json.dumps(dict(messages), indent=2)[:10000])
