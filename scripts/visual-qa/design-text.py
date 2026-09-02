#!/usr/bin/env python3
"""設計HTMLから文言だけを、**出てくる順のまま**拾う。画像を読むより桁違いに安い。

usage: design-text.py <html> [skip] [limit] [--uniq]

既定は重複を消しません。**消すと行が壊れます。**
フォルダの「すべて 9 / 予約 3 / 契約更新 3」のように同じ数が並ぶとき、
2つめの `3` を落とすと、どの行の数なのか分からなくなります。
同じ言葉が2度出るのは、たいてい設計がそう描いているからです。

`--uniq` は言葉の種類だけ見たいとき用。
"""
import re, sys, io, html

args = [a for a in sys.argv[1:] if not a.startswith("--")]
uniq = "--uniq" in sys.argv
src = args[0]
skip = int(args[1]) if len(args) > 1 else 0
limit = int(args[2]) if len(args) > 2 else 400

s = io.open(src, encoding="utf-8").read()
s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S)
texts = [html.unescape(t).strip() for t in re.findall(r">([^<>]*)<", s)]

seen, out = set(), []
for t in texts:
    if not t:
        continue
    if not re.search(r"[ぁ-んァ-ヶ一-龠A-Za-z0-9]", t):
        continue
    if uniq:
        if t in seen:
            continue
        seen.add(t)
    elif out and out[-1] == t:
        # 続けて同じものはDOMの入れ子。1つにする
        continue
    out.append(t)

print(f"[{len(out)}語] " + " / ".join(out[skip:skip + limit]))
