# rinv：飲食店の予約枠・在庫と座席・卓（2026-10-09）

担当の9枚を共通部品へ移し、文字位置の照合は9/9枚が90%以上。左右の画像と重ねた画像を確認した。API未対応と絵の書き出しの食い違いが残るため、司令塔の目視受け入れ・PASSED登録は別途必要。

作業場所：`~/lh-work/lh-pages-rinv`。枝：`codex/kenta-v8-s-rinv-10090106`。コミットまで。push・PR・統合・DB更新・配備は実施していない。

検証済みのコード：`b945daf226`。最終測定は`fed6a3a646`にこの狭い幅の差分を加えた状態で実施し、その差分を同コミットへ確定した。

## 板ごとの結果

「前」は今回引き継いだrinvの途中変更を含む最初の測定。「後」は修正・本線取り込み後。割合は、絵と実装の両方で見つかった文字のうち±4pxに入った割合であり、未対応の機能まで完成したことを示さない。

| 板ID | 名前 | 前 | 後 | 左右で見比べた結果 |
| --- | --- | ---: | ---: | --- |
| Y8SjT2 | 予約枠・在庫 | 93% | 93% | 表の行高はTSVに合わせた。HTMLとの食い違い、未対応のルールタブ、時刻欄の位置差が残る |
| qf3ky | 予約枠・在庫：競合 | 93% | 93% | 競合の帯・操作を確認。上記の共通差が残る |
| Yyw6i | 媒体を閉じる知らせの窓 | 93% | 93% | 入力・操作の切れなし。絵の自動停止・LINE通知に対応するAPIがなく説明が異なる |
| hQQlt | 予約経路の連携 | 95% | 98% | 取消・競合件数と送信元などがAPI未対応。HTMLとTSVで行高が異なる |
| UVnvR | 休業日・貸切 | 94% | 94% | カレンダー・知らせ・操作を確認。店舗選択の追加、タブ位置の差が残る |
| YMVFD | 他サイトの枠を閉じる知らせ | 100% | 100% | 予約名・人数・経路がAPI未対応。狭い幅では経路列を畳んで見出しの重なりを解消。媒体の札は札ごとに次の行へ送る |
| BERxg | 座席・卓管理 | 100% | 100% | 卓の印・詳細・操作を確認。HTMLとTSVでカード見出し・行高が異なる |
| gBrCz | 卓を追加・変更 | 99% | 99% | 入力・操作を確認。共通ダイアログの題が5px上。配置・結合の既存操作を残した |
| eY9F3 | 卓を止める確認 | 95% | 95% | 既存予約と移動・停止を確認。見本の予約4件により後続欄が21px下。LINE通知はAPI未対応 |

撮れなかった板：なし（9/9枚）。

## 画像・幅の確認

- 正式測定：`zsh ~/lh-work/tools/hq/measure.sh rinv Y8SjT2,qf3ky,Yyw6i,hQQlt,UVnvR,YMVFD,BERxg,gBrCz,eY9F3`。停止確認の予約だけ、下記の撮影用mapを`MEASURE_MAP`に指定した。
- 各板の設計・実装・重ねた画像・文字位置差：`~/lh-work/design/v8/overlay/pages-rinv/<板ID>-{design.png,impl.png,overlay.png,delta.md}`。
- 1152pxの9枚も目視確認。1152・1440・1920pxの27状態を調べ、文書全体の横はみ出し・右端越え・短い文字の途中改行・実行エラーなし。見出し同士の重なりも確認した。
- 右の卓欄は白い板が1100px未満で畳む。「この時間帯の卓を見る」「卓の詳細を見る」で開ける。閉鎖日一覧は狭い幅で下に並べる。
- 撮影用ファイル：作業場所の`test-results/rinv/`（既存の除外設定に従いGit管理外）。`responsive.json`、1152pxの画像、撮影スクリプトとmapを残した。
- 本線の見本時計が10月1日に固定され、停止確認の「これからの予約」を再現できなくなるため、API応答の予約日時を撮影日の東京の暦へ同じ日数だけ移した。APIの形・状態・IDと画面の未来予約判定は維持した。製品・共有の見本道具・Pencilは変更していない。

