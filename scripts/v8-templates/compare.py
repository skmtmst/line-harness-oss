#!/usr/bin/env python3
"""文字を塗り、1440px の重ね合わせと矩形の差を保存する。
python3 scripts/v8-templates/compare.py /tmp/v8-capture design/v8/overlay
Pillow と NumPy が必要。撮影は capture.mjs と Browser スキルで行う。
司令塔2026-10-05 04時の決定：保存帯は共通StickyBarで別検証する。
本文の可視範囲を比較し、除外した範囲・元の四辺を記録する。
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
captures = json.loads((source / 'captures.json').read_text())
footer_check_path = source / 'footer-check.json'
footer_checks = json.loads(footer_check_path.read_text())['results'] if footer_check_path.exists() else []
# 型で置き換えた外枠も、正本と明示的に対応させて測る。
regions = {
 'dashboard': [('heading','板の頭'),('notice','はじめの設定'),('stats','今日やること（数の帯）'),('row','段A'),('row','段B'),('row','段C'),('row','段D')],
 'list': [('heading','板の頭'),('tabs','タブの段'),('stats','数の帯'),('toolbar','道具'),('pagination','ページ送り')],
 'list-folders': [('heading','板の頭'),('tabs','タブの段'),('stats','数の帯'),('body','本文'),('folders','フォルダの列'),('pagination','ページ送り')],
 'create': [('heading','板の頭（手順）'),('body','中身'),('content','入力'),('preview','LINE の見え方'),('footer','下の追従帯')],
 'detail': [('heading','板の頭'),('tabs','タブ'),('body','中身'),('summary','要点'),('content','概要')],
 'inbox': [('list','一覧'),('conversation','会話'),('summary','その人の要点')],
 'settings': [('heading','板の頭'),('body','中身'),('navigation','段の目次（200）'),('content','設定の欄（最大720）'),('footer','保存していない変更の帯（下に固定）')],
 'analytics': [('heading','板の頭'),('period','期間の行'),('stats','数の帯'),('body','下'),('content','主'),('aside','右の列（300）')],
}
summary = {}
for kind, capture in captures.items():
 impl, ref = capture['implementation'], capture['reference']
 for mode,data in [('implementation',impl),('reference',ref)]:
  if data.get('viewport') != {'width':1440,'height':1000}:
   raise ValueError(f'正本と同じ1440×1000の撮影が必要です: {kind}/{mode}')
 if len(impl['boxes']) < 20 or len(ref['boxes']) < 20:
  raise ValueError(f'途中の描画を撮っています: {kind}')
 measurements = []
 unmatched = []
 excluded = []
 footer = next((b['rect'] for b in impl['boxes'] if b['region']=='footer'),None)
 board = next(b['rect'] for b in impl['boxes'] if b['region']=='shell-board')
 cutoff = footer['top']-12 if kind in ['create','settings'] and footer else None
 if kind in ['create','settings'] and cutoff is None:
  raise ValueError(f'別検証する保存帯がありません: {kind}')
 if cutoff is not None:
  checks=[r for r in footer_checks if r['kind']==kind]
  required={(w,h) for w in [1152,1280,1440,1920] for h in [1000,900]}
  if {(r['width'],r['height']) for r in checks}!=required or any(r['issues'] for r in checks):
   unmatched.append('共通StickyBarの4幅×2高さの別検証が未合格')
 def record(label,a,b):
  if cutoff is not None and not label.startswith('shell-board/'):
   original={'name':label,'implementation':a,'reference':b}
   if a['top']>=cutoff and b['top']>=cutoff:
    excluded.append({**original,'reason':'保存帯または本文の可視範囲より下'});return
   if a['bottom']>cutoff or b['bottom']>cutoff:
    excluded.append({**original,'reason':'保存帯のための領域に入る下辺だけを除外'})
    a={**a,'bottom':min(a['bottom'],cutoff)};b={**b,'bottom':min(b['bottom'],cutoff)}
  delta={edge:round(a[edge]-b[edge],2) for edge in ['left','top','right','bottom']}
  measurements.append({'name':label,'implementation':a,'reference':b,'delta':delta,'over4px':max(map(abs,delta.values()))>4})
 used=defaultdict(int)
 for region,name in [('shell-board','白い板'), *regions[kind]]:
  if region=='footer' and cutoff is not None:
   excluded.append({'name':region+'/'+name,'reason':'古い絵の帯を共通StickyBarの別検証に置換'});continue
  candidates=[b for b in impl['boxes'] if b['region']==region]
  refs=[b for b in ref['boxes'] if b['name']==name]
  if kind=='create' and region=='footer' and not refs:
   refs=[b for b in ref['boxes'] if '帯' in (b['name'] or '') and ('保存' in b['name'] or '追従' in b['name'])]
  index=used[region];used[region]+=1
  if len(candidates)<=index or not refs:
   unmatched.append(f'段がありません: {kind}/{region}/{name}')
   continue
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
  if im.size!=(1440,1000):raise ValueError(f'1440×1000の画像ではありません: {kind}/{mode}')
  draw=ImageDraw.Draw(im)
  for r in data['texts']:
   if r['width']>0 and r['height']>0:
    draw.rectangle([math.floor(r['x']),math.floor(r['y']),math.ceil(r['x']+r['width']),math.ceil(r['y']+r['height'])],fill=(160,160,160))
  if cutoff is not None:
   draw.rectangle([board['left'],cutoff,board['right'],1000],fill=(240,240,240))
  im.save(output/f'template-{kind}-{mode}-masked.png');images.append(im)
 if images[0].size!=images[1].size:raise ValueError('画像サイズが違います')
 overlay=Image.blend(images[1],images[0],.5)
 overlay.save(output/f'template-{kind}.png')
 diff=ImageChops.difference(*images)
 diff.save(output/f'template-{kind}-diff.png')
 a=np.asarray(images[0]).astype(np.int16);b=np.asarray(images[1]).astype(np.int16)
 count=sum(m['over4px'] for m in measurements)
 summary[kind]={'over4px':count,'compared':len(measurements),'status':'PASS' if count==0 and not unmatched else 'CONTINUE','unmatchedRegions':unmatched,'maxEdgeDelta':max(max(map(abs,m['delta'].values())) for m in measurements),'pixelDifferenceOver24':int((np.abs(a-b).max(axis=2)>24).sum()),'excludedArea':{'left':board['left'],'top':cutoff,'right':board['right'],'bottom':1000} if cutoff is not None else None,'excludedMeasurements':excluded,'footerValidationRequired':cutoff is not None,'measurements':measurements}
 (output/f'template-{kind}.json').write_text(json.dumps(summary[kind],ensure_ascii=False,indent=2)+'\n')
 print(kind, summary[kind]['status'], f'{count}/{len(measurements)} 箇所が4px超', f'未比較の段 {len(unmatched)}')
(output/'template-summary.json').write_text(json.dumps({k:{a:v for a,v in d.items() if a!='measurements'} for k,d in summary.items()},ensure_ascii=False,indent=2)+'\n')
