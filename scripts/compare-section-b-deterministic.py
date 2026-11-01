"""Exact unthresholded pixels, locations, and matched DOM evidence. No waivers."""
import json
from pathlib import Path
from collections import Counter
from PIL import Image, ImageChops

root = Path('artifacts/section-b-client-only-deterministic')
data = json.loads((root / 'results.json').read_text())

def pixels(a, b, output=None):
    a, b = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    diff = ImageChops.difference(a, b)
    channels = diff.split()
    mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    if output:
        diff.save(output)
    tiles = []
    for y in range(0, a.height, 64):
        for x in range(0, a.width, 64):
            tile = mask.crop((x, y, min(x+64,a.width), min(y+64,a.height)))
            n = tile.width * tile.height - tile.histogram()[0]
            if n:
                tiles.append({'x': x, 'y': y, 'changedPixels': n})
    return {'changedPixels': a.width*a.height-mask.histogram()[0], 'bbox': mask.getbbox(), 'tiles': sorted(tiles,key=lambda t:-t['changedPixels'])}

rows = []
for route in data['routes']:
    for width in data['widths']:
        pair = [next(r for r in data['results'] if r['route']==route and r['width']==width and r['enabled']==flag) for flag in (False,True)]
        row = {'route':route,'width':width,'states':{}}
        if any('file' not in r for r in pair):
            row['invalid']=['capture failure']; rows.append(row); continue
        details = [json.loads(Path(r['file']+'.json').read_text()) for r in pair]
        row['ready'] = [d['ready'] for d in details]
        row['pendingLoads'] = [d['pendingLoads'] for d in details]
        row['matched'] = [r['probe']['matched'] for r in pair]
        row['invalid'] = sorted({reason for d in details for reason,bad in [('not ready',not d['ready']),('graveyard WebGL unavailable','3D VOID UNAVAILABLE' in d['probe']['text']),('profile 404','user not found' in d['probe']['text']),('missing expected selector',bool(d['probe']['missing']))] if bad})
        row['surfaceDifferences'] = [{'index':i,'off':a,'on':b} for i,(a,b) in enumerate(zip(pair[0]['probe']['surfaces'],pair[1]['probe']['surfaces'])) if a!=b]
        row['surfaceCounts'] = [len(r['probe']['surfaces']) for r in pair]
        for state in ('base','hover','field'):
            paths = [Path(r['file']) if state=='base' else Path(r['file'].replace('.png',f'-{state}.png')) for r in pair]
            if all(p.exists() for p in paths):
                name = f'{route.strip("/") or "index"}-{width}-{state}-diff.png'
                row['states'][state] = pixels(*paths,root/name)
        rows.append(row)

old = Path('artifacts/section-b-client-only-current')
oldrows=[]
for route in ('index','archives','leaderboard','graveyard','stub'):
    for width in data['widths']:
        a,b=[old/f'{flag}-{route}-{width}.png' for flag in ('off','on')]
        if a.exists() and b.exists(): oldrows.append({'route':route,'width':width,**pixels(a,b)})
events=Counter()
for r in data['results']+data['densityResults']:
    if 'file' not in r: continue
    for e in json.loads(Path(r['file']+'.json').read_text())['events']:
        p=e.get('params',{})
        if e.get('method')=='Log.entryAdded': events[p['entry']['level']+': '+p['entry']['text']+' '+p['entry'].get('url','')]+=1
        elif e.get('method')=='Runtime.consoleAPICalled' and p['type'] in ('error','warning'): events[p['type']+': '+' '.join(str(a.get('value',a.get('description',''))) for a in p['args'])]+=1
dashboard_pair = [root/f'density-{flag}-comfortable-1366.png' for flag in ('off','on')]
dashboard = pixels(*dashboard_pair, root/'dashboard-1366-diff.png')
dashboard['ready'] = [json.loads(Path(str(p)+'.json').read_text())['ready'] for p in dashboard_pair]
summary={'dashboard':dashboard,'B_PASSES':False,'pairs':rows,'originalLocations':oldrows,'console':dict(events),'density':data['densityResults'],'unknownEndpoints':sorted({r['path'] for r in data['requests'] if not r['known']})}
(root/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
for r in rows: print(r['route'],r['width'],{k:(v['changedPixels'],v['bbox']) for k,v in r['states'].items()},'DOM differences',len(r.get('surfaceDifferences',[])),r.get('invalid'))
print('unknown endpoints',summary['unknownEndpoints'])
print('console error/warning count',sum(events.values()))