## 絵・共通部品で司令塔の判断が必要なもの

1. 10月8日23時のHTMLと文字座標TSVで、在庫の行高が約53px対35px、予約経路が約72px対54px、卓カード見出しの高さも異なる。文字位置の正本であるTSVに実装を合わせたため、HTMLとの重ね画像には行の位置差が残る。再書き出し元の照合が必要。
2. 共通の時刻欄は終了時刻の文字が約5px左、ダイアログの題は約5px上。共通部品の既定の見た目を変えて他画面へ影響させる修正はしていない。
3. 未対応の「自動で合わせるルール」タブを置いていないため、休業日・貸切タブが156px左。休業画面の上部タブは絵より約5px上。店舗選択・在庫の日付選択は既存の動作のため残した。
4. 左メニューの項目・並び、パンくずの段数は共通の外側の差。画面側では変更していない。
5. 共通上部バー内の通知ボタン等は内部の幅が36対40px、操作欄244対248px。ヘルプ印も16対22pxの内部幅を検出する。文書の横はみ出し・画面右端越えは発生していないが、共通担当で確認が必要。

## APIが必要なもの

- 在庫の自動調整ルール（F24）。タブだけのダミーは置いていない。
- 媒体を閉じる窓のLINE枠・当日枠の自動停止、閉鎖記録の保存、責任者へのLINE通知。今は窓のチェック記録のみで、外部サイトを書き換えたり通知したりしないことを説明する。
- 予約経路の当日の取消反映数・重なった予約数、予約メールの送信元、経路行の追加メニュー。取れない件数を0で補っていない。
- 枠を閉じる知らせと予約の結び付け（名前・人数・入った経路）。今あるAPIの単位は枠×媒体なので、枠の日時を表示し、経路は「—」。経路での検索・絞り込みは偽装していない。
- 席が空いた知らせの再開済み記録。対応APIがなく、「もう開けてよい」行へ閉鎖操作を出していない。
- 卓の移動・停止時のお客さまへのLINE通知。通知の切り替えは出さず、この画面からは送られないことを説明する。

## 変更内容と確認

- 自前のカード・卓表示・数の帯・表・空状態・通知・入力部品を共通部品へ置き換えた。部品の既定は維持し、必要な指定口だけ追加した。
- 在庫と卓の入口はV8だけにした。担当外の共通テーマは変更していない。動作の試験は削除していない。
- 在庫・卓・臨時休業・手動取り込みの入力誤りは欄を赤くし、理由を1行出し、最初の誤りへフォーカスとスクロールする。上の帯へ重複して出さない。
- 予約移動が失敗したら卓を停止せず、窓と入力内容を保って理由を表示する。
- 店舗の在庫時刻・受信日時・卓の予約日時は、海外の端末でも店舗の地域で表示する。
- 24:00を閉店時刻として使える。24:30は受け付けない。未指定の共通時刻欄は従来どおり0〜23時。
- 型検査：合格。ビルド：合格。`verify:design`：456/456一致。デザイン負債・直書き・画面CSS・寸法・V8境界の検査：合格。基準ファイルを緩めていない。
- Vitest：220ファイル・1,389件合格。飲食店、入口、共通部品、型、上記の見張りを含む。
- 入力検証・停止成功時だけ閉じる処理・24:00制限・店舗の地域指定を一時的に外すと、追加した試験が失敗することを確認し、戻して合格した。
- 自分の撮影サーバーは`measure.sh --stop rinv`で停止した。
- 差分検査：合格。作業ツリーの既存差分はrinvの前回作業として引き継いだ。親リポジトリ・Worker・DB・Pencilは変更していない。

## 本線取り込みとコミット

開始時：`git fetch origin`、`git merge --no-edit origin/codex/kenta-train-2-10082334`（取り込み済み）。rebase・stash・forceは使用していない。

