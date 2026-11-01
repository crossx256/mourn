#!/usr/bin/env python3
"""Offline audit of exact commit-archive or staged-index bytes; matched values are redacted."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
PATTERNS = {
    'private-key': re.compile(rb'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----'),
    'service-token': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk_live_[A-Za-z0-9]{20,})'),
    'credential-url': re.compile(rb'(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s/\"\']+:[^\s@/\"\']+@'),
}


def git(*args, input=None):
    result = subprocess.run(['git', '--no-pager', '--no-optional-locks', *args], cwd=ROOT,
                            input=input, capture_output=True, check=False)
    if result.returncode:
        raise ValueError('Git source/ref validation failed')
    return result.stdout


def validate_path(name, names):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or name in names:
        raise ValueError('Unsafe or duplicate source path')
    names.add(name)
    return path


def inspect_body(name, path, body):
    findings = []
    basename = path.name.lower()
    if (basename == 'appimage-key.batch' or
        (basename.startswith('.env') and basename != '.env.example') or
        basename.endswith(('.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.db', '.sqlite', '.dump')) or '.git' in path.parts):
        findings.append((name, 0, 'sensitive-path'))
    for rule, pattern in PATTERNS.items():
        for match in pattern.finditer(body):
            findings.append((name, body.count(b'\n', 0, match.start()) + 1, rule))
    return findings


def inspect_archive(data):
    findings, names = [], set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        total = 0
        for member in archive:
            path = validate_path(member.name, names)
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('Source archive contains links or special entries; review required')
            total += member.size
            if total > MAX_TOTAL or member.size > MAX_FILE:
                raise ValueError('Source archive exceeds audit budget')
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError('Unable to read archive member')
            findings.extend(inspect_body(member.name, path, stream.read()))
    return findings, names


def inspect_staged():
    # Read the index once, then read immutable Git blobs, never worktree files.
    # No write-tree, temporary index, staging, or object creation is needed.
    snapshot = git('ls-files', '--stage', '-z')
    entries, names = [], set()
    for record in snapshot.split(b'\0'):
        if not record:
            continue
        metadata, raw_name = record.split(b'\t', 1)
        mode, oid, stage = metadata.split(b' ')
        if stage != b'0':
            raise ValueError('Unmerged index entries require resolution before audit')
        if mode not in (b'100644', b'100755'):
            raise ValueError('Staged links, submodules, or special entries require review')
        if not re.fullmatch(rb'[0-9a-f]{40}|[0-9a-f]{64}', oid):
            raise ValueError('Invalid index object identity')
        try:
            name = raw_name.decode('utf-8')
        except UnicodeError:
            raise ValueError('Source paths must be UTF-8') from None
        entries.append((name, validate_path(name, names), oid))
    queries = b''.join(oid + b'\n' for _, _, oid in entries)
    metadata = git('cat-file', '--batch-check', input=queries).splitlines() if entries else []
    if len(metadata) != len(entries):
        raise ValueError('Incomplete index object metadata')
    sizes, total = [], 0
    for (_, _, oid), line in zip(entries, metadata):
        fields = line.split(b' ')
        if len(fields) != 3 or fields[:2] != [oid, b'blob'] or not fields[2].isdigit():
            raise ValueError('Invalid staged object metadata')
        size = int(fields[2])
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            raise ValueError('Staged source exceeds audit budget')
        sizes.append(size)
    stream = io.BytesIO(git('cat-file', '--batch', input=queries) if entries else b'')
    findings = []
    for (name, path, oid), size in zip(entries, sizes):
        if stream.readline() != oid + b' blob ' + str(size).encode() + b'\n':
            raise ValueError('Staged object response disagrees with index')
        body = stream.read(size)
        if len(body) != size or stream.read(1) != b'\n':
            raise ValueError('Truncated staged object response')
        findings.extend(inspect_body(name, path, body))
    if stream.read(1) or git('ls-files', '--stage', '-z') != snapshot:
        raise ValueError('Index changed during audit or contained extra object data')
    return findings, names, hashlib.sha256(snapshot).hexdigest()


def redacted_path(name):
    value = name.encode('utf-8')
    for pattern in PATTERNS.values():
        value = pattern.sub(b'[REDACTED]', value)
    return value.decode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ref', nargs='?', help='Commit to audit (default: HEAD)')
    parser.add_argument('--staged', action='store_true', help='Audit every exact index blob, excluding unstaged/untracked changes; no writes')
    parser.add_argument('--archive', type=Path, help='Write audited deterministic gzip archive (committed clean tree only)')
    args = parser.parse_args()
    if args.staged and (args.ref is not None or args.archive is not None):
        parser.error('--staged cannot be combined with a ref or --archive')
    if args.staged:
        findings, names, digest = inspect_staged()
        print('Audited staged index snapshot SHA-256 ' + digest + ': ' + str(len(names)) + ' blobs (not worktree/history)')
    else:
        commit = git('rev-parse', '--verify', (args.ref or 'HEAD') + '^{commit}').decode().strip()
        if not re.fullmatch('[0-9a-f]{40}|[0-9a-f]{64}', commit):
            raise ValueError('Invalid commit identity')
        data = git('archive', '--format=tar', commit)
        findings, names = inspect_archive(data)
        print('Audited commit ' + commit + ': ' + str(len(names)) + ' archive entries')
    for name, line, rule in findings:
        print(json.dumps({'file': redacted_path(name), 'line': line, 'rule': rule, 'value': '[REDACTED]'}))
    if findings:
        raise ValueError('Source audit findings require review; nothing published')
    if args.archive:
        if git('status', '--porcelain', '--untracked-files=normal'):
            raise ValueError('Refusing release archive from a dirty tree; commit/review first')
        if not any(name in names for name in ('LICENSE', 'LICENSE.md', 'LICENSE.txt')):
            raise ValueError('Project license is unresolved; owner-supplied LICENSE required')
        if not args.archive.parent.is_dir():
            raise ValueError('Archive parent directory must already exist')
        with args.archive.open('xb') as output:
            with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
                compressed.write(data)
        print('Wrote audited source archive; publishing is a separate manual action')
    print('No secret-shaped matches found; not proof of license clearance or absence of all secrets/history leaks')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('Source audit blocked: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, tarfile.TarError):
        print('Source audit blocked: local I/O or archive parsing failed; diagnostic values withheld', file=sys.stderr)
        sys.exit(1)
