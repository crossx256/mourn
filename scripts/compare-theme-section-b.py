"""Compare captured pixels and computed probes; never interprets equal error pages as parity."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path('artifacts/section-b')
data = json.loads((root / 'results.json').read_text())
rows = []
for route in data['routes']:
    for width in data['widths']:
        pair = [next(r for r in data['results'] if r.get('route') == route and r.get('width') == width and r.get('enabled') == enabled) for enabled in (False, True)]
        a, b = [Image.open(r['file']).convert('RGB') for r in pair]
        diff = ImageChops.difference(a, b)
        channels = diff.split()
        mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
        changed = a.width * a.height - mask.histogram()[0]
        name = ('index' if route == '/' else route[1:]) + f'-{width}-diff.png'
        diff.save(root / name)
        probes = [r['probe'] for r in pair]
        keys = sorted(set(probes[0]['styles']) | set(probes[1]['styles']))
        style_diffs = {k: [p['styles'].get(k) for p in probes] for k in keys if probes[0]['styles'].get(k) != probes[1]['styles'].get(k)}
        invalid = []
        for r in pair:
            p = r['probe']
            if p['cloak'] != 'visible' or not p['text']: invalid.append('blank/cloaked')
            if p['href'].split('#')[-1] != route: invalid.append('redirect/wrong route')
            if 'user not found' in p['text']: invalid.append('profile 404')
        rows.append({'route': route, 'width': width, 'changedPixels': changed, 'totalPixels': a.width * a.height, 'changedPercent': round(100 * changed / (a.width * a.height), 4), 'computedDifferences': style_diffs, 'missing': [p['missing'] for p in probes], 'invalid': sorted(set(invalid)), 'diff': name})
exceptions = []
for r in data['results']:
    j = json.loads(Path(r['file'] + '.json').read_text())
    for e in j['events']:
        if e.get('method') == 'Runtime.exceptionThrown': exceptions.append({'file': r['file'], 'detail': e['params']['exceptionDetails']})
summary = {'captures': len(data['results']), 'pairs': len(rows), 'zeroPixelPairs': sum(r['changedPixels'] == 0 for r in rows), 'nonzeroPixelPairs': sum(r['changedPixels'] > 0 for r in rows), 'invalidPairs': sum(bool(r['invalid']) for r in rows), 'completeProbeCaptures': sum(not r['probe']['missing'] for r in data['results']), 'exceptionCount': len(exceptions), 'unknownEndpoints': sorted({r['path'] for r in data['requests'] if not r['known']}), 'pairsDetail': rows, 'exceptions': exceptions}
density_exceptions = []
for r in data.get('densityResults', []):
    j = json.loads(Path(r['file'] + '.json').read_text())
    density_exceptions.extend({'file': r['file'], 'detail': e['params']['exceptionDetails']} for e in j['events'] if e.get('method') == 'Runtime.exceptionThrown')
summary['densityCaptures'] = len(data.get('densityResults', []))
summary['densityExceptionCount'] = len(density_exceptions)
summary['densityMeasurements'] = [{'enabled': r['enabled'], 'density': r['density'], 'dataset': r['probe']['theme'], 'rows': r['probe']['rows']} for r in data.get('densityResults', [])]
summary['densityExceptions'] = density_exceptions
summary['computedIdenticalPairs'] = sum(not r['computedDifferences'] for r in rows)
(root / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: v for k, v in summary.items() if k not in ('pairsDetail', 'exceptions')}, indent=2))
for r in rows: print(r['route'], r['width'], r['changedPixels'], 'pixels;', len(r['computedDifferences']), 'computed differences;', r['invalid'])
