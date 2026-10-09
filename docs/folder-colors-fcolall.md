# V8 フォルダの色（fcolall・2026-10-09）

## 対応した一覧

- 店：タグ、友だち情報欄、テンプレート、リッチメニュー、回答フォーム、一斉配信、シナリオ、リマインダ、自動応答、友だち追加時の配信、登録メディア、共通情報、自動化ルール、共通アクション、イベント、Webhook の送り先、ウェビナー。
- 統括：タグ、テンプレート（全種類のタブ）、リッチメニュー、回答フォーム、シナリオのひな形、一括配信、友だち情報欄のひな形。
- 共通：作ったフォルダは色の丸。「すべて」は墨色のトレー、「未分類」は灰色の開いたフォルダ。名前と色を横に並べ、9色と色なしを選べる。保存失敗は窓内に出して入力を保つ。閲覧のみには追加・色の変更を出さない。
- 既存の保存色は変更するまで保持する。一般フォルダとタグの既存の自由な色値を、9色以外という理由で置き換えない。
- API・DB に色がない場合は操作を出さない。DB migration は作成・適用していない。

## DB に欄がなくて止めた一覧

| 画面／対象 | 表 | 足す欄の案 | 今回の扱い |
|---|---|---|---|
| 流入経路のフォルダ | `entry_route_genres` | `color TEXT NULL`（NULL または #RRGGBB の制約） | 名前の変更だけを維持し、色の変更を隠す。採番・追加はオーナー承認待ち |
| マイレージの使い道フォルダ | `mileage_reward_folders` | `color TEXT NULL`（NULL または #RRGGBB の制約） | 現在の V8 列は固定の種類で、この表の作成済みフォルダを表示していない。色欄の追加と実フォルダへの接続は保留 |

## 列の全件確認で対象外としたもの

- 統括のアカウントと配布先選択のアカウントのフォルダ：hqcard の担当。画面・API・DB は触っていない。
- マイレージの「たまる決めごと」、アフィリエイトの案件・アフィリエイター、バナー生成の「見る」：種類・状態から決まる固定分類で、作ったフォルダではない。
- 成果地点：フォルダ管理の API がなく、「すべて」だけ。
- 予約一覧の「メニュー」：予約メニューによる絞り込みで、フォルダではない。
- 実際に使われている V8 は `src/v8` と `app/reminders/list-v8.tsx` を調査。旧画面ファイルも検索したが、入口から参照されない重複版の配線は変更していない。

## 保存先と検証

- 色を持つ既存表：一般フォルダ・タグ分類 `folders`（タグ分類の API も kind=tag の同じ表を読み書きする）、統括分類 `hq_template_folders`、統括配信 `hq_broadcast_folders`、友だち追加配信 `friend_add_rule_folders`。
- これらの API は色を受け取り・返す実装済み。今回 API の口は追加していない。一般フォルダ更新の TypeScript 型へ `color` を明示し、統括・友だち追加の既存色検査に使う共有パレットを6色から9色へ拡張。
- Web：共通メニュー・9色・閲覧のみ・保存失敗・再試行、統括各ひな形で色を保存、代表の統括一括配信で変更後に読み直して保持。
- Worker：実 HTTP と SQLite を通して統括分類・統括配信・友だち追加の9色を変更し、GET の色を確認。所属・古い版・閲覧のみ・不正値の拒否も維持。
- 故障の検知：統括の色を送らない変更を一時的に入れると5種類のひな形の試験が失敗。元に戻すと22件すべて合格。
- 最終結果：Web 98ファイル・552件、Worker 3ファイル・21件合格。web の型検査・build・verify:design 合格。
- 試験の基準 SHA：`5545d30ef51f8a43623a7ed4475a1a5dacedf029`。
- 撮影：LRc93（統括テンプレート）、apLqS（リマインダ）、MRhef（友だち追加配信）。画面全体の設計一致は本作業の合格として登録していない。最終撮影の文字位置は MRhef 100%、LEwkJ 94%、GrnO4 98%。左右比較では本線側の行高・左メニューなどの差もあるため、画面全体の見た目の合格とはしない。画像と測定結果は `~/lh-work/design/v8/overlay/pages-fcolall/`。

