#!/usr/bin/env python3
"""Extract the Source Serif 4 webfonts and their @font-face rules from the
delivered design doc.

The design doc is a self-extracting bundle. Assets live gzipped and base64'd in
a JSON map on one very long line, keyed by UUID. The Broadsheet stylesheet lives
somewhere else entirely: a JSON-encoded HTML string on a shorter long line, with
url("<uuid>") references into that map.

Run from the dashboard directory:

    python3 scripts/extract-design-fonts.py \
      "/Users/ykravchenko/www/JobRadar/docs/dashboard design/Settings - design doc.html"

Writes public/fonts/*.woff2 and src/fonts.css.
"""
import base64, gzip, json, os, re, sys

SRC = sys.argv[1]
FONT_DIR = 'public/fonts'
OUT_CSS = 'src/fonts.css'

lines = open(SRC, encoding='utf-8').read().split('\n')

assets, page = {}, None
for line in lines:
    s = line.strip()
    if len(s) > 100000:
        assets = json.loads(re.search(r'\{.*\}', s).group(0))
    elif 40000 < len(s) < 100000 and s.startswith('"'):
        page = json.loads(s[:-1] if s.endswith(',') else s)

if not assets or page is None:
    sys.exit('could not find both the asset map and the stylesheet page')

css = re.search(r'<style>(.*?)</style>', page, re.S).group(1)
faces = re.findall(r'@font-face \{.*?\}', css, re.S)
if not faces:
    sys.exit('no @font-face rules found')

os.makedirs(FONT_DIR, exist_ok=True)

# Name each file after the face that references it: the subset comes from the
# CSS comment above the rule, the style and weight from the rule itself.
subsets = re.findall(r'/\* ([a-z-]+) \*/\s*@font-face', css)
out, written = [], {}
for face, subset in zip(faces, subsets):
    uuid = re.search(r'url\("([a-f0-9-]{36})"\)', face).group(1)
    style = re.search(r'font-style: (\w+)', face).group(1)
    weight = re.search(r'font-weight: (\d+)', face).group(1)
    name = f'source-serif-4-{subset}-{weight}{"-italic" if style == "italic" else ""}.woff2'

    if uuid not in written:
        entry = assets[uuid]
        raw = base64.b64decode(entry['data'])
        if entry.get('compressed'):
            raw = gzip.decompress(raw)
        open(os.path.join(FONT_DIR, name), 'wb').write(raw)
        written[uuid] = name
    out.append(face.replace(f'url("{uuid}")', f'url("/fonts/{written[uuid]}")'))

header = ('/* Source Serif 4, extracted from the delivered design doc by\n'
          '   scripts/extract-design-fonts.py. Do not edit by hand.\n'
          '   Self-hosted on purpose: the dashboard must not depend on a font CDN. */\n\n')
open(OUT_CSS, 'w', encoding='utf-8').write(header + '\n\n'.join(out) + '\n')
print(f'{len(written)} woff2 files -> {FONT_DIR}, {len(out)} @font-face rules -> {OUT_CSS}')
