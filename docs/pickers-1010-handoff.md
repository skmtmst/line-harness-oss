# 選ぶ窓の共通化（B-155・163・164・165・175）

## 範囲

- 作業枝: `codex/kenta-pickers-1010`。検証の基点: `5c2829221153a90e35a269e92b647ba9378ee8cc`。
- 受信箱の幅640の器を EntityPickerDialog に移し、単数・複数・受信箱が同じ器を使う。
- 132ファイルの200呼び出しを移行（EntitySelect 182、EntityRemoteField 8、FriendPickerField 3、EntityPickerField 1、独自窓6）。種類を切り替える1呼び出しが複数のID入力を置き換えるため、元の調査の数え方とは異なる。
- 条件・一覧の絞り込みも対象。少数の固定値・フォルダ列の折り畳み・重複友だちの二者比較は維持。非表示のV7専用分岐は今回の対象外。
- 欄全体で開き、確定するまで保存値を変えない。複数選択の札は窓を開かずに外せる。
- 任意の選択を空へ戻す操作を22か所で維持。作成先が定義された種類は下の文字リンクを出し、閲覧のみでは隠す。
- 既存の権限・アカウント境界・確認操作・送信処理を保つ。読み込み失敗の再取得、古いアカウントの応答の無視、友だち検索のページ送りも共通部品へまとめる。

## 見張り

`node apps/web/scripts/verify-entity-pickers.mjs` を必須PRゲートで実行。実際の画面入口から参照をたどり、Select・Combobox・MultiSelect・ネイティブselectのID候補を検出する。別名import・options変数・選択肢を返すヘルパーも検査。

## 移行した呼び出し

