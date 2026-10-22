#!/usr/bin/env python3
"""Assemble src/index.html et tous ses fichiers en un seul fichier autonome :
dist/simulateur_arduino.html (s'ouvre par double-clic, sans Internet ni installation)."""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
OUT = ROOT / 'dist' / 'simulateur_arduino.html'


MIME = {'.png': 'image/png', '.cur': 'image/x-icon'}


def media_uri(m):
    f = SRC / 'vendor' / 'media' / m.group(1)
    if not f.exists():
        return m.group(0)
    return 'data:' + MIME[f.suffix] + ';base64,' + base64.b64encode(f.read_bytes()).decode()


def inline(html: str) -> str:
    def css(m):
        text = (SRC / m.group(1)).read_text(encoding='utf-8')
        return '<style>\n' + text + '\n</style>'

    def js(m):
        text = (SRC / m.group(1)).read_text(encoding='utf-8')
        text = re.sub(r'</(script)', r'<\\/\1', text, flags=re.I)
        # images et curseurs de Blockly intégrés : aucune requête réseau
        text = re.sub(r'<<<PATH>>>/([\w.]+)', media_uri, text)
        return '<script>\n' + text + '\n</script>'

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    return html


def main():
    html = (SRC / 'index.html').read_text(encoding='utf-8')
    out = inline(html)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)} : {len(out.encode("utf-8")) / 1024:.0f} Ko')


if __name__ == '__main__':
    sys.exit(main())
