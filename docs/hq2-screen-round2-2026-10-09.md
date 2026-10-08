# 統括画面 hq2・2周目の報告（2026-10-09）

今の進捗を全体像から整理するとこれ：指定30枚をすべて撮影・測定し、20枚が90%以上。90%未満の10枚は、別の絵・採用済みの新しい画面との違いを残した。合格台帳は司令塔が判定する。

次のタスクはこれ：C1〜C5の正本を司令塔が決め、座標表・HTMLをそろえた後に残る板を再測定する。

## 板ごとの測定と左右比較

| 板ID | 名前 | 直す前 | 直した後 | 左右の見比べ |
| --- | --- | ---: | ---: | --- |
| AnwtH | 画像を取り込む | 99% | 99% | OK |
| B24oNg | 一覧から外す確認 | 59% | 97% | C4 |
| B9ZAr | バナーのプロジェクト一覧 | 98% | 98% | OK |
| BHEl9 | 権限を変更 | 86% | 95% | OK |
| D6fh3 | 運営のLINEを登録 | 100% | 100% | OK |
| HMpVx | アカウントの設定 | 37% | 37% | C1 |
| I0w2e | アーカイブ確認 | 59% | 97% | C4 |
| JB8V1 | 請求 | 100% | 100% | OK |
| JKjsE | アカウント一覧 | 100% | 100% | OK |
| K7HYu | 統括の情報 | 59% | 100% | OK |
| LRc93 | テンプレート一覧 | 5% | 5% | C3 |
| LRc93FA | タグの代用板 | 0% | 0% | C3 |
| LRc93RM | リッチメニューの代用板 | 0% | 0% | C3 |
| LRc93FS | 回答フォームの代用板 | 0% | 0% | C3 |
| M4jS9 | 権限を変える確認 | 96% | 96% | OK |
| OhguS | お問い合わせのやり取り | 100% | 100% | OK |
| UcBQ5 | 参照画像を選ぶ | 59% | 98% | C4 |
| VtJQ6 | 代理ログイン・閲覧のみ | 32% | 32% | C1 |
| W5Wxr | 画像ライブラリ | 99% | 99% | OK |
| W7Z57 | プロジェクトを作る | 96% | 96% | OK |
| X4JcOf | ひな形を作る | 未撮影 | 0% | C3 |
| b8xBtZ | お問い合わせ | 100% | 100% | OK |
| iMnph | プロジェクトの中 | 59% | 97% | C4 |
| meBRB | アカウントへ配る | 未撮影 | 7% | C3 |
| p03ImY | 画像の生成中 | 0%※ | 97% | C4 |
| r4ARpV | メンバー | 100% | 100% | OK |
| rI5uh | 画像の詳細 | 59% | 92% | C4・C5 |
| yLKwV | 権限者を招待 | 60% | 60% | C2 |
| zOpMG | 生成の上限に達した | 59% | 92% | C4 |
| p17Qku | 統括の一括配信を作る | 未撮影 | 0% | C3 |

OKは画像・本文・件数などのデータ差を除いた目視結果。初回は共有対応表の条件で測定した。BHEl9は対象メンバー、X4JcOf・meBRBは現在の押し口、バナーは入力とAPI応答を修正した。率の改善にはCSS調整と撮影条件の修正の両方を含む。※p03ImYの初回0%は別ページを撮っていたため、比較の基準としては使えない。

## 90%未満で残った板と理由

- **HMpVx（37%）、VtJQ6（32%）：C1。** JKjsE（100%）と同じホームを背景にするが、検索・絞り込み・カード内の数の位置が違う。JKjsEは検索y257・絞り込みy301、HMpVxはy277・y321。カード下段の差はさらに大きい。VtJQ6は代理ログイン帯も現行の固定ヘッダーと異なる。閲覧のみの操作は規定どおり隠す。窓を開いたときだけ背景を別配置にはしない。
- **yLKwV（60%）：C2。** r4ARpV（100%）・BHEl9（95%）と同じ表のはずが、招待の板だけ列位置が違う。メール／役割／範囲／状態／ログインのxは618／822／936／1100／1194、通常の板は654／892／986／1110／1204。
- **LRc93（5%）、LRc93FA・LRc93RM・LRc93FS（各0%）、X4JcOf（0%）、meBRB（7%）：C3。** `src/v8/hq-templates/BEHAVIOR.md`の「新しい統括の板」「G-3」「G-4」は10月8日の採用済み画面を正本とする。一覧はi0Ao0R・DzdC3・noVq4・wZPua、作成は店と共通の種類別編集、配布はフォルダ付きの選択と確認。古いLRc93の代用一覧や旧一体型編集へ戻すと採用済みの動きを失う。
- **p17Qku（0%）：C3。** 現行は`src/v8/hq-broadcasts/BEHAVIOR.md`に定めた5段階の共通作成画面。旧提案の1枚には戻さない。

## 90%以上でも残る絵の違い

