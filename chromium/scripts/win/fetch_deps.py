#!/usr/bin/env python3
"""Adds what a Windows build needs to Chromium's source tarball.

The official tarball (chromium-<version>-lite.tar.xz) is made from a Linux
checkout: the dependencies DEPS only checks out for Windows aren't in it (the
DirectX and WebAuthn headers, gperf, the Windows gn, Node, TypeScript, 7-Zip
for the installer...), and the prebuilt tools that are in it are Linux ones.
This reads DEPS as gclient would for a Windows checkout and fetches those:
git dependencies as archives from Chromium's gitiles, CIPD packages with the
CIPD client, and GCS objects from Google Cloud Storage. Safe to run again:
each dependency it fetched has a stamp, and is skipped next time.

  python3 fetch_deps.py <chromium src> [--cipd <cipd client>] [--plan]
"""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile

# What a Windows x64 checkout sets (gclient's own variables).
WIN_VARS = {
    'checkout_win': True,
    'checkout_linux': False,
    'checkout_mac': False,
    'checkout_android': False,
    'checkout_ios': False,
    'checkout_fuchsia': False,
    'checkout_chromeos': False,
    'checkout_x64': True,
    'checkout_x86': False,
    'checkout_arm': False,
    'checkout_arm64': False,
    'host_os': 'win',
    'host_cpu': 'x64',
    'checkout_src_internal': False,
}
CIPD_PLATFORM = 'windows-amd64'

# Dependencies the browser's build doesn't use: Google's updater and its test
# data, test and remote-build tools, internal-only packages, and the tools
# other projects use when built on their own.
SKIP = re.compile(
    r'/(updater|enterprise_companion|skia_goldctl|screen-ai|soda-win\w*|wix|'
    r'apache-windows-arm64|webview2|reclient|luci-go|siso|resultdb|'
    r'webpagereplay|windows-arm64)(/|$)'
    r'|^/third_party/openscreen/src/(third_party/llvm-build|buildtools)/'
    r'|^/third_party/dawn/third_party/ninja$')

STAMP = '.unveil-win-dep'


class Vars(dict):
  """Variables for DEPS conditions: unknown ones are False, as in gclient."""

  def __missing__(self, key):
    return False


def load_deps(deps_file, parent_vars=None):
  """deps, recursedeps, use_relative_paths and the variables of a DEPS file."""
  scope = {}

  def Var(name):
    return scope['vars'][name]

  exec(open(deps_file, encoding='utf-8').read(),
       {'Var': Var, 'Str': str, '__builtins__': {}}, scope)
  variables = Vars(scope.get('vars', {}))
  for key, value in list(variables.items()):
    if isinstance(value, str) and value in ('True', 'False'):
      variables[key] = value == 'True'
  # As in gclient, a project's variables are set from its parent's.
  for key, value in (parent_vars or {}).items():
    if key in variables:
      variables[key] = value
  variables.update(WIN_VARS)
  return (scope.get('deps', {}), scope.get('recursedeps', []),
          scope.get('use_relative_paths', False), variables)


def holds(condition, variables):
  if not condition:
    return True
  return bool(eval(condition, {'__builtins__': {}}, variables))


def mentions_win(condition):
  return bool(condition) and ('checkout_win' in condition or 'host_os == "win"' in condition)


def fetch(url, tries=5):
  for attempt in range(tries):
    try:
      with urllib.request.urlopen(url, timeout=300) as response:
        return response.read()
    except Exception:
      if attempt == tries - 1:
        raise
      time.sleep(2 ** attempt)


def fresh_dir(path):
  if os.path.isdir(path):
    shutil.rmtree(path)
  os.makedirs(path)


def stamped(path, key):
  try:
    return open(os.path.join(path, STAMP), encoding='utf-8').read() == key
  except OSError:
    return False


def stamp(path, key):
  with open(os.path.join(path, STAMP), 'w', encoding='utf-8') as f:
    f.write(key)


def unpack(data, name, path):
  if name.endswith('.zip'):
    zipfile.ZipFile(io.BytesIO(data)).extractall(path)
  else:
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
      archive.extractall(path, filter='tar')


