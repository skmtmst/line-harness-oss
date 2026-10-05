import re
from pathlib import Path
from collections import Counter
import sys
base=Path(sys.argv[1])
# Published route classification takes precedence over name-based inheritance.
routes={};kind=None
for line in (base/'SCREEN-TYPES.md').read_text().splitlines():
 if line.startswith('### '):
  kind=next((v for k,v in [('作成','CreatePage'),('一覧','ListPage'),('詳細','DetailPage'),('設定','SettingsPage'),('分析','AnalyticsPage'),('手順','CreatePage'),('ダッシュ','DashboardPage')] if k in line),None)
 elif kind:
  for route in re.findall(r'`(/[^`]*)`',line):routes[route]=kind
routes['/chats']='InboxPage';routes['/booking/bookings']='ListPage';routes['/ops/dashboard']='DashboardPage'
handover={}
for line in (base/'HANDOVER-MAP.md').read_text().splitlines():
 cells=[x.strip() for x in line.split('|')[1:-1]]
 if len(cells)>=5 and cells[4].startswith('/'):
  route=cells[4].split('（')[0].split('?')[0].strip();handover[cells[1].strip('`')]=(route,cells[3])
rows=[]
for line in (base/'BOARD-INDEX.md').read_text().splitlines():
 cells=[x.strip() for x in line.split('|')[1:-1]]
 if len(cells)!=4 or not cells[1].startswith('`'):continue
 doc,id,name,shot=cells;id=id.strip('`');route,state=handover.get(id,('', ''))
 note='中身を差し込む。実装済みの印ではない'
 if name.startswith('LIFF'):
  assigned='対象外：LIFF専用型';note='お客さま用の小さい画面。管理画面の外側を付けない'
 elif not name:
  assigned='対象外：無題の構造板';note='画面名のない板。既存の絵を残す'
 elif any(w in name for w in ['ログイン','パスワード','登録確認','メール認証','2要素認証']):
  assigned='対象外：認証専用型';note='認証用の外側を維持する'
 elif any(w in name for w in ['の決まり','部品','仕上げ','物差し','状態の決まり','画面の地図','型の追加','外側と5つの型','改善案','移す順']):
  assigned='対象外：設計・部品の説明板';note='型を説明する板。画面ではない'
 elif doc == 'V8' and id in ['fy5dz','gzkXs','CRtK8']:
  assigned='対象外：共通部品';note='管理画面の板ではなく、単体部品'
 elif route in routes:assigned=routes[route];note='正本 SCREEN-TYPES のルート分類'
 elif '受信箱' in name:assigned='InboxPage'
 elif 'ダッシュボード' in name:assigned='DashboardPage'
 elif any(w in name for w in ['分析','結果','集計','30日のまとめ','流入経路の内訳']):assigned='AnalyticsPage'
 elif any(w in name for w in ['作る','作成','編集','を追加','を招待','を登録','申し込み','ひな形を作','を取り込','を起票','同意','店舗の基本情報']):assigned='CreatePage'
 elif any(w in name for w in ['一覧','ライブラリ','監査ログ','ログインユーザー','メンバー管理','テンプレート','友だち属性','タグ','対応マーク','友だち情報欄','保存した検索']):assigned='ListPage'
 elif any(w in name for w in ['設定','勤務','統括の情報','利用規約']):assigned='SettingsPage'
 elif any(w in name for w in ['詳細','記事','の日記','アカウントの設定','健康日記','マイル','残りの状況','注文']):assigned='DetailPage'
 else:assigned='ListPage';note='一覧・記録を扱う型。小窓はその上に重ねる'
 if id=='JKjsE':assigned='ListPage';note='統括アカウントの一覧（代表）'
 if id=='d8X09':assigned='DashboardPage';note='今回載せ替えた代表'
 if id=='I1E7Bt':assigned='ListPage';note='今回載せ替えた代表（フォルダあり）'
 if any(w in name for w in ['確認','小窓','引き出し','競合','閲覧のみ','権限なし','状態','を停止','アーカイブ','から戻す']):note+='。小窓・状態は親の型を維持し、専用の外側を増やさない'
 rows.append((doc,id,name or '（無題）',route or '—',assigned,note))
# 名前だけでは一覧に誤分類される編集・分析・設定の板を明示する。
reviewed = {
 'sFwWf':'CreatePage', 'WOPjZ':'CreatePage', 'i7Zkz':'SettingsPage',
 'iLJmw':'SettingsPage', 'SrmVs':'AnalyticsPage', 'JUTGz':'SettingsPage',
 'x2dSNv':'CreatePage', 'Msb1j':'CreatePage', 'xLpnS':'SettingsPage',
 'g3iDs':'SettingsPage', 'u8xibp':'CreatePage', 'sDXNy':'CreatePage',
 'yRDwW':'CreatePage', 'oqSJP':'SettingsPage', 'w5pwG':'CreatePage',
 'VWNaA':'CreatePage', 'LPOe7':'CreatePage', 'Q0Jrk':'CreatePage',
 'pvimJ':'CreatePage', 'E7iAYs':'CreatePage', 'XCUNf':'CreatePage',
 'Omqd4':'SettingsPage', 'ziSgL':'DetailPage', 'h7A2F':'DetailPage',
 'eLjeQ':'CreatePage', 'YXrF6':'CreatePage', 'rm92Y':'CreatePage',
 'hQQlt':'SettingsPage', 'nGcY1':'SettingsPage', 'zQ5vY':'AnalyticsPage',
 'ralAc':'SettingsPage', 'DxAAA':'SettingsPage', 'd7qtY':'CreatePage',
 'DA0Ag':'DetailPage', 'UkZLi':'DetailPage', 'Eo56k':'AnalyticsPage',
 'XjOte':'SettingsPage', 'FDBsG':'SettingsPage', 'ZxKL5':'CreatePage',
 'qSTVR':'SettingsPage', 'qw80E':'SettingsPage', 'OhguS':'DetailPage',
 'UcBQ5':'CreatePage', 'p03ImY':'CreatePage', 'ukPgd':'CreatePage',
 'BHEl9':'CreatePage', 'Izau1':'CreatePage', 'eSXxA':'CreatePage',
 'tVaUh':'CreatePage', 'OHwbU':'SettingsPage', 'EA8rM':'SettingsPage',
}
rows=[(*row[:4],reviewed[row[1]],'画面名と役割で編集・分析・設定を補正。小窓は親の型に重ねる') if row[1] in reviewed else row for row in rows]
# 索引の全行が一度ずつ存在することを確認する。
assert len({(row[0], row[1]) for row in rows}) == len(rows)
counts=Counter(row[4] for row in rows)
out=['# V8 全板への型の割り当て','',f'正本：BOARD-INDEX.md の全{len(rows)}板（2026-10-05）。この表は次のレーンの載せ替え先を示す。画面の動作・API・採用状態は HANDOVER-MAP のまま。','', '今回の載せ替えは d8X09 と I1E7Bt の2画面だけ。認証・LIFF・無題の構造板・設計説明板には管理画面の7型を直接適用しない。小窓は親の型に重ねる。予約のカレンダー・カード格子・料金カードは型の children に入れ、専用の中身を維持する。','', '| 型 | 板数 |','|---|---|']+[f'| {k} | {v} |' for k,v in counts.items()]+['','| 文書 | 板ID | 板の名前 | ルート | 割り当て | 扱い |','|---|---|---|---|---|---|']+['| '+' | '.join(row)+' |' for row in rows]
Path('design/v8/TEMPLATE-MAP.md').write_text('\n'.join(out)+'\n')
print(len(rows),dict(counts))