- **C4（バナー7状態）：** プロジェクト内のパンくずは、共通部品に統括用の任意設定を追加して緑のリンクと文字の区切りへ合わせた。下の帯は既に承認されたqIp42／X2oLnの72px・寸法札・左右余白に従う現行部品と、指定板の92px・文字だけの寸法案が異なる。帯を別の形にするか、指定板を承認済みの帯へそろえるかを司令塔が判断する。
- **C5（rI5uh）：** 2、3行目のチェック欄にHTML側だけ「この1週間に送った人を除く」が入り、名前が174px右へずれる。画像を渡す機能に意味の違う除外条件は足していない。条件表はTSVの文字位置に合わせると30／48pxの行、HTMLはpadding込みで約42／60pxとなり、下の操作位置が約60px違う。TSVとHTMLをそろえる必要がある。タグの順・アカウント数・画像・本文は見本データ差。
- 左メニュー等の全画面共通の外側は、他レーンの採用済み変更を保ち、このレーンでは変更していない。

## 撮影・共通部品・API

- 撮れなかった板：**なし**。初回未撮影のX4JcOf・meBRB・p17Qkuも撮影した。
- 1440px：30枚を測定し、実装と絵を左右に比較。1152px：24の代表状態を撮影し、文書の横はみ出し・表の横スクロールはすべて0。
- 共通部品は任意propだけを追加し、既定の見た目を保った。Fieldの必須文字表示、RadioCardのバナー用文字、SegmentedControlの均等幅、Breadcrumbの緑のリンクと文字の区切り。ReferencePickerDialogも統括だけの配置を選ぶ。
- 共通部品修正後の代表板：WQmep46%→46%、x6QsVz98%→98%、I1E7Bt99%→99%、LRc935%→5%。このレーンによる数値の悪化なし。WQmepの修正は担当外。
- API・DB・Workerの変更：**なし**。追加APIが必要な値は代用しない。新しい統括一覧のAPI待ちは既存BEHAVIORの記載を維持した。

## 変更と試験

- HQの入口をV8に統一し、V7の画面本体とテンプレートの旧汎用分岐を除去。保存・配布・応答不明・権限・版の衝突・添付の後片付けの試験をV8の操作に移した。
- 会社・連絡先、会社名、メンバー、アカウント名の入力誤りは、欄の赤枠・理由・focus／scrollで知らせる。同じ欄の誤りを上の帯に重ねない。
- タグ・フォームの保存結果が不明な間は名前と説明を固定表示し、同じ依頼の再確認だけを許す。タグの未受付確定後の案内も引き継ぐ。
- バナーは入力ラベル・サイズの箱・テキスト行・色・生成枚数・利用量の寸法を合わせ、参照選択と確認・詳細の窓の余白を修正。
- 削除した見た目試験：message-card-authoringのV7専用1件、export-size-chipのV7配置1件。V7の5段階ステッパー／data-label固定は新しい選択・配布POSTの確認に置換。V8のカード・カルーセルを保存する試験は残した。
- CSS直書きの基準はHQの3ファイルだけを更新。共通Buttonの利用先一覧は削除した旧HQ入口8件だけを除外。Paginationは描かれなくなった旧HQ一覧1件だけを除外。未保存の見張りはV8側の契約を保つ。

## 再測定

```sh
mkdir -p .measure
node scripts/visual-qa/hq2-measure-map.mjs ~/lh-work/lh-spacing/scripts/visual-qa-stable/v8-design-map.json > .measure/hq2-map.json
MEASURE_MAP="$PWD/.measure/hq2-map.json" zsh ~/lh-work/tools/hq/measure.sh hq2 <板ID,板ID,…>
zsh ~/lh-work/tools/hq/measure.sh --stop hq2
```

- 計測出力：`~/lh-work/design/v8/overlay/pages-hq2/`のdelta・impl・design・overlay。1152pxとテストJSONはこの作業場所の`.measure/`（ローカル検証用、Git対象外）。
- 土台：`ec03047312b7240dfb8c6ac6b60acd77a86747b3`。開始時と最終試験前にfetch／merge済み。競合解消なし。delta内の`9f55cb66b`は道具側の版で、この作業場所の版ではない。measure.sh末尾の土台SHAとこのブランチのコミットを参照する。
- push・PR・統合・DB更新・配備は行わない。自分の測定サーバーhq2だけ停止した。

## 反映履歴の候補

PR番号は司令塔が採番後に入れ、所定の反映履歴ファイルへ移す。時刻はこのレーンの作業時点の日本時間。

- 統括の入力欄とバナー生成の見た目を整え、統括の画面を新しいデザインに統一した @kenta #PR番号 2026-10-09 03:05

## 最終検証

- Vitest：83ファイル・467件すべて合格（失敗0）。HQ・バナー・テンプレート・一括配信・触った共通部品・CSS制限・影響先・入力と未保存の見張りを含む。
- TypeScript：`pnpm exec tsc --noEmit` 合格。
- Next.js：`NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web build` 合格。既存のlint警告あり。
- 設計値：`pnpm --filter web verify:design` 456件一致・不一致0。
- `git diff --check` 合格。検証結果を理由に未整理ファイルを削除したりstashしたりしていない。
- 30枚の再測定、左右の画像比較、代表4枚の共通部品への影響確認、1152pxで24状態の横はみ出し確認を実施。

