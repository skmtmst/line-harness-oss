# badges：画面に手書きされた共通部品の一覧

対象：`apps/web/src/app` の TSX/CSS。`rg -n` で部品名・CSSクラス・星・進みの棒を検索し、画像本文・QR・評価点の星・共通部品の参照を除外した。画面のファイルは変更していない。

状態の札か経路の札かは表示する意味で選ぶ。名前だけが同じ判定関数で、既に StatusBadge を返しているものは対象外。

| 部品 | ファイル：行 | 画面側で行うこと |
|---|---|---|
| タグ | `apps/web/src/app/auto-replies/edit/wizard-v8.tsx`：1309 | Chip（押せる選択肢は操作を維持）へ置き換え。保存・送信・権限の動きは維持 |
| タグ | `apps/web/src/app/auto-replies/quick-create-v8.tsx`：206 | Chip（押せる選択肢は操作を維持）へ置き換え。保存・送信・権限の動きは維持 |
| タグ | `apps/web/src/app/friend-add-settings/publish/page.tsx`：344 | Chip（押せる選択肢は操作を維持）へ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/events/events-list-v8.tsx`：512, 528, 544, 556 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/mileage/v8-balances-tab.tsx`：323, 338, 350, 358 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/mileage/v8-earning-rules-tab.tsx`：527, 540, 550, 560 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/mileage/v8-history-tab.tsx`：263, 276, 283, 291 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/mileage/v8-rewards-tab.tsx`：484, 499, 512, 524 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/mileage/v8-score-tab.tsx`：425, 436, 447, 458 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/nen-campaigns/nen-campaigns-v8.tsx`：212 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/nen-members/photo-review-v8.tsx`：590 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/nen/health/health-v8.tsx`：184 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/nen/members/members-v8.tsx`：192 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/nen/pets/pets-v8.tsx`：168 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/webhooks/outgoing-v8.tsx`：250 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 印のタイル | `apps/web/src/app/webinars/list-v8.tsx`：884 | IconTileへ置き換え。保存・送信・権限の動きは維持 |
| 手書きの状態・補足の札 | `apps/web/src/app/booking/bookings/page.tsx`：1493 | StatusBadge / Chip（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 注目の星 | `apps/web/src/app/chats/page.tsx`：3113 | AttentionStarへ置き換え。保存・送信・権限の動きは維持 |
| 注目の星 | `apps/web/src/app/hq/banners/project/page.tsx`：458 | AttentionStarへ置き換え。保存・送信・権限の動きは維持 |
| 注目の星 | `apps/web/src/app/tags/tags-tab-v8.tsx`：799 | AttentionStarへ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/affiliates/v8-affiliates-tab.tsx`：586 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/affiliates/v8-approvals-tab.tsx`：560, 564 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/affiliates/v8-drawer.tsx`：351, 372 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/affiliates/v8-offers-tab.tsx`：459 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/affiliates/v8-payment-tab.tsx`：355, 478, 485 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/auto-replies/edit/wizard-v8.tsx`：1164 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/automations/new/page.tsx`：2661, 2675 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/booking/menus/staff/assign-v8.tsx`：506, 507 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/booking/prepay-badge-v8.tsx`：88 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx`：1098, 1258 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/broadcasts/detail-v8.tsx`：256, 257, 547 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/broadcasts/list-v8.tsx`：113, 114 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/broadcasts/reserved-v8.tsx`：96, 97 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/contents/list-v8.tsx`：1901 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/form-submissions/list-v8.tsx`：1308, 1326, 1800 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/hq/templates/template-console.tsx`：455, 486 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/no-permission/no-permission-v8.tsx`：69 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/reminders/detail/detail-v8.tsx`：1120 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/reminders/list-v8.tsx`：919 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/restaurant-test/v8/shell.tsx`：63 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/settings/feature-settings-v8.tsx`：154, 162 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/tags/field-migrate-v8.tsx`：55 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/tags/searches-v8.tsx`：426 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/tags/tags-tab-v8.tsx`：766, 767 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/templates/edit-v8.tsx`：567 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/templates/list-v8.tsx`：1178 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 状態・経路の札 | `apps/web/src/app/webhooks/_components/webhooks-v8-sheets.tsx`：442, 447 | StatusBadge / RouteBadge（意味を確認）へ置き換え。保存・送信・権限の動きは維持 |
| 進みの棒 | `apps/web/src/app/accounts/new/register-v8.tsx`：759 | ProgressBarへ置き換え。保存・送信・権限の動きは維持 |
| 進みの棒 | `apps/web/src/app/contents/media-quota-guidance.tsx`：23 | ProgressBarへ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/auto-replies/runs/page.tsx`：292 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/chats/page.tsx`：3254 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/inflow-links/detail/page.tsx`：696 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/mileage/action-score-tab.tsx`：304 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/mileage/friends/detail/page.tsx`：322 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/health/health-tab.tsx`：238 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/health/health-v8.tsx`：401 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/members/members-tab.tsx`：190 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/members/members-v8.tsx`：507 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/pets/pets-tab.tsx`：212, 287 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |
| 顔 | `apps/web/src/app/nen/pets/pets-v8.tsx`：410 | Avatar（ペットの顔は写真失敗時の扱いも確認）へ置き換え。保存・送信・権限の動きは維持 |

| 状態の札 | `apps/web/src/app/booking/bookings/page.tsx`：1239 | StatusBadgeへ置き換え。予約の状態や操作は維持 |
| タグ | `apps/web/src/app/booking/menus/settings-tabs/menus-tab.tsx`：308 | Chipへ置き換え。分類名は維持 |

検索した主な語：`statusBadge`・`miniBadge`・`statusDot`・`tagChip`・`styles.tag`・`styles.chip`・`avatar`・`petFace`・`kpiIcon`・`<Star`・`<StarIcon`・`role="progressbar"`・`rounded-pill`。

フォルダの列・数の帯は別レーンの対象。本レーンでは機能画面を変更せず、上記の札・顔・印・棒を一覧にした。
