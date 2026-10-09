# rgoog 画面レーンの引き継ぎ（2026-10-09）

対象: 飲食店 Googleビジネス / 予約サイト・グルメ媒体 / SNS連携の9板。実装とコミットまで。push・PR・DB更新・配備は行わない。

## 測定と左右の見比べ

直す前は、同じrgoogの前回作業の未コミット差分を引き継いだ時点。90%は見つかった文字の位置が±4pxで一致する割合であり、画素全体の一致率ではない。担当名rgoogでmeasure.shを実行。正本は10-08更新のpencil-texts。合格台帳への登録は司令塔が行う。

| 板 | 名前 | 前 | 後 | 左右の見比べ |
| --- | --- | ---: | ---: | --- |
| j0Wcg | 口コミ | 98% | 100% | 座標OK。HTMLの行の高さと座標表に差。予約数は未取得表示 |
| JUTGz | プロフィール | 93% | 100% | 座標OK。HTMLの情報行の高さと座標表に差。カテゴリは未取得表示 |
| Cfed0 | 投稿一覧 | 100% | 100% | 座標OK。絞り込み操作は維持。札の形は共通部品側の統合待ち |
| T1j2Sw | 投稿を作る | 100% | 100% | 座標OK。入力の赤枠・理由・移動を確認。特典の非対応操作は権限/種類で制御 |
| x9HIR | 返信を作る | 100% | 100% | 座標OK。外部送信無効の見本では確認ボタンを隠す |
| SrmVs | パフォーマンス | 97% | 97% | 単位「回」の1箇所が右へ7px。HTMLの情報行の高さと座標表に差 |
| CuHXG | Google設定 | 100% | 100% | 座標OK。HTMLの情報行の高さと座標表に差。接続解除の確認を維持 |
| aSmph | 予約サイト・グルメ媒体 | 100% | 100% | 座標OK。外部サイトの空き枠を自動変更しない文言へ修正 |
| y3GGTs | SNS連携 | 93% | 100% | 座標OK。経路の札を共通部品へ。1152pxで右端を越えない |

全9板が撮影可能。1440pxの左右の画像を見比べ、1152pxの画面も確認。1152・1440・1920で9板を計27回確認し、SNSの表と予約媒体カード説明を修正後、1152pxを再確認した。画面右端越えは0。担当の9板には1152px固有のPencil座標表が無いため、この幅の一致率は計上しない。

測定画像・差分: ~/lh-work/design/v8/overlay/pages-rgoog/<板ID>-{design,impl,raw-overlay}.png、<板ID>-delta.md。
狭幅の確認: /tmp/rgoog-qa-1009/。型検査・試験・ビルドのログ: /tmp/rgoog-*-1009.log。

## 司令塔が判断する共通の差と絵の食い違い

- 見本HTMLと座標表の情報行の高さが違う（プロフィール/指標/設定: HTMLは53px、座標表は41px）。口コミもHTMLの行が大きい。座標表を正とし、HTMLやPencilは編集していない。
- 左メニューの順序、タグ、勤務・来店スタンプ、タブの下線位置、札の形は本線の最新共通部品を使用。HTMLに残る旧共通枠との差はこのレーンで変更していない。
- 共通ヘッダーの操作領域に4px、HelpTipの領域に6pxの内部幅超過が計測される（画面右端越えなし）。KPIのHelpTip付き見出しも6px。既定値の変更は禁止なので共通担当へ渡す。
- 1152pxの口コミの検証環境帯では、共通BoundaryBannerの説明領域が約95px不足する。共通の枠を直す必要があり、このレーンでは既定の見た目を変更していない。
- プロフィールの「早く閉める」「ほかの項目」、投稿の絞り込み、同期・再読込・エラー操作は既存機能として残した。
- プロフィールの営業時間編集・変更確認・変更履歴・プロフィール編集は担当の9板に絵が無く、既存の画面への入口を維持。追加の板が必要。

## API側へ渡すもの

- Google経由の予約件数、料理の写真の閲覧数、プロフィールのカテゴリ・ラストオーダー時刻を返す口が不足。「料理の注文」を写真閲覧、「通常営業時間」をカテゴリとして代用しない。
- SNSの月間投稿数・次回投稿予定、Instagramの実接続が未実装。今はAPIが返す要確認投稿数と未対応の説明を表示。
- 予約媒体の文言は「他の予約サイトの空き枠は自動で変更しない」。LINE内の予約在庫は卓を単位にするオーナー決定と区別した。予約枠の休業・貸切や既存予約への連絡のAPIはこのレーンの変更対象外。

## 実装・試験

自前のカード、表セル、フォーム欄、返信本文、ページ送りの件数、日時、数のマス、画像の選択、保存帯を共通部品/型に寄せた。必要な口だけ追加し、未指定の共通部品の見た目は維持した。プロフィールは閲覧のみの変更操作を隠す。