| ファイル | 追加した共通選択部品の数 |
|---|---|
| `apps/web/src/app/accounts/uid-migration-v8.tsx` | EntitySelect 2 |
| `apps/web/src/app/analytics/reports/new/page.tsx` | EntitySelect 2 |
| `apps/web/src/app/auto-replies/edit/wizard-v8.tsx` | EntitySelect 1 |
| `apps/web/src/app/booking/bookings/detail/page.tsx` | EntitySelect 2 |
| `apps/web/src/app/booking/bookings/new/page.tsx` | EntitySelect 2 |
| `apps/web/src/app/booking/bookings/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/booking/menus/new/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/booking/staff/staff-edit-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/app/chats/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/common-actions/branch-editor.tsx` | EntitySelect 2 |
| `apps/web/src/app/contents/media-replacement-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/app/contents/vars/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/emergency/control-v8.tsx` | EntitySelect 1 |
| `apps/web/src/app/emergency/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/events/bookings/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/health/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/hq/templates/template-definition-editor.tsx` | EntitySelect 1 |
| `apps/web/src/app/inflow-links/_components/edit-route-modal.tsx` | EntitySelect 4 |
| `apps/web/src/app/inflow-links/ad-integration.tsx` | EntitySelect 1 |
| `apps/web/src/app/nen-campaigns/columns/new/column-new-v8.tsx` | EntitySelect 2 |
| `apps/web/src/app/nen-campaigns/edit/campaign-editor-v8.tsx` | EntitySelect 1 |
| `apps/web/src/app/nen-campaigns/nen-overview.tsx` | EntitySelect 1 |
| `apps/web/src/app/ops/support/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/rich-menus/edit/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/rich-menus/new/create-v8.tsx` | EntitySelect 1 |
| `apps/web/src/app/staff/new/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/staff/page.tsx` | EntitySelect 1 |
| `apps/web/src/app/templates/template-asset-editor.tsx` | EntitySelect 1 |
| `apps/web/src/app/users/users-v8.tsx` | EntitySelect 1 |
| `apps/web/src/app/webinars/edit/cta-v8.tsx` | EntitySelect 2 |
| `apps/web/src/components/auto-replies/inline-action-list.tsx` | EntitySelect 1 |
| `apps/web/src/components/auto-replies/inline-action-rows-v8.tsx` | EntitySelect 1 |
| `apps/web/src/components/automations/automation-draft-editor.tsx` | EntitySelect 4 |
| `apps/web/src/components/broadcasts/broadcast-approval.tsx` | EntitySelect 1 |
| `apps/web/src/components/broadcasts/broadcast-form.tsx` | EntitySelect 5, EntityPickerDialog 1 |
| `apps/web/src/components/chats/friend-info-sidebar.tsx` | EntitySelect 2 |
| `apps/web/src/components/chats/inbox-filter-panel.tsx` | EntitySelect 1 |
| `apps/web/src/components/chats/saved-view-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/components/dashboard/qr-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/components/events/event-form.tsx` | EntitySelect 2 |
| `apps/web/src/components/forms/action-editor.tsx` | EntitySelect 5 |
| `apps/web/src/components/forms/block-editor.tsx` | EntitySelect 4 |
| `apps/web/src/components/forms/choice-table.tsx` | EntitySelect 3 |
| `apps/web/src/components/forms/hq-form-definition-editor.tsx` | EntitySelect 1 |
| `apps/web/src/components/friend-fields/mark-list.tsx` | EntitySelect 1 |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx` | EntitySelect 1 |
| `apps/web/src/components/friends/advanced-search-dialog.tsx` | EntitySelect 2 |
| `apps/web/src/components/friends/bulk-operation-editor.tsx` | EntitySelect 1 |
| `apps/web/src/components/friends/saved-search-dialog.tsx` | EntityPickerDialog 1 |
| `apps/web/src/components/friends/single-friend-actions.tsx` | EntitySelect 1 |
| `apps/web/src/components/ops/notice-line-account-card.tsx` | EntitySelect 1 |
| `apps/web/src/components/rich-menus/apply-to-tag-modal.tsx` | EntitySelect 1 |
| `apps/web/src/components/rich-menus/area-properties.tsx` | EntitySelect 3 |
| `apps/web/src/components/rich-menus/rich-menu-create-form.tsx` | EntitySelect 1 |
| `apps/web/src/components/scenarios/action-editor.tsx` | EntitySelect 4 |
| `apps/web/src/components/scenarios/carousel-picker.tsx` | EntitySelect 1 |
| `apps/web/src/components/scenarios/question-editor.tsx` | EntitySelect 1 |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx` | EntitySelect 1 |
| `apps/web/src/components/shared/condition-builder.tsx` | EntitySelect 6, EntityRemoteField 1 |
| `apps/web/src/components/shared/entity-picker.tsx` | EntityPickerDialog 2 |
| `apps/web/src/components/support/email-thread.tsx` | EntitySelect 1 |
| `apps/web/src/components/templates/message-template-editor.tsx` | EntitySelect 2 |
| `apps/web/src/components/webinars/webinar-form.tsx` | EntitySelect 1 |
| `apps/web/src/v8/account-new/register.tsx` | EntitySelect 3 |
| `apps/web/src/v8/affiliates/create.tsx` | EntitySelect 1 |
| `apps/web/src/v8/affiliates/offer-form.tsx` | EntitySelect 1 |
| `apps/web/src/v8/analytics/cross.tsx` | EntitySelect 2 |
| `apps/web/src/v8/analytics/funnel-form.tsx` | EntitySelect 1, EntityRemoteField 1 |
| `apps/web/src/v8/analytics/funnel.tsx` | EntitySelect 1 |
| `apps/web/src/v8/automations/branch-editor.tsx` | EntitySelect 1 |
| `apps/web/src/v8/automations/common-action-new.tsx` | EntitySelect 1 |
| `apps/web/src/v8/automations/create/create.tsx` | EntityRemoteField 4, FriendPickerField 1 |
| `apps/web/src/v8/automations/create/friend-multi-select.tsx` | FriendPickerField 1 |
| `apps/web/src/v8/automations/list.tsx` | FriendPickerField 1 |
| `apps/web/src/v8/booking-menus/channels-tab.tsx` | EntitySelect 1 |
| `apps/web/src/v8/booking-menus/menu-form.tsx` | EntitySelect 2 |
| `apps/web/src/v8/booking-menus/staff-edit-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/v8/booking-staff/shifts.tsx` | EntitySelect 1 |
| `apps/web/src/v8/booking-staff/staff-new.tsx` | EntitySelect 2 |
| `apps/web/src/v8/broadcasts/quick-send.tsx` | EntitySelect 1 |
| `apps/web/src/v8/common-vars/list.tsx` | EntitySelect 1 |
| `apps/web/src/v8/contents/media-replacement-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/v8/conversions/list.tsx` | EntitySelect 1 |
| `apps/web/src/v8/dashboard/friend-add.tsx` | EntitySelect 1 |
| `apps/web/src/v8/events/bookings.tsx` | EntitySelect 1 |
| `apps/web/src/v8/form-edit/after-tab.tsx` | EntitySelect 1 |
| `apps/web/src/v8/form-edit/content-tab.tsx` | EntitySelect 1 |
| `apps/web/src/v8/friend-detail/dialogs.tsx` | EntitySelect 1 |
| `apps/web/src/v8/friends/list/list.tsx` | EntitySelect 3 |
| `apps/web/src/v8/friends/merged/merged.tsx` | EntitySelect 1 |
| `apps/web/src/v8/friends/migrations/csv.tsx` | EntitySelect 1 |
| `apps/web/src/v8/friends/migrations/uid.tsx` | EntitySelect 2 |
| `apps/web/src/v8/hq-banners/dialogs.tsx` | EntitySelect 1 |
| `apps/web/src/v8/hq-broadcasts/create.tsx` | EntitySelect 2 |
| `apps/web/src/v8/hq-broadcasts/detail.tsx` | EntitySelect 1 |
| `apps/web/src/v8/hq-templates/folder-distribution-dialog.tsx` | EntityPickerField 1 |
| `apps/web/src/v8/hq/account-dialogs.tsx` | EntitySelect 1 |
| `apps/web/src/v8/hq/member-dialog.tsx` | EntitySelect 1 |
| `apps/web/src/v8/inbox-chat/head-menus.tsx` | EntitySelect 1 |
| `apps/web/src/v8/inbox-chat/template-picker-view.tsx` | EntityPickerDialog 1 |
| `apps/web/src/v8/inflow-links/ad-history.tsx` | EntitySelect 1 |
| `apps/web/src/v8/inflow-links/ads.tsx` | EntitySelect 1 |
| `apps/web/src/v8/inflow-links/detail.tsx` | EntitySelect 1 |
| `apps/web/src/v8/inflow-links/edit-route-dialog.tsx` | EntitySelect 4 |
| `apps/web/src/v8/inflow-links/new/create.tsx` | EntitySelect 2 |
| `apps/web/src/v8/line-notifications/operator-edit.tsx` | EntitySelect 1 |
| `apps/web/src/v8/mileage/reward-edit.tsx` | EntitySelect 1 |
| `apps/web/src/v8/nen-campaigns/edit.tsx` | EntitySelect 1 |
| `apps/web/src/v8/nen-campaigns/list.tsx` | EntitySelect 1 |
| `apps/web/src/v8/nen-members/ranks.tsx` | EntitySelect 1 |
| `apps/web/src/v8/nen-pets/list.tsx` | EntitySelect 1 |
| `apps/web/src/v8/ops/support.tsx` | EntitySelect 1 |
| `apps/web/src/v8/reminders/basics-form.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/booking-kit/shell.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/common-a/frame.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/front-desk/phone-drawer.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/google/google.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/organization/organization.tsx` | EntitySelect 1 |
| `apps/web/src/v8/restaurant/reservations/dialogs.tsx` | EntitySelect 2 |
| `apps/web/src/v8/restaurant/reservations/phone.tsx` | EntitySelect 2 |
| `apps/web/src/v8/scenario-detail/detail.tsx` | EntitySelect 1 |
| `apps/web/src/v8/scenario-first-step/first-step.tsx` | EntitySelect 1 |
| `apps/web/src/v8/settings/booking-media/screen.tsx` | EntitySelect 1 |
| `apps/web/src/v8/settings/pools/create.tsx` | EntitySelect 1 |
| `apps/web/src/v8/settings/staff/staff.tsx` | EntitySelect 1 |
| `apps/web/src/v8/tag-edit/search-edit.tsx` | EntitySelect 3 |
| `apps/web/src/v8/tags/field-migrate.tsx` | EntitySelect 1 |
| `apps/web/src/v8/template-edit/asset.tsx` | EntitySelect 1 |
| `apps/web/src/v8/visit-stamps/dialogs.tsx` | EntitySelect 1, EntityRemoteField 1, EntityMultiPickerDialog 1 |
| `apps/web/src/v8/visit-stamps/visit-stamps.tsx` | EntitySelect 2 |
| `apps/web/src/v8/webinar-edit/notifications.tsx` | EntityRemoteField 1 |
| `apps/web/src/v8/webinar-edit/video.tsx` | EntitySelect 1 |

