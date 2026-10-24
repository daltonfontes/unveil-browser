#!/usr/bin/env python3
"""Checks that Unveil's patches apply to the Chromium version we target.

A full Chromium checkout is ~100 GB, so this fetches only the files Unveil's
patches touch, from Chromium's gitiles at the tag in
ungoogled-chromium/chromium_version.txt. It applies the ungoogled-chromium and
ungoogled-chromium-windows patches to those files first (the same order as
build.py), then Unveil's, with no fuzz. It runs on Linux in a few seconds, so
CI catches a stale patch before a 20-hour Windows build does.

  python3 tools/check_patches.py            # check
  python3 tools/check_patches.py --keep DIR # also leave the patched files in DIR
                                            # (handy for writing a new patch)
"""

import argparse
import base64
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UC_WIN = ROOT / 'ungoogled-chromium-windows'
UC = UC_WIN / 'ungoogled-chromium'
GITILES = 'https://chromium.googlesource.com/chromium/src'
CACHE = ROOT / 'build' / 'check_cache'


def parse_series(patches_dir):
    lines = (patches_dir / 'series').read_text(encoding='utf-8').splitlines()
    return [patches_dir / l.strip() for l in lines if l.strip() and not l.startswith('#')]


def split_patch(path):
    """Yields (target file, section text) for each file in a unified diff."""
    text = path.read_text(encoding='utf-8')
    sections = re.split(r'(?m)^(?=--- .*\n\+\+\+ )', text)
    for section in sections:
        m = re.match(r'--- (\S+).*\n\+\+\+ (\S+)', section)
        if not m:
            continue
        old, new = m.group(1), m.group(2)
        target = new if new != '/dev/null' else old
        yield re.sub(r'^[ab]/', '', target), section


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def chromium_commit(version):
    cached = CACHE / version / '.commit'
    if cached.exists():
        return cached.read_text().strip()
    raw = fetch(f'{GITILES}/+/refs/tags/{version}?format=JSON').decode()
    commit = json.loads(raw[raw.index('{'):])['commit']
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(commit)
    return commit


def fetch_source(version, commit, rel):
    """Returns the file at Chromium `version`, or None if it doesn't exist."""
    cached = CACHE / version / rel
    missing = cached.with_name(cached.name + '.missing')
    if cached.exists():
        return cached.read_bytes()
    if missing.exists():
        return None
    cached.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = base64.b64decode(fetch(f'{GITILES}/+/{commit}/{rel}?format=TEXT'))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        missing.touch()
        return None
    cached.write_bytes(data)
    return data


def apply(section, tree, fuzz):
    return subprocess.run(
        ['patch', '-p1', '--forward', '--no-backup-if-mismatch', f'--fuzz={fuzz}',
         '-d', str(tree)],
        input=section, text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--keep', type=Path, help='copy the patched files here')
    args = parser.parse_args()

    version = (UC / 'chromium_version.txt').read_text().strip()
    commit = chromium_commit(version)
    print(f'Chromium {version} ({commit[:12]})')

    ours = parse_series(ROOT / 'patches')
    targets = {t for p in ours for t, _ in split_patch(p)}

    tree = Path(tempfile.mkdtemp(prefix='unveil-check-'))
    for rel in sorted(targets):
        data = fetch_source(version, commit, rel)
        if data is not None:
            (tree / rel).parent.mkdir(parents=True, exist_ok=True)
            (tree / rel).write_bytes(data)

    # Upstream patches first, as build.py applies them (GNU patch's default fuzz).
    for patch in parse_series(UC / 'patches') + parse_series(UC_WIN / 'patches'):
        for rel, section in split_patch(patch):
            if rel in targets:
                r = apply(section, tree, fuzz=2)
                if r.returncode:
                    print(f'upstream patch {patch.name} failed on {rel}:\n{r.stdout}{r.stderr}')
                    return 1

    failed = 0
    for patch in ours:
        for rel, section in split_patch(patch):
            r = apply(section, tree, fuzz=0)
            if r.returncode:
                failed += 1
                print(f'FAIL {patch.name}: {rel}\n{r.stdout}{r.stderr}')
        if not failed:
            print(f'ok   {patch.name}')

    if args.keep:
        shutil.copytree(tree, args.keep, dirs_exist_ok=True)
        print(f'patched files in {args.keep}')
    shutil.rmtree(tree)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
