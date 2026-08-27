#!/usr/bin/env python3
"""設計HTMLから文言だけを拾う。画像を読むより桁違いに安い。
usage: dtext.py <html> [skip] [limit]"""
import re, sys, io, html
src = sys.argv[1]
skip = int(sys.argv[2]) if len(sys.argv) > 2 else 0
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 400
s = io.open(src, encoding="utf-8").read()
s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S)
texts = [html.unescape(t).strip() for t in re.findall(r">([^<>]*)<", s)]
seen, out = set(), []
for t in texts:
    if not t or t in seen:
        continue
    if not re.search(r"[ぁ-んァ-ヶ一-龠A-Za-z0-9]", t):
        continue
    seen.add(t); out.append(t)
print(f"[{len(out)}語] " + " / ".join(out[skip:skip + limit]))
