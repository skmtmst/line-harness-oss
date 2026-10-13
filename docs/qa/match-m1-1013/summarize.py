from pathlib import Path
import json,csv,collections,datetime,hashlib
P=Path(__file__).parent
cases=json.loads((P/'cases.json').read_text());by={}; rounds=['first','retry','final-retry']
for name in rounds:
 p=P/f'{name}-results.json'
 if p.exists():
  for r in json.loads(p.read_text()):by[r['board'],r['width']]=r
keys=[f'F{i}' for i in range(1,11)]
widths=[1440,1152,1920]
clean=lambda v:str(v if v is not None and str(v).strip() else '—').replace('\t',' ').replace('\r',' ').replace('\n',' ')
def write(name,rows):
 with (P/name).open('w') as f:
  for row in rows:f.write('\t'.join(map(clean,row))+'\n')
summary=collections.defaultdict(collections.Counter);families=collections.defaultdict(collections.Counter);rows=[];openrows=[];counts=[];clusters=collections.defaultdict(set)
for c in cases:
 rr=[by.get((c['board'],w)) for w in widths];good=[r for r in rr if r and r.get('measured')]
 complete=len(good)==3 and all(all(r.get('counts',{}).get(k) is not None for k in keys) for r in good)
 types=sorted({k for r in good for k in keys if (r.get('counts',{}).get(k) or 0)>0},key=lambda x:int(x[1:]))
 category='測れない' if not complete else '最初から0' if not types else '指摘1〜3種' if len(types)<=3 else '多い'
 summary[c['group']][category]+=1;families[c['family']][category]+=1
 reason=' / '.join(dict.fromkeys(r.get('error','') for r in rr if r and r.get('error')))
 if not reason and not complete:reason='未完了' if not good else '検出器の範囲不足：未取得は—'
 reasonType='—'
 if not complete:
  if c.get('blocked'):reasonType=c['blocked'].split('：')[0]
  elif 'HTTP 404' in reason:reasonType='開く口が無い'
  elif any(x in reason for x in ['データ','候補','ひも付け']):reasonType='見本のデータが無い'
  else:reasonType='状態が要る'
 if c.get('reasonType') and not complete:reasonType=c['reasonType'];reason=c.get('diagnosis',reason)
 reach=sum(bool(r and r.get('reached')) for r in rr);parent=sum(bool(r and r.get('parentOpened')) for r in rr)
 rows.append([c['board'],c['group'],c['family'],c['name'],c['route'],parent,reach,len(good),category,','.join(types) or '—',reasonType,reason])
 actions=' → '.join(c['clicks']) or 'URLで開く'
 openrows.append([c['board'],c['group'],c['name'],c['route'],actions,c.get('expectedText') or ('窓・メニューの実表示' if c['requireOverlay'] else 'URLの画面と内容'),parent,reach,len(good),reasonType,reason,c.get('source',''),','.join(r.get('screenshot','') for r in rr if r),good[0]['sha'] if good else (rr[0]['sha'] if rr[0] else '—')])
 for w,r in zip(widths,rr):
  counts.append([c['board'],c['group'],c['family'],c['route'],w,bool(r and r.get('reached')),bool(r and r.get('measured')),r.get('scope') if r else None,*[r.get('counts',{}).get(k) if r and r.get('measured') else None for k in keys],len(r.get('layout',{}).get('failures',[])) if r and r.get('layout') else None,r.get('overflow') if r else None,len(r.get('errors',[])) if r else None,len(r.get('writes',[])) if r else None,r.get('error') if r else '未着手',r.get('sha') if r else None,r.get('time') if r else None])
  if r and r.get('measured') and complete:
   for hit in r.get('findings',[]):clusters[hit['pattern'],hit.get('reason',''),hit.get('detector','DOM')].add(c['board'])
write('BOARD-COUNT.tsv',[['board','group','family','name','route','parentOpenedWidths','reachedWidths','measuredWidths','category','positiveTypes','reasonType','reason'],*rows])
write('OPEN-HOW.tsv',[['board','group','name','url','how','stateCheck','parentOpenedWidths','reachedWidths','measuredWidths','reasonType','reason','source','screenshots','sha'],*openrows])
write('COUNTS.tsv',[['board','group','family','route','width','reached','measured','scope',*keys,'layout','overflow','pageErrors','blockedWrites','reason','sha','time'],*counts])
write('CAUSE-BUNDLES.tsv',[['pattern','reason','detector','boards','boardCount'],*[[*k,','.join(sorted(v)),len(v)] for k,v in sorted(clusters.items(),key=lambda x:-len(x[1]))]])
columns=['最初から0','指摘1〜3種','多い','測れない'];now=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M JST')
lines=['# M組：最初の160枚の数','',f'集計: {now}。コードは9613559dcb、本線から切った開始版を固定。画面修正なし。','', '| 仲間 | 枚数 | 最初から0 | 指摘1〜3種 | 多い（4種以上） | 測れない |','|---|---:|---:|---:|---:|---:|']
for g,cs in summary.items():lines.append('| '+g+' | '+str(sum(cs.values()))+' | '+' | '.join(str(cs[k]) for k in columns)+' |')
tot=collections.Counter();[tot.update(x) for x in summary.values()]
lines.append('| 合計 | 160 | '+' | '.join(str(tot[k]) for k in columns)+' |')
lines+=['','- 「最初から0」は3幅すべてで指定状態へ到達し、今回の機械検査の対象でF1〜F10が0だった板。正式な合格ではない。色・意味・全操作の目視と、ソース候補の精査は次の段階。','- 「測れない」は3幅がそろわない板と型の測定範囲が足りない板を含む。部分的に得た数はCOUNTS.tsvに残し、欠測を0へ変えていない。','- 指摘は既存検出器の検出数。1要素が複数の検出器に当たる場合がある。誤検出の判断も含めて次の回で原因を確認する。','- 測定範囲不足は開ける板の欠測。開けない理由の4種類と混同しない。', '- ソース監査の候補は実表示の確定欠陥と別のsource-by-board.jsonへ保存。親から到達する全タブのimport候補であり、現在の板の欠陥へ足していない。','', '仲間の細分:','', '| 同じ作り | 枚数 | 最初から0 | 指摘1〜3種 | 多い | 測れない |','|---|---:|---:|---:|---:|---:|']
for g,cs in sorted(families.items(),key=lambda x:-sum(x[1].values())):lines.append('| '+g+' | '+str(sum(cs.values()))+' | '+' | '.join(str(cs[k]) for k in columns)+' |')
lines+=['','成果物: [開き方](OPEN-HOW.tsv)・[160枚の一覧](BOARD-COUNT.tsv)・[板×型×3幅](COUNTS.tsv)・[原因の束](CAUSE-BUNDLES.tsv)・[版の証拠](EVIDENCE.json)。画像と生の計測はこのM1フォルダへ保存。','', '今の進捗を全体像から整理するとこれ：M組160枚について開き方・測定結果・欠測理由を記録した初回調査。公式全体の合格枚数は更新していない。','次のタスクはこれ：測れない板の入口・状態・測定範囲を解消し、原因の束を共通部品の持ち主F/L/Gへ渡す。今回の続きの修正は次の回。']
(P/'FIRST-COUNT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'counts':dict(summary),'rows':len(by),'complete':sum(r[8]!='測れない' for r in rows)},ensure_ascii=False))
