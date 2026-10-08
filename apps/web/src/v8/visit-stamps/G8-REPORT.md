# G-8 来店スタンプ・引き継ぎ

この回はタブと記録の配置を実装。G-8 全体は未完了、見た目の合格は未判定。

## 実装した範囲

- 共通のタブでカードの設定／紙のカードの移行／押した・使った記録を切り替える。`?tab=settings|paper|history` で直接開ける。切り替えで履歴を増やさず、友だちなどの指定を残す。
- 設定の下書きはタブを移っても保持。保存の帯は設定だけに置く。押せる店と店員の暗証番号は①の「…」へ移した。
- 紙のカードの確認待ちだけを数の札に出す。未取得は数を出さない。承認・却下で読み直す。
- 記録の左に表と共通のページ送り、右に店で手入力。10・20・50件を選べる。遅れて届いた古い返事を無視し、総数が減ってページがなくなったら最後のページを読む。
- 閲覧のみには手入力欄と承認・却下を置かない。担当者の承認と手入力、管理者の保存と取り消しは保持。

## 板ごとの状況

| 板ID | 名前 | 直す前 | 直した後 | 左右の見比べ・残った違い |
| --- | --- | --- | --- | --- |
| fpPlW | G-8a カードの設定 | 未測定 | 未測定 | 1440・1152幅で撮影・目視。店頭QRと頭のQRボタンは未実装 |
| byCFU | G-8a2 紙のカードの移行 | 未測定 | 未測定 | 申請表だけを出す構成は実装。1440・1152幅で撮影・目視。頭のQRボタンはAPI待ち |
| NVN1Y | G-8a3 押した・使った記録 | 未測定 | 未測定 | 左に表・右に手入力を撮影・目視。狭い板では手入力を畳む。頭のQRボタンはAPI待ち |
| l3wpv | G-8b QRの個数 | 未測定 | 未測定 | QRの発行API待ち |
| pYdrv | G-8b′ 会計から個数 | 未測定 | 未測定 | QRの発行API待ち |
| g3ZlzR | G-8c QRを表示 | 未測定 | 未測定 | 発行・自動更新・失効API待ち |
| g1XcNR | G-8d 読まれた結果 | 未測定 | 未測定 | 使用結果の取得API待ち |
| PYDUP | G-8e 店頭QRを作り直す | 未測定 | 未測定 | 店頭QRの作り直しAPI待ち |
| t1LfZ | G-8f 印刷用の紙 | 未測定 | 未測定 | 店頭QRの取得API待ち |
| eSJ8v | G-8g LIFF・押せた | 未測定 | 未測定 | 読み取りAPI待ち |
| e9lZv | G-8h LIFF・間隔の制限 | 未測定 | 未測定 | 読み取りAPI・間隔の制限の改修待ち |
| xLyNh | G-8i LIFF・期限切れ／使用済み | 未測定 | 未測定 | 読み取りAPI待ち |
| ZhddO | G-8j LIFF・友だちでない | 未測定 | 未測定 | 読み取りAPI待ち |

G-8 の HTML・文字の座標表・撮影対応表は確認時点で未作成。`measure.sh stamp` に上の13板を指定し、すべて「URL なし」だった。旧板の点数は使わず、90%合格・合格台帳への記載はしていない。

## 実画面の確認

- 確認用APIで3タブを1440・1152・1920幅で開き、URLと開いたパネルが一致することを確認。9通りともページ幅の超過と右端へのはみ出しは0。
- 1440・1152幅の設定・移行・記録の画像を読み、外枠PNGと目で照合。タブ分割・保存帯の出し分け・記録と手入力の配置は確認した。QRを出すボタン・店頭QRの段は欠けている。余白・文字位置の90%判定は座標表待ち。
- 白い板が1100px未満のとき、手入力を共通型で畳む。開く操作と開閉状態の保持もブラウザーで確認。
- 撮影は見本データによる。実店舗での保存・送信・QR読取を行った証拠ではない。
- 画像と幅の点検記録：`test-results/stamp-g8/{settings,paper,history}-{1440,1152,1920}.jpg`、`history-1152-expanded.jpg`、`width-checks.json`（ローカルの無視対象として保持）。

## 共通部品・食い違い

