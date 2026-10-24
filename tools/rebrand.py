#!/usr/bin/env python3
"""Renames the browser from Chromium to Unveil in its UI strings.

The product name lives in chrome/app/chromium_strings.grd and the parts it
includes (window titles, the About page, menus, Settings, the installer). Its
translations (.xtb) are keyed by a fingerprint of each English message, so
changing the English text alone would lose every translation of it. This
changes the English messages, then moves each translation to its message's new
ID and renames it there too, with Chromium's own GRIT computing the IDs.

"ChromiumOS", "Chromium OS" and "The Chromium Authors" stay as they are: they
name other things. Runs on the source tree after the patches (build.py), and is
safe to run again.

  python3 tools/rebrand.py path/to/chromium/src
"""

import re
import sys
from pathlib import Path

NAME = 'Unveil'
GRD = Path('chrome/app/chromium_strings.grd')
PART = re.compile(r'<part file="([^"]+)"')
CHROMIUM = re.compile(r'(?<!The )\bChromium\b(?!\s*(?:OS|Authors|Projects?)\b)')
MESSAGE = re.compile(r'(<message\b[^>]*>)(.*?)(</message>)', re.S)
TRANSLATION = re.compile(r'<translation id="(\d+)"([^>]*)>(.*?)</translation>', re.S)


def rename(text):
    return CHROMIUM.sub(NAME, text)


def message_ids(src, grd_path):
    """IDs of the grd's messages, in document order."""
    sys.path.insert(0, str(src / 'tools' / 'grit'))
    from grit import grd_reader  # pylint: disable=import-outside-toplevel
    from grit.node import message  # pylint: disable=import-outside-toplevel
    root = grd_reader.Parse(str(grd_path), str(grd_path.parent), first_ids_file=None,
                            skip_validation_checks=True)
    return [node.GetCliques()[0].GetId()
            for node in root.Preorder() if isinstance(node, message.MessageNode)]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).resolve()
    grd_path = src / GRD
    grd = grd_path.read_text(encoding='utf-8')
    files = [grd_path] + [grd_path.parent / p for p in PART.findall(grd)]

    old_ids = message_ids(src, grd_path)
    changed = False
    for path in files:
        text = path.read_text(encoding='utf-8')
        renamed = MESSAGE.sub(lambda m: m.group(1) + rename(m.group(2)) + m.group(3), text)
        if renamed != text:
            path.write_text(renamed, encoding='utf-8')
            changed = True
    if not changed:
        print(f'{GRD}: already renamed')
        return 0
    new_ids = message_ids(src, grd_path)
    assert len(old_ids) == len(new_ids), 'message count changed'
    moved = {old: new for old, new in zip(old_ids, new_ids) if old != new}
    print(f'{GRD}: {len(moved)} messages renamed')

    for xtb in sorted((grd_path.parent / 'resources').glob('chromium_strings_*.xtb')):
        text = xtb.read_text(encoding='utf-8')

        def move(m):
            msg_id, attrs, body = m.groups()
            if msg_id not in moved:
                return m.group(0)
            return f'<translation id="{moved[msg_id]}"{attrs}>{rename(body)}</translation>'

        xtb.write_text(TRANSLATION.sub(move, text), encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
