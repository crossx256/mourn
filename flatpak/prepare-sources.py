#!/usr/bin/env python3
"""Generate Flatpak dependency sources from lockfiles, without network or installs.

Only registry packages with cryptographic checksums are admitted. This emits a
Node resolution tree from Bun's locked package keys; it does not resolve versions
again or use package-lock.json. Review changes before publishing.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent
NAME = re.compile(r"(?:@[a-z0-9._-]+/)?[a-z0-9._-]+\Z", re.I)
VERSION = re.compile(r"[0-9A-Za-z.+_-]+\Z")
# Quasar uses sass-embedded. Only this exact top-level collision is reviewed;
# a new contender or a collision in a different node_modules scope must fail.
REVIEWED_BIN_OWNERS = {
    'node_modules/.bin/sass': {
        'owner': 'node_modules/sass-embedded',
        'contenders': ['node_modules/sass', 'node_modules/sass-embedded'],
    },
}


def bin_owners(packages):
    owners = {}
    for arch in ('x86_64', 'aarch64'):
        candidates = {}
        for pkg in packages:
            if arch not in pkg['arches']:
                continue
            scope = pkg['path'].rsplit('/node_modules/', 1)[0] + '/node_modules' if '/node_modules/' in pkg['path'] else 'node_modules'
            for name, relative in pkg['bin'].items():
                if not re.fullmatch(r'[A-Za-z0-9._-]+', name) or name in ('.', '..') or not isinstance(relative, str):
                    raise ValueError('Unsafe executable metadata')
                candidates.setdefault(scope + '/.bin/' + name, []).append(pkg['path'])
        for link, contenders in sorted(candidates.items()):
            if len(contenders) < 2:
                continue
            policy = REVIEWED_BIN_OWNERS.get(link)
            if not policy or sorted(contenders) != policy['contenders'] or policy['owner'] not in contenders:
                raise ValueError('Unreviewed executable collision: ' + link)
            owners.setdefault(link, {**policy, 'arches': []})['arches'].append(arch)
    return owners


def canonical_lock_bytes(file):
    # Commitments describe UTF-8/LF source bytes, not platform checkout bytes.
    data = file.read_bytes().replace(b'\r\n', b'\n')
    data.decode('utf-8')
    if b'\r' in data:
        raise ValueError('Lockfiles must use LF or CRLF line endings')
    return data


def jsonc(text):
    # Bun's text lockfile is JSON with trailing commas. Do not rewrite quoted
    # strings (including escaped quotes), and never eval executable input.
    out, i, quoted, escaped = [], 0, False, False
    while i < len(text):
        c = text[i]
        if quoted:
            out.append(c)
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted = True
            out.append(c)
        elif c == ',':
            j = i + 1
            while j < len(text) and text[j].isspace():
                j += 1
            if j == len(text) or text[j] not in '}]':
                out.append(c)
        else:
            out.append(c)
        i += 1
    return json.loads(''.join(out))


def package_path(key):
    parts, packages, i = key.split('/'), [], 0
    while i < len(parts):
        width = 2 if parts[i].startswith('@') else 1
        name = '/'.join(parts[i:i + width])
        if not NAME.fullmatch(name) or name in ('.', '..'):
            raise ValueError('Invalid Bun package key')
        packages.append(name)
        i += width
    if not packages:
        raise ValueError('Empty Bun package key')
    return '/'.join('node_modules/' + name for name in packages)


def admitted_arches(meta):
    oses = meta.get('os', [])
    oses = [oses] if isinstance(oses, str) else oses
    if oses and ('!linux' in oses or ('linux' not in oses and any(not s.startswith('!') for s in oses))):
        return []
    cpus = meta.get('cpu', [])
    cpus = [cpus] if isinstance(cpus, str) else cpus
    result = []
    for arch, cpu in [('x86_64', 'x64'), ('aarch64', 'arm64')]:
        if cpus and ('!' + cpu in cpus or (cpu not in cpus and any(not s.startswith('!') for s in cpus))):
            continue
        result.append(arch)
    return result


def node_sources(lock, package):
    if lock.get('lockfileVersion') != 1 or lock.get('configVersion') != 1:
        raise ValueError('Unsupported Bun lock format; review the generator')
    workspace = lock['workspaces']['']
    for field in ('dependencies', 'devDependencies', 'optionalDependencies'):
        if workspace.get(field, {}) != package.get(field, {}):
            raise ValueError('package.json and bun.lock disagree: ' + field)
    if lock.get('overrides', {}) != package.get('overrides', {}):
        raise ValueError('package.json and bun.lock overrides disagree')
    sources, layout = [], []
    for key, entry in sorted(lock['packages'].items()):
        if not isinstance(entry, list) or len(entry) != 4:
            raise ValueError('Unsupported Bun package tuple: ' + key)
        spec, registry, meta, integrity = entry
        name, version = spec.rsplit('@', 1)
        if not NAME.fullmatch(name) or not VERSION.fullmatch(version) or registry != '':
            raise ValueError('Only standard npm registry tarballs supported: ' + key)
        if not integrity.startswith('sha512-'):
            raise ValueError('Missing SHA-512 integrity: ' + key)
        checksum = base64.b64decode(integrity[7:], validate=True)
        if len(checksum) != 64:
            raise ValueError('Invalid SHA-512 integrity: ' + key)
        arches = admitted_arches(meta)
        if not arches:
            continue
        dest = package_path(key)
        source = {
            'type': 'archive', 'archive-type': 'tar-gzip', 'strip-components': 1,
            'url': 'https://registry.npmjs.org/' + name + '/-/' + name.split('/')[-1] + '-' + version + '.tgz',
            'sha512': checksum.hex(), 'dest': dest,
        }
        if len(arches) != 2:
            source['only-arches'] = arches
        sources.append(source)
        bins = meta.get('bin', {})
        if isinstance(bins, str):
            bins = {name.split('/')[-1]: bins}
        if not isinstance(bins, dict):
            raise ValueError('Unsupported bin metadata: ' + key)
        layout.append({'path': dest, 'name': name, 'version': version, 'bin': bins, 'arches': arches})
    return sources, {'schema': 2, 'packages': layout, 'binOwners': bin_owners(layout)}


def cargo_sources(lock):
    sources = []
    for pkg in sorted(lock['package'], key=lambda p: (p['name'], p['version'])):
        if 'source' not in pkg:
            if pkg['name'] != 'mourn-desktop':
                raise ValueError('Unreviewed local Cargo dependency')
            continue
        if pkg['source'] != 'registry+https://github.com/rust-lang/crates.io-index':
            raise ValueError('Unreviewed non-registry Cargo source')
        name, version, checksum = pkg['name'], pkg['version'], pkg.get('checksum', '')
        if not NAME.fullmatch(name) or not VERSION.fullmatch(version) or not re.fullmatch('[0-9a-f]{64}', checksum):
            raise ValueError('Invalid Cargo package checksum/identity')
        dest = 'cargo/vendor/' + name + '-' + version
        sources += [
            {'type': 'archive', 'archive-type': 'tar-gzip', 'strip-components': 1,
             'url': 'https://static.crates.io/crates/' + name + '/' + name + '-' + version + '.crate',
             'sha256': checksum, 'dest': dest},
            {'type': 'inline', 'contents': json.dumps({'package': checksum, 'files': {}}, sort_keys=True),
             'dest': dest, 'dest-filename': '.cargo-checksum.json'},
        ]
    sources.append({'type': 'inline', 'dest': '.cargo', 'dest-filename': 'config.toml',
                    'contents': '[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = "cargo/vendor"\n[net]\noffline = true\n'})
    return sources


def generate(root=ROOT):
    bun_bytes = canonical_lock_bytes(root / 'bun.lock')
    cargo_bytes = canonical_lock_bytes(root / 'src-tauri/Cargo.lock')
    node, layout = node_sources(jsonc(bun_bytes.decode()), json.loads((root / 'package.json').read_text()))
    cargo = cargo_sources(tomllib.loads(cargo_bytes.decode()))
    commitment = {'schema': 2, 'lockfile_encoding': 'utf-8-lf',
                      'bun_lock_sha256': hashlib.sha256(bun_bytes).hexdigest(),
                  'cargo_lock_sha256': hashlib.sha256(cargo_bytes).hexdigest()}
    return {'node-sources.json': node, 'node-layout.json': layout, 'cargo-sources.json': cargo, 'source-locks.json': commitment}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare generated sources without writing')
    args = parser.parse_args()
    for name, value in generate().items():
        contents = json.dumps(value, indent=2, ensure_ascii=False) + '\n'
        destination = ROOT / 'flatpak' / name
        if args.check:
            if not destination.exists() or destination.read_text(encoding='utf-8') != contents:
                raise ValueError('Stale Flatpak input: ' + name)
        else:
            destination.write_text(contents, encoding='utf-8', newline='\n')
    print('Flatpak dependency sources ' + ('match lockfiles' if args.check else 'generated from lockfiles') + '; no downloads or installs')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        print('Flatpak source preparation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