## 変更ファイル（77件）

```text
.gitignore
apps/web/design/design-impact-baseline.txt
apps/web/src/app/hq/account-create-entry.test.ts
apps/web/src/app/hq/banners/banners-shape.test.tsx
apps/web/src/app/hq/banners/banners.test.ts
apps/web/src/app/hq/banners/page.tsx
apps/web/src/app/hq/banners/project/page.tsx
apps/web/src/app/hq/billing/billing-failure-m023m024.test.ts
apps/web/src/app/hq/billing/billing.test.ts
apps/web/src/app/hq/billing/page.tsx
apps/web/src/app/hq/form-submissions/page.tsx
apps/web/src/app/hq/friend-attributes/page.tsx
apps/web/src/app/hq/hq-account-title-react.test.tsx
apps/web/src/app/hq/hq-console.test.ts
apps/web/src/app/hq/hq-load-m021.test.ts
apps/web/src/app/hq/hq-template-page.tsx
apps/web/src/app/hq/hq-unavailable-react.test.tsx
apps/web/src/app/hq/hq-unavailable.test.ts
apps/web/src/app/hq/members/hq-account.test.ts
apps/web/src/app/hq/members/hq-members-change-confirm-react.test.tsx
apps/web/src/app/hq/members/members-failure-m026.test.ts
apps/web/src/app/hq/members/members-restricted-m025.test.tsx
apps/web/src/app/hq/members/page.tsx
apps/web/src/app/hq/page.tsx
apps/web/src/app/hq/rich-menus/page.tsx
apps/web/src/app/hq/settings/page.tsx
apps/web/src/app/hq/support/detail/hq-support-detail-broken-shape-react.test.tsx
apps/web/src/app/hq/support/detail/hq-support-detail-react.test.tsx
apps/web/src/app/hq/support/detail/hq-support-detail-reply-guidance-react.test.tsx
apps/web/src/app/hq/support/detail/page.tsx
apps/web/src/app/hq/support/detail/u099-missing-id-contract.test.ts
apps/web/src/app/hq/support/hq-support-attachment-input.test.tsx
apps/web/src/app/hq/support/hq-support-broken-shape-react.test.tsx
apps/web/src/app/hq/support/hq-support-suspended-react.test.tsx
apps/web/src/app/hq/support/hq-support-v8.test.tsx
apps/web/src/app/hq/support/page.tsx
apps/web/src/app/hq/support/support-failure-m027.test.ts
apps/web/src/app/hq/templates/message-card-authoring.test.tsx
apps/web/src/app/hq/templates/page.tsx
apps/web/src/app/hq/templates/template-console-continue.test.tsx
apps/web/src/app/hq/templates/template-console-references.test.tsx
apps/web/src/app/hq/templates/template-console-v8.test.tsx
apps/web/src/app/hq/templates/template-console.test.tsx
apps/web/src/app/hq/templates/template-console.tsx
apps/web/src/app/hq/templates/template-definition-editor.tsx
apps/web/src/app/hq/templates/template-media-cleanup.test.tsx
apps/web/src/app/hq/templates/template-message-v8.test.tsx
apps/web/src/app/hq/u042-mobile-row-actions-contract.test.ts
apps/web/src/app/unsaved-guard-wiring-contract.test.ts
apps/web/src/components/hq/banners/export-size-chip.test.tsx
apps/web/src/components/hq/banners/generation-panel.module.css
apps/web/src/components/hq/banners/generation-panel.tsx
apps/web/src/components/hq/banners/reference-picker-dialog.module.css
apps/web/src/components/hq/banners/reference-picker-dialog.tsx
apps/web/src/components/shared/breadcrumb.module.css
apps/web/src/components/shared/breadcrumb.tsx
apps/web/src/components/shared/form-controls.tsx
apps/web/src/components/shared/radio-card.module.css
apps/web/src/components/shared/radio-card.tsx
apps/web/src/components/shared/segmented.module.css
apps/web/src/components/shared/segmented.tsx
apps/web/src/lib/design-impact.test.ts
apps/web/src/lib/screen-css-budget-baseline.json
apps/web/src/v8/hq-banners/frame.module.css
apps/web/src/v8/hq-banners/image-detail.module.css
apps/web/src/v8/hq-banners/project.tsx
apps/web/src/v8/hq-templates/BEHAVIOR.md
apps/web/src/v8/hq-templates/console.tsx
apps/web/src/v8/hq/BEHAVIOR.md
apps/web/src/v8/hq/account-dialogs.module.css
apps/web/src/v8/hq/account-dialogs.tsx
apps/web/src/v8/hq/company-contact.test.tsx
apps/web/src/v8/hq/company-contact.tsx
apps/web/src/v8/hq/member-dialog.tsx
apps/web/src/v8/hq/settings.tsx
docs/hq2-screen-round2-2026-10-09.md
scripts/visual-qa/hq2-measure-map.mjs
```