投稿・媒体の入力不足は各欄の赤枠と理由、最初の誤りへのfocus/scrollIntoViewで表示。通信/保存失敗は帯で示し、入力を残す。画像送信中は保存/確認を止める。

- V6のgoogle-business-v6-contract.test.tsを削除: 旧ノードID・自前の枠を固定する試験。保存・画像送信・期間変更・受信日時・AI・権限の動作試験はV8へ移して維持。
- 入力/閲覧権限を意図的に壊す確認で3件が失敗することを確認し、元へ戻した。
- 最新origin/codex/developmentをテスト前に取り込み、検証の土台を5545d30ef5として記録。初回指定の列車枝は取り込み済み。
- 前回差分を適用する際の競合はcard.tsx/css、text-field.tsx/css、corrections.md。最新のCard.variant・TextArea.compact・入力のアクセシビリティとrgoogの指定を両方残した。
- 反映履歴はunreleased/rgoog-kenta-google-media-sns.mdに下書き済み。司令塔がPRを作るときに実際の番号を本文とファイル名に追加する（番号を推測しない）。

検証結果: 182ファイル・1,299試験すべて成功。型検査、Next.jsビルド、差分検査成功。verify:designは456件一致・不一致0で合格。ビルドには既存のlint警告が残る。

## 変更ファイル

- `apps/web/design/design-impact-baseline.txt`
- `apps/web/src/app/restaurant-test/google/google-business-v6-contract.test.ts`
- `apps/web/src/app/restaurant-test/google/google-performance-react.test.tsx`
- `apps/web/src/app/restaurant-test/google/google-posts-upload-react.test.tsx`
- `apps/web/src/app/restaurant-test/google/google-review-received-at.test.ts`
- `apps/web/src/components/shared/button.module.css`
- `apps/web/src/components/shared/button.tsx`
- `apps/web/src/components/shared/card.module.css`
- `apps/web/src/components/shared/card.tsx`
- `apps/web/src/components/shared/chip.module.css`
- `apps/web/src/components/shared/chip.tsx`
- `apps/web/src/components/shared/data-table.module.css`
- `apps/web/src/components/shared/date-field.module.css`
- `apps/web/src/components/shared/date-time-field.tsx`
- `apps/web/src/components/shared/form-controls.module.css`
- `apps/web/src/components/shared/form-controls.tsx`
- `apps/web/src/components/shared/kpi-band-contract.test.tsx`
- `apps/web/src/components/shared/kpi-band.tsx`
- `apps/web/src/components/shared/kpi-card.module.css`
- `apps/web/src/components/shared/notice.module.css`
- `apps/web/src/components/shared/notice.tsx`
- `apps/web/src/components/shared/row-actions.module.css`
- `apps/web/src/components/shared/row-actions.tsx`
- `apps/web/src/components/shared/section-header.module.css`
- `apps/web/src/components/shared/section-header.tsx`
- `apps/web/src/components/shared/table.tsx`
- `apps/web/src/components/shared/tabs.module.css`
- `apps/web/src/components/shared/tabs.tsx`
- `apps/web/src/components/shared/text-field.module.css`
- `apps/web/src/components/shared/text-field.tsx`
- `apps/web/src/components/templates/page-frame.tsx`
- `apps/web/src/v8/restaurant/google/BEHAVIOR.md`
- `apps/web/src/v8/restaurant/google/google-parts.test.tsx`
- `apps/web/src/v8/restaurant/google/google.module.css`
- `apps/web/src/v8/restaurant/google/google.tsx`
- `apps/web/src/v8/restaurant/google/performance.tsx`
- `apps/web/src/v8/restaurant/google/posts.tsx`
- `apps/web/src/v8/restaurant/google/profile.tsx`
- `apps/web/src/v8/restaurant/google/reviews.tsx`
- `apps/web/src/v8/restaurant/google/settings.tsx`
- `apps/web/src/v8/settings/booking-media/BEHAVIOR.md`
- `apps/web/src/v8/settings/booking-media/screen.module.css`
- `apps/web/src/v8/settings/booking-media/screen.tsx`
- `apps/web/src/v8/settings/sns/sns.module.css`
- `apps/web/src/v8/settings/sns/sns.tsx`
- `docs/brain/rules/corrections.md`

- `docs/release-log/unreleased/rgoog-kenta-google-media-sns.md`
- `docs/rgoog-screen-handoff-2026-10-09.md`

## 内容別のコミット

- 18c691d925: 共通部品の口（既定値は維持）
- 923d1ada51: Googleビジネス7画面・動作試験・旧V6見た目試験の整理
- 7a232241cb: 予約サイト・グルメ媒体
- 08b88f5e36: SNS連携
- 本文と反映履歴の下書きは、これらに続く文書コミットに含む。

次のタスク: 司令塔が絵/共通枠の差を確認し、本線へ取り込んで撮り直す。PRを採番したら反映履歴へ番号を入れる。API不足はAPIレーンへ渡す。作業役はpush・PR・配備を行わない。