- 共通Tabsに確認待ち件数の札、タブとパネルを結ぶIDを追加。件数が変わっても選択中の下線を合わせ直す。
- 共通DetailColumnsに、補助欄自体がカードである画面用の任意指定を追加。指定のない既存画面の表示は変えていない。
- 共通部品全体の見た目は変更していない。紙の表など、引き継いだ画面CSSの表の余白・行高の指定は残っており、G-8の座標表で測った後に共通型へ寄せる判断が必要。
- 絵どうしの矛盾は確認していない。新しいG-8の座標表と板別書き出しがないため、寸法の細かい照合は未実施。
- 店頭QRだけに間隔制限を効かせる変更は未適用。現行の説明とサーバの動きはG-1の共通制限のまま。API担当が変えた後、画面の説明もG-8へ合わせる。

## QR の依存事項

前回の依頼書 `~/lh-work/design/v8/codex-handoff/stamp-1009-resume.md` は、必要なDB表・列を「作らずに止めて報告」としている。使い捨てQR用の `visit_stamp_qr_tokens` 表は追加承認と番号待ち。今回もDBを変更していない。

必要なAPI案（未実装）：

- `GET /api/visit-stamps/cards/:id/store-qr`：店頭QRを取得。
- `POST /api/visit-stamps/cards/:id/store-qr/rotate`：作り直し、古いQRを失効。
- `POST /api/visit-stamps/cards/:id/qr-tokens`：店員QRを発行。
- `GET /api/visit-stamps/qr-tokens/:id`：使用結果を取得。
- `POST /api/liff/visit-stamps/cards/:id/qr/consume`：読み取り・押印。

オーナー決定（2026-10-09）を次のAPI実装へ引き継ぐ：

- Aの店頭QRは「制限しない」でも同じ日は1回。日本時間の0時で戻す。
- 間隔の制限はAだけに効かせ、Bと店で手入力には効かせない。現在のサーバには手入力にも制限するG-1の処理が残っており、改修が必要。
- Bは30秒で自動更新し、古いQRは失効。閉じるまで更新を繰り返す。前回案の有効60秒は採用しない。

## 司令塔へ

- 合格台帳へはまだ記録しない。QRのDB承認・API実装と座標表がそろってから続きを行う。
- Pencil・親リポジトリ・DBを変更していない。push・PR・統合・配備は行わない。
- 要件と恒久ルールへの追記案は、上のオーナー決定の3項目。保護された文書は司令塔の正規経路で更新する。
- PR採番後の反映履歴案：「来店スタンプの設定・紙のカードの移行・記録をタブで切り替え、記録の横から手入力できるようにした」。担当は `@kenta`、PR番号と実際の日本時間を付ける。

## 取り込みと検証

- 開始時の未コミット変更は同じstamp担当の前回分として引き継いだ。
- `origin/codex/development` の `ec03047312b7240dfb8c6ac6b60acd77a86747b3` を取り込み。競合なし。引き継ぎ差分を保持してマージした。
- doctor：合格。最終の型検査：成功。ビルド（197ページの生成と書き出し）：成功。ビルド後の設計値検査：456/456一致、合格。差分検査：成功。
- CSSの基準更新は来店スタンプ1ファイルだけ。余白7→8、高さ4→6。元のHEADでも既に8・6であり、今回のCSS変更で直書きは増えていない。古い基準を現状へ合わせ、無関係な再生成差分は含めていない。
- 触った範囲：`app/globals.css`、`components/shared/tabs{.tsx,.module.css,-v8-indicator.react.test.tsx}`、`components/templates/{detail-columns.tsx,page-templates.module.css}`、`lib/{design-impact.test.ts,screen-css-budget-baseline.json}`、`v8/visit-stamps/{visit-stamps.tsx,visit-stamps.module.css,visit-stamps.test.tsx,BEHAVIOR.md,G8-REPORT.md}`（すべて `apps/web/src/` 以下）。共通Paginationの利用先一覧にも来店スタンプを追加。
- 動きの試験は削除せず、タブで開いた後に操作するよう更新。タブURL、下書き保持、権限、待ち件数の再取得、店舗切替の古い返事、ページ送り、キーボード操作、手入力欄の開閉を追加。
- 動き・共通部品・画面の境界・CSS基準・設計影響の試験：8ファイル、51件すべて成功。初回は店舗切替の試験用データが指定と違う友だちIDを返してタイムアウト。実APIと同じく指定IDを返すデータへ直し、全51件を再確認して成功。
- 実行：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm exec vitest run src/v8/visit-stamps src/app/visit-stamps src/components/shared/tabs-v8-indicator.react.test.tsx src/components/templates/page-templates.test.tsx src/v8/v8-boundary.test.ts src/lib/screen-css-budget.test.ts src/lib/direct-values.test.ts src/lib/design-impact.test.ts --maxWorkers=1`。
- この報告を含むコミットのSHAは最終報告で渡す。