def plan(src, deps_file='DEPS', prefix='', parent_vars=None):
  """What to fetch: (kind, path, details) for each dependency, from DEPS and
  the DEPS of the projects it recurses into (Dawn, ANGLE, DevTools...)."""
  deps, recursedeps, relative, variables = load_deps(
      os.path.join(src, prefix, deps_file), parent_vars)
  todo = []

  def where(path):
    if relative:
      return os.path.join(prefix, path).replace(os.sep, '/')
    return path[len('src/'):] if path.startswith('src/') else None

  for path, dep in deps.items():
    if not isinstance(dep, dict):
      dep = {'url': dep}
    condition = dep.get('condition')
    rel = where(path)
    if rel is None or SKIP.search('/' + rel) or not holds(condition, variables):
      continue
    kind = dep.get('dep_type', 'git')
    if kind == 'git':
      if mentions_win(condition) and dep.get('url'):
        todo.append(('git', rel, dep['url']))
    elif kind == 'cipd':
      packages = [p for p in dep['packages'] if holds(p.get('condition'), variables)]
      native = [p for p in packages if '${{platform}}' in p['package'] or 'windows' in p['package']]
      if packages and (mentions_win(condition) or native):
        todo.append(('cipd', rel, packages))
    elif kind == 'gcs':
      objects = [o for o in dep['objects'] if holds(o.get('condition'), variables)]
      win = [o for o in objects if mentions_win(o.get('condition')) or mentions_win(condition)]
      if win:
        todo.append(('gcs', rel, (dep['bucket'], win)))

  for path in recursedeps:
    if isinstance(path, (list, tuple)):
      path, deps_file = path
    else:
      deps_file = 'DEPS'
    rel = where(path)
    if rel and os.path.isfile(os.path.join(src, rel, deps_file)):
      todo += plan(src, deps_file, rel, variables)
  return todo


def fetch_git(src, rel, url):
  repo, _, revision = url.partition('@')
  path = os.path.join(src, rel)
  if stamped(path, revision):
    return
  print(f'git  {rel} @ {revision[:12]}', flush=True)
  fresh_dir(path)
  unpack(fetch(f'{repo}/+archive/{revision}.tar.gz'), 'archive.tar.gz', path)
  stamp(path, revision)


def drop_linux_binaries(path):
  """Removes the Linux executables the tarball has where the Windows tools
  go: gn would run third_party/cpython3/host/bin/python3 (Linux) before it
  looked for python3.exe."""
  for root, _, files in os.walk(path):
    for name in files:
      file = os.path.join(root, name)
      try:
        with open(file, 'rb') as f:
          elf = f.read(4) == b'\x7fELF'
      except OSError:
        continue
      if elf:
        os.unlink(file)


def fetch_cipd(src, rel, packages, cipd):
  lines = [f'$ParanoidMode CheckPresence']
  for p in packages:
    lines.append(f"{p['package'].replace('${{platform}}', CIPD_PLATFORM)} {p['version']}")
  key = '\n'.join(lines)
  path = os.path.join(src, rel)
  if stamped(path, key):
    return
  print(f'cipd {rel}: ' + ', '.join(p['package'] for p in packages), flush=True)
  os.makedirs(path, exist_ok=True)
  drop_linux_binaries(path)
  with tempfile.NamedTemporaryFile('w', suffix='.ensure', delete=False) as f:
    f.write(key + '\n')
  try:
    subprocess.run([cipd, 'ensure', '-root', path, '-ensure-file', f.name], check=True)
  finally:
    os.unlink(f.name)
  stamp(path, key)


def fetch_gcs(src, rel, bucket, objects):
  key = json.dumps([o['object_name'] for o in objects])
  path = os.path.join(src, rel)
  if stamped(path, key):
    return
  os.makedirs(path, exist_ok=True)
  for o in objects:
    name = o['object_name']
    print(f'gcs  {rel}: {name}', flush=True)
    data = fetch(f'https://storage.googleapis.com/{bucket}/{name}')
    if 'sha256sum' in o and hashlib.sha256(data).hexdigest() != o['sha256sum']:
      raise SystemExit(f'{name}: checksum mismatch')
    if 'output_file' in o:
      # A single file, not an archive.
      with open(os.path.join(path, o['output_file']), 'wb') as f:
        f.write(data)
    else:
      unpack(data, name, path)
  stamp(path, key)


def main():
  parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
  parser.add_argument('src')
  parser.add_argument('--cipd', default='cipd', help='the CIPD client')
  parser.add_argument('--plan', action='store_true', help='only list what it would fetch')
  args = parser.parse_args()

  todo = plan(args.src)
  for kind, rel, details in todo:
    if args.plan:
      what = details if kind == 'git' else (
          [p['package'] for p in details] if kind == 'cipd' else [o['object_name'] for o in details[1]])
      print(f'{kind:4} {rel}: {what}')
    elif kind == 'git':
      fetch_git(args.src, rel, details)
    elif kind == 'cipd':
      fetch_cipd(args.src, rel, details, args.cipd)
    else:
      fetch_gcs(args.src, rel, *details)


if __name__ == '__main__':
  main()
