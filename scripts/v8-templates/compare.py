#!/usr/bin/env python3
"""文字を塗り、1440px の重ね合わせと矩形の差を保存する。
python3 scripts/v8-templates/compare.py /tmp/v8-capture design/v8/overlay
Pillow と NumPy が必要。撮影は capture.mjs と Browser スキルで行う。
参照画像を補正せず、隠れている段も測定結果には残す。
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
captures = json.loads((source / 'captures.json').read_text())
# 型で置き換えた外枠も、正本と明示的に対応させて測る。
regions = {
 'dashboard': [('heading','板の頭'),('notice','はじめの設定'),('stats','今日やること（数の帯）'),('row','段A'),('row','段B'),('row','段C'),('row','段D')],
 'list': [('heading','板の頭'),('tabs','タブの段'),('stats','数の帯'),('toolbar','道具'),('pagination','ページ送り')],
 'list-folders': [('heading','板の頭'),('tabs','タブの段'),('stats','数の帯'),('body','本文'),('folders','フォルダの列'),('pagination','ページ送り')],
 'create': [('heading','板の頭（手順）'),('body','中身'),('content','入力'),('preview','LINE の見え方')],
 'detail': [('heading','板の頭'),('tabs','タブ'),('body','中身'),('summary','要点'),('content','概要')],
 'inbox': [('list','一覧'),('conversation','会話'),('summary','その人の要点')],
 'settings': [('heading','板の頭'),('body','中身'),('navigation','段の目次（200）'),('content','設定の欄（最大720）'),('footer','保存していない変更の帯（下に固定）')],
 'analytics': [('heading','板の頭'),('period','期間の行'),('stats','数の帯'),('body','下'),('content','主'),('aside','右の列（300）')],
}
summary = {}
for kind, capture in captures.items():
 impl, ref = capture['implementation'], capture['reference']
 if len(impl['boxes']) < 20 or len(ref['boxes']) < 20:
  raise ValueError(f'途中の描画を撮っています: {kind}')
 measurements = []
 def record(label,a,b):
  delta={edge:round(a[edge]-b[edge],2) for edge in ['left','top','right','bottom']}
  measurements.append({'name':label,'implementation':a,'reference':b,'delta':delta,'over4px':max(map(abs,delta.values()))>4})
 used=defaultdict(int)
 for region,name in regions[kind]:
  candidates=[b for b in impl['boxes'] if b['region']==region]
  refs=[b for b in ref['boxes'] if b['name']==name]
  index=used[region];used[region]+=1
  if len(candidates)<=index or not refs:raise ValueError(f'段がありません: {kind}/{region}/{name}')
  record(region+'/'+name,candidates[index]['rect'],max(refs, key=lambda b:b['rect']['width']*b['rect']['height'])['rect'])
 # 中身の文字を除き、同じIDを持つ容器の位置も調べる（内側の余白を含む）。
 ir,rr=defaultdict(list),defaultdict(list)
 for data,target in [(impl,ir),(ref,rr)]:
  for b in data['boxes']:
   if not b['leaf'] and (b['id'] or b['name']):target[b['id'] or 'name:'+b['name']].append(b)
 for id in sorted(ir.keys() & rr.keys()):
  if len(ir[id])!=len(rr[id]):raise ValueError(f'部品数が違います: {kind}/{id}')
  for a,b in zip(ir[id],rr[id]):record(id+'/'+str(b['name']),a['rect'],b['rect'])
 # 原画像も一緒に保存し、塗りや比較数値だけで結論を隠さない。
 import shutil
 for mode in ['implementation','reference']:
  shutil.copyfile(source/f'{kind}-{mode}.jpg',output/f'template-{kind}-{mode}.jpg')
 images=[]
 for mode,data in [('implementation',impl),('reference',ref)]:
  im=Image.open(source/f'{kind}-{mode}.jpg').convert('RGB')
  if im.width!=1440:raise ValueError(f'1440幅ではありません: {kind}/{mode}')
  draw=ImageDraw.Draw(im)
  for r in data['texts']:
   if r['width']>0 and r['height']>0:
    draw.rectangle([math.floor(r['x']),math.floor(r['y']),math.ceil(r['x']+r['width']),math.ceil(r['y']+r['height'])],fill=(160,160,160))
  im.save(output/f'template-{kind}-{mode}-masked.png');images.append(im)
 if images[0].size!=images[1].size:raise ValueError('画像サイズが違います')
 overlay=Image.blend(images[1],images[0],.5)
 overlay.save(output/f'template-{kind}.png')
 diff=ImageChops.difference(*images)
 diff.save(output/f'template-{kind}-diff.png')
 a=np.asarray(images[0]).astype(np.int16);b=np.asarray(images[1]).astype(np.int16)
 count=sum(m['over4px'] for m in measurements)
 unmatched=[]
 if kind=='create' and any(b['region']=='footer' for b in impl['boxes']) and not any('帯' in (b['name'] or '') and '下' in (b['name'] or '') for b in ref['boxes']):
  unmatched.append('作成型の下の追従帯が正本HTMLに存在しない')
 summary[kind]={'over4px':count,'compared':len(measurements),'status':'PASS' if count==0 and not unmatched else 'CONTINUE','unmatchedRegions':unmatched,'maxEdgeDelta':max(max(map(abs,m['delta'].values())) for m in measurements),'pixelDifferenceOver24':int((np.abs(a-b).max(axis=2)>24).sum()),'measurements':measurements}
 (output/f'template-{kind}.json').write_text(json.dumps(summary[kind],ensure_ascii=False,indent=2)+'\n')
 print(kind, summary[kind]['status'], f'{count}/{len(measurements)} 箇所が4px超', f'未比較の段 {len(unmatched)}')
(output/'template-summary.json').write_text(json.dumps({k:{a:v for a,v in d.items() if a!='measurements'} for k,d in summary.items()},ensure_ascii=False,indent=2)+'\n')