試験前に取得・取り込んだ開発本線：`5545d30ef51f8a43623a7ed4475a1a5dacedf029`。最後の取り直しでも同じSHA。

| SHA | 内容 |
| --- | --- |
| 79c17ffd94 | 飲食店に必要な共通部品の指定口 |
| 68f8469d48 | 在庫・媒体連携・休業・知らせ |
| a6a0748364 | 卓・入力検証・予約移動失敗の表示 |
| 2c48c609f8 | 最新の開発本線取り込み・競合解消 |
| fed6a3a646 | 店舗の地域による時刻表示 |
| b945daf226 | 狭い幅の列見出しと媒体名の切れを解消 |

競合を解いたファイル：`shared/card.tsx`・`card.module.css`、`check-card.tsx`、`time-field-v8.tsx`、`templates/detail-columns.tsx`・`page-templates.module.css`（いずれも`apps/web/src/components/`以下）。本線のカード種別・入力エラー属性・日本語入力対応・補助欄設定を残し、飲食店用の指定口を併存させた。

司令塔の次の作業は、残差と未対応APIの扱いを確認して受け入れ、統合とPASSED登録を判断すること。PR作成時には実際のPR番号・担当・日本時間を記載した更新履歴を追加する。

## 変更ファイル

- `apps/web/src/app/restaurant-test/inventory/page.tsx`
- `apps/web/src/app/restaurant-test/tables/page.tsx`
- `apps/web/src/components/shared/button.module.css`
- `apps/web/src/components/shared/button.tsx`
- `apps/web/src/components/shared/card.module.css`
- `apps/web/src/components/shared/card.tsx`
- `apps/web/src/components/shared/check-card.module.css`
- `apps/web/src/components/shared/check-card.tsx`
- `apps/web/src/components/shared/data-table.module.css`
- `apps/web/src/components/shared/kpi-card.module.css`
- `apps/web/src/components/shared/kpi-card.tsx`
- `apps/web/src/components/shared/notice.module.css`
- `apps/web/src/components/shared/notice.tsx`
- `apps/web/src/components/shared/seat-tile.module.css`
- `apps/web/src/components/shared/seat-tile.tsx`
- `apps/web/src/components/shared/table.tsx`
- `apps/web/src/components/shared/time-field-v8.test.tsx`
- `apps/web/src/components/shared/time-field-v8.tsx`
- `apps/web/src/components/templates/detail-columns.tsx`
- `apps/web/src/components/templates/page-frame.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/v8/restaurant/booking-kit/parts.tsx`
- `apps/web/src/v8/restaurant/booking-kit/shell.module.css`
- `apps/web/src/v8/restaurant/booking-kit/shell.tsx`
- `apps/web/src/v8/restaurant/close-tasks/close-tasks.module.css`
- `apps/web/src/v8/restaurant/close-tasks/close-tasks.tsx`
- `apps/web/src/v8/restaurant/closures/closure-dialog.tsx`
- `apps/web/src/v8/restaurant/closures/closures.tsx`
- `apps/web/src/v8/restaurant/inventory/BEHAVIOR.md`
- `apps/web/src/v8/restaurant/inventory/channels.tsx`
- `apps/web/src/v8/restaurant/inventory/format.test.ts`
- `apps/web/src/v8/restaurant/inventory/format.ts`
- `apps/web/src/v8/restaurant/inventory/inventory.module.css`
- `apps/web/src/v8/restaurant/inventory/inventory.test.tsx`
- `apps/web/src/v8/restaurant/inventory/inventory.tsx`
- `apps/web/src/v8/restaurant/inventory/stock.tsx`
- `apps/web/src/v8/restaurant/tables/BEHAVIOR.md`
- `apps/web/src/v8/restaurant/tables/move.ts`
- `apps/web/src/v8/restaurant/tables/tables.module.css`
- `apps/web/src/v8/restaurant/tables/tables.test.tsx`
- `apps/web/src/v8/restaurant/tables/tables.tsx`
- `docs/v8-rinv-screen-report-2026-10-09.md`（この報告）
