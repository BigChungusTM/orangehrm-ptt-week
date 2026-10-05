#!/usr/bin/env python3
"""Regenerate the ready-to-paste bookmark URL from the readable source."""
from pathlib import Path
from urllib.parse import quote, unquote

root = Path(__file__).resolve().parent
source = (root / 'orangehrm-ptt-week.js').read_text(encoding='utf-8')
assert source.count('fetch(') == 1
assert 'data:image/' not in source

guard = ('if(!location.pathname.startsWith("/web/index.php/"))'
         '{alert("Open your signed-in OrangeHRM page first.");return;}')
wrapped = f'void(function(){{{guard}{source}}}())'
url = 'javascript:' + quote(wrapped, safe='(){}[];,:+-_.*~!/$?=@')
assert unquote(url[len('javascript:'):]) == wrapped
(root / 'bookmarklet.txt').write_text(url + '\n', encoding='utf-8')
print(f'Wrote bookmarklet.txt ({len(url):,} characters)')
