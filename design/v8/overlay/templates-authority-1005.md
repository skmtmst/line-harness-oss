## 司令塔の判断（正本の扱い・最優先・2026-10-05 04時）
1. 書き出しの HTML の content-box（11か所）は Pencil の書き出しの癖で、絵の意図ではない。Pencil の枠は幅に余白と枠を含む（border-box）。正本 HTML を開くときに * { box-sizing: border-box !important } を足して描くのは『補正』ではなく Pencil の決まりどおりに描くこと。これで I1E7Bt・bx1eN・R2ojn の板 1188・右欄 300・フォルダ 200 になるはず。なったらその値を正とする。
2. 保存の帯は、オーナー決定（作成・編集の下の帯は常に画面の下に追従、キャンセル・保存は中央、削除は左端）が正。共通の StickyBar が正本。R2ojn の右寄せ 60px の帯と、iychL に帯が無いのは絵が古い。比べるとき帯の部分は StickyBar の部品の合格（parts-check）で代え、帯の範囲は重ねの比べから外してよい（外した範囲を記録する）。
3. 設定の欄 Cu78y は最大 720 に直して書き出し直した（components-x6BDY.html）。
4. 上の3つで 4px 超 0 になれば ALL_PASS にしてよい。

# V8 の画面の『型』を共通にする（司令塔 Claude・1005-0116・最優先・早めに）
オーナー（2026-10-05）：『パターンができたら全部に当てはめなくてもよくなる』。画面を1枚ずつ合わせるのではなく、絵の画面の型を共通の型にし、各画面は型に中身を入れるだけにする。
## 正本
- 型の絵：/Users/kentakenta/lh-work/design/v8/html/components-NbomF.html（★V8 外側と5つの型：ダッシュボード・一覧・作る・詳細・受信箱）と components-x6BDY.html（設定型・分析型）。外側の部品 /Users/kentakenta/lh-work/design/v8/parts/zUg8S.html。
- 各型の代表の板（例）：ダッシュボード d8X09、一覧（フォルダの列あり）は友だち属性のタグ・テンプレート、作る・詳細・受信箱 M0393、統括のアカウント JKjsE。板の絵は design/v8/html/<板ID>.html、見本の画像は design/v8/owner-*.png。
## やること（作業場所 /Users/kentakenta/lh-work/lh-templates・枝 codex/codex-v8-page-templates）
1. apps/web/src/components/templates/ に型を作る：DashboardPage・ListPage（左にフォルダの列ありなし・上に数の帯・道具の1段・表やカード・ページ送り）・CreatePage（下に追従する帯）・DetailPage・InboxPage・SettingsPage（左の内側の目次）・AnalyticsPage。各型は『板の頭（題・？・右の操作）』『段の並び』『段と段の間』『板の内側の余白』を絵の数値どおりに持つ。中に入れる物は props と子で受け取る。V8 だけ（[data-theme="v8"]）。
2. 型ごとに確認ページ apps/web/src/app/v8-templates/page.tsx を作り、型の絵（NbomF・x6BDY）と重ねて同じになるか確かめる（同じ 1440 幅で撮り、半分透かして重ねた画像と差の画像を design/v8/overlay/template-<型>.png に。文字の中身は塗りに置き換えて比べる）。外形のずれ 4px 超 0。
3. 代表の画面2つ（ダッシュボード d8X09 と 友だち属性のタグ一覧）だけ、型に載せ替えて見本にする（ほかの画面は別のレーンが型を使って載せ替える）。
4. 型の使い方を docs/specs/v8-page-templates.md に1枚（どの画面がどの型か・props・やってはいけないこと：型の外で箱・余白を手で書かない）
- 共通部品（components/shared）は別レーンが絵どおりに作り直し中。型は共通部品を使うだけで、部品の中身は直さない。
- 試験：触った所の vitest（NEXT_PUBLIC_API_URL=http://worker.test）・tsc・git diff --check。型ごとにコミット。反映履歴 docs/release-log/unreleased/codex-v8-page-templates-codex.md（見出しは追加・変更・修正、#PR番号 は書かない）
- push・マージ・rebase・stash・force push・Slack 投稿はしない。docs/brain・docs/v6-* は触らない
- 終わったら、型の一覧と、どの画面がどの型か（BOARD-INDEX の全板に型を割り当てた表を design/v8/TEMPLATE-MAP.md に）を日本語で報告