## 検証

- `DOCTOR_LOCAL=1 bash scripts/codex/doctor.sh`: 合格。
- 検証開始前に取得した `origin/codex/development`: `5c2829221153a90e35a269e92b647ba9378ee8cc`（作業枝の基点と同じ）。
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788 pnpm --filter web typecheck`: 合格。
- 同じAPI指定で `pnpm --filter web build`: 合格（既存の警告あり）。
- `pnpm --filter web verify:design`: 456件一致・不一致0。これは設計値の検査であり、画面照合の合格を意味しない。
- 共通部品と予約スタッフ周辺: 24ファイル・147件合格。
- 実ブラウザ: `automation-create-draft-safety.test.ts` 8件合格。下書きの連打・再入場・店舗切替・実Workerの送信直前の競合を検証。
- `node apps/web/scripts/verify-entity-pickers.mjs`、`git diff --check`: 合格。
- Impeccableの対象4部品の検査: 指摘0。
- 全体試験: ブラウザ試験を分離し、`vitest run --maxWorkers=2 --exclude '**/automation-create-draft-safety.test.ts'` で検証。2,033ファイル・11,918件合格・失敗0・未実行2（skip/todo）。
- 最後の複数選択幅の調整後、共通部品4ファイル・16件、型検査、ビルド、設計値検査を再実行して合格。

## 画面照合

測った実装の版: `7cd84b6e6bdf`（追跡済み・未追跡変更0、サーバーも同じ作業場所で `codeVerified: true`）。1440・1152の画像は `~/lh-work/design/v8/overlay/pages-pickers/1440/` と `1152/` に保存。

| 板 | 対象 | 1440の一致率 | 1152の一致率 |
|---|---|---:|---:|
| f63Jza | 一斉配信のテンプレートを選ぶ窓 | 20% | 16% |
| nF4ts | 友だち一覧の絞り込み | 0% | 0% |
| CcA4k | 予約スタッフ登録 | 3% | 4% |
| M4torY | ルール作成 | 33% | 11% |
| eovoG | 受信箱 | 36% | 26% |

**見た目は未合格。** 5枚を代表として照合した結果であり、変更した全画面の照合は完了していない。1152は同じ1440の板を基準とした狭い幅の参考比較で、専用の1152板との合格を示すものではない。

- f63Jza: 設計の窓は左上（x=130・y=50）、共通の窓は画面中央。題の文字サイズ、検索の文言・余白にも差がある。依頼が指定する受信箱の現実装と設計の位置が異なるため、左上／中央の統一先を確認中。
- 友だち一覧は、今回触っていないタブ・表の配置にも差がある。1152では名前と対応状況が重なり、表の右端の操作が切れる。選ぶ欄だけ直して「崩れ0」と扱わない。
- ほかの3枚も題・背景・余白に差があり、90%基準を満たさない。全体の整合と全変更画面の照合が残る。
- 実ブラウザで上の5画面×2幅、さらに8つの窓を開いて検査。ページの横スクロール、選ぶ欄と窓の右端超過は0、窓は640px。表の重なりまで解消した意味ではない。
- 画像と検査値: `~/lh-work/design/v8/overlay/pages-pickers/interaction/`（`overflow.json` と `<板>-<幅>[-open].png`）。ブラウザ・開発サーバー・見本APIは確認後に停止。

## 引き継ぎ

実装と動作検証を内容別にコミットした。push・PR・D1更新・配備は未実施。見た目が未合格のため統合候補の完成扱いにはしない。次は窓の位置の食い違いを決め、選ぶ窓の正本と各画面の配置を整合して、全対象を90%以上・目視合格へ進める。

## 反映履歴の下書き（司令塔のPR採番後に移す）

PR作成・pushは禁止の依頼のため、番号を推測したunreleasedファイルは作らない。司令塔が実際のPR番号で `docs/release-log/unreleased/<番号>-kenta-pickers.md` を作り、次の内容と統合時の日本時間を記載する。

- タグ・担当者・テンプレートなどを選ぶ操作を共通の窓にそろえ、選ぶ欄のどこを押しても開けるようにした @kenta #<実際のPR番号> <日本時間 YYYY-MM-DD HH:MM>