## 司令塔への引き継ぎ

コミット後は司令塔が統合・PR・検証配備を担当。PR 番号は推測しない。PR 採番後に `docs/release-log/unreleased/<PR番号>-kenta-folder-colors.md` を作り、次の行へ実番号を入れる。

試験後に共有の `origin/codex/development` が21コミット進んだ。司令塔は上記の試験基準 SHA と最新本線の差を取り込み、影響する試験・型検査・build・差分検査をやり直してから統合する。

```markdown
## 変更
- 店と統括のフォルダの色を作ったあとにも変えられ、読み直しても残るようにした @kenta #<PR番号> 2026-10-09 10:40
```

DB の色欄追加は別の承認・migration 採番が必要。本作業では DB 更新・push・PR・配備を実施しない。

## 代表の撮影結果

| 板 | 画面 | 最初の文字位置 | 最後の文字位置 | 目で見た結果 |
|---|---|---|---|---|
| MRhef | 友だち追加時の配信 | 96% | 100% | 丸と名前の位置を確認。既存の行高・データ・左メニューの差は残る |
| LEwkJ | 友だち追加時の配信・閲覧のみ | — | 94% | 追加・色変更の操作がないことを確認。既存の行高等の差は残る |
| GrnO4 | 回答フォーム・1152 | — | 98% | 名前の前の色、折り返し・重なりなしを確認。既存の行高等の差は残る |
| apLqS | リマインダ | 77% | 未再計測 | フォルダの丸を確認。主な残差は行高とデータ |
| LRc93 | 統括テンプレート | 5% | 未再計測 | フォルダの丸を確認。全体の骨格・帯・配置が現行の絵と異なる |

この数値は画面全体の見た目の合格を意味しない。Pencil・合格台帳は変更していない。取り込み競合はなかった。

## 変更ファイル

- `apps/web/src/app/reminders/list-v8.tsx`
- `apps/web/src/components/shared/folder-add-dialog.tsx`
- `apps/web/src/components/shared/folder-editor-dialog.react.test.tsx`
- `apps/web/src/components/shared/folder-editor-dialog.tsx`
- `apps/web/src/components/shared/folder-panel-icons.react.test.tsx`
- `apps/web/src/components/shared/folder-panel.module.css`
- `apps/web/src/components/shared/folder-panel.tsx`
- `apps/web/src/components/shared/folder-row-actions.test.tsx`
- `apps/web/src/components/shared/folder-select.react.test.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/v8/automations/common-actions.tsx`
- `apps/web/src/v8/contents/list.tsx`
- `apps/web/src/v8/forms/BEHAVIOR.md`
- `apps/web/src/v8/forms/list.tsx`
- `apps/web/src/v8/friend-add/BEHAVIOR.md`
- `apps/web/src/v8/friend-add/list.tsx`
- `apps/web/src/v8/hq-broadcasts/list-detail.test.tsx`
- `apps/web/src/v8/hq-broadcasts/list.tsx`
- `apps/web/src/v8/hq-templates/BEHAVIOR.md`
- `apps/web/src/v8/hq-templates/attributes.test.tsx`
- `apps/web/src/v8/hq-templates/attributes.tsx`
- `apps/web/src/v8/hq-templates/console.tsx`
- `apps/web/src/v8/hq-templates/store-list.test.tsx`
- `apps/web/src/v8/hq-templates/store-list.tsx`
- `apps/web/src/v8/inflow-links/list.tsx`
- `apps/web/src/v8/tags/tags-tab.tsx`
- `apps/web/src/v8/webhooks/outgoing.tsx`
- `apps/web/src/v8/webinars/BEHAVIOR.md`
- `apps/web/src/v8/webinars/list.tsx`
- `apps/worker/src/routes/folder-colors.test.ts`
- `docs/brain/rules/corrections.md`
- `packages/shared/src/folder-colors.ts`
- `docs/folder-colors-fcolall.md`
