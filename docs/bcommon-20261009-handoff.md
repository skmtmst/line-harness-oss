# bcommon 共通修正の引き継ぎ（2026-10-09）

担当枝：`codex/kenta-v8-s-bcommon-10090151`。コミットまで。push・PR・配備・DB更新・Pencil編集は行っていない。

## 変更と監査の対応

| 依頼 | 結果 |
|---|---|
| B-11 | 共通コピーの成功表示1600ms・幅固定、保存ボタンの各状態の最大幅、通知の位置を詰める200ms、更新中の小さい知らせ、メニューの退出80ms、手順の本文高さ200msと切替フェード150ms。動きを減らす設定と途中の切替を扱う。 |
| B-12 | 通信中と失敗後は既存の一覧を残す。403は前のデータを消す。画面を離れる直前のスクロール位置も保存し、検索条件・ページを含めて戻す。情報欄の空・失敗・権限をListStateへ。 |
| B-40 | 型の余白の上書き8か所をSettingsPageのlayoutと型のCSSへ。旧画面コピーを読む試験は、page.tsxから現在描かれるV8をたどる共通読取器へ。 |
| WEB-019 | V8ではマウスの移動口がないつまみだけ隠す。親のdraggableに接続されたつまみと上下キーは残す。並び替え方式の作り替えは判断待ちのまま。 |
| WEB-046 / WEB-006 | タブ下線は文字・幅変更で再計算。枠なしの選択欄にも焦点の輪郭を出す。 |
| WEB237 / WEB238 | QRの初回読み込み失敗後に再試行できる。仮想化した会話の追加読込口をTabで選べる。 |
| WEB239 / WEB240 / WEB241 | アカウント階層の×・Esc・閉じるに未保存確認と保存中の抑止。失敗時は変更を残して操作へ戻す。ポータルのフォルダ候補へ焦点を移しても閉じず、保存開始や初期フォーカス予約で焦点を奪わない。絞り込み変更時は追加読込をリセット。 |
| WEB-120 / WEB008 / WEB023 | 自動化作成に未保存確認を配線。公開成功だけ解除。保存中は共通の離脱操作を止める。⌘Kの未保存確認・IME中のEsc・Noticeのroleは既存の正しい動きを試験で確認。 |
| WEB252 / WEB253 | 設定ナビの読み直しは対象アカウントと保存イベントを照合。旧SVGにもV8の寸法を渡す。 |
| WEB246 / WEB251 | ダッシュボード設定とメールのメモは、保存中に編集・並び替え・取消で送信内容を変えない。 |
| 共通点検 上位10件 | 未分類の開いたフォルダ、共通Toggle・TagPill、注記のStatusBadge、行のRowMenu、TableHeadRow、ListState、BulkBar、620pxのDrawer、FolderEditorDialogを配線・確認。共有CSSを使う残りのタグ3タブにも同じ部品の口を適用。 |

現行入口への試験移行で判明したマイレージの件数不明を0件にしない扱いと、写真詳細の失敗後の再試行も修正した。保存・送信・権限・失敗・復旧の動作試験は削除していない。v7の共通部品の分岐は維持した。

## 検証

- Web全体：11,585件成功、失敗0件、既存の右クリック試験1件スキップ。`vitest run --config vitest.config.ts`。
- 最新本線の取り込み後の共通・関連機能：1,631件成功。全体試験後の保存通信失敗と最終調整：66件成功。
- 型検査と `pnpm --filter web build`：成功。ビルドの既存Lint警告は残る。
- `pnpm --filter web verify:design`：456件一致、不一致0件、合格。
- 直書き負債検査とV8境界試験：成功。消した共有CSSを参照していた3タブも共通部品へ移し、古い骨組みのimportを持ち込まず現行の描画を検査する。
- `git diff --check`：成功。親EC作業ツリーはクリーンで変更なし。
- 最初のビルドは成功。最終の再ビルドで生成キャッシュの `/_document` が見つからないエラーが出たため、キャッシュを `/tmp/bcommon-next-failed-20261009-54789e3f10` に控えとして移動し、新しく生成して成功した。

実装・画像の照合用の記録は [検証資料](validation/bcommon-20261009/) に保存した。動作試験の数値は全体試験とその後の追加試験を区別している。

再現試験は修正前に失敗を確認してから直した。代表例：未接続のつまみ、親からのドラッグ、タブ幅変更、候補への焦点、保存中の閉じる、保存の通信失敗、QR再試行、追加読込のリセット、一覧保持、離脱直前のスクロール、自動化の未保存、写真の再試行。既存で正しかった⌘K・Notice等は動作を確認した。

## 代表の板

| 板ID | 名前 | 直す前 | 直した後 | 左右・重ね合わせで確認した結果 |
|---|---|---:|---:|---|
| WQmep | ダッシュボード | 46% | 46% | 下の受信・状況・リンクの段が絵より約16px上。状態札と左メニューの違いも残る。 |
| x6QsVz | 友だち一覧・閲覧のみ | 98% | 98% | アバター・札・行の位置に違い。閲覧者の取り込みボタンを隠す点は仕様どおり。1152では名前と対応が重なり、右端24pxのはみ出しが37要素で検出。 |
| I1E7Bt | タグ一覧 | 99% | 99% | 列の構成・行高・左のフォルダ幅が絵と違う。親に接続済みのつまみは操作を残す。 |
| LRc93 | 統括テンプレート | 5% | 5% | 絵は上に作成・検索、実装は数の帯があり、表の列も異なる。骨格の採用版を司令塔が確認する。 |

4板とも1440・1152で撮影できた。撮れなかった板はない。4板の目視合格は付けていない。1440の右端越えは全板0、1152も友だち以外は0。内部のはみ出し検査には、広いクリック領域や省略表示も含まれるため、画像を併せて確認した。

変更前と変更後の実装画像・1440の正本画像・重ね合わせ・delta・1152の実装画像・[幅検査の生データ](validation/bcommon-20261009/responsive.json)を保存した。

1440幅の%は共通の文字の位置が±4pxに入った割合。文字の一致率と画像の合格は別に扱う。1152幅も撮影・目視・右端の検査を実施するが、この4板の正本は1440幅なので、1440の文字座標との1152の比較値は合否に使わない。

測る道具がdeltaへ記すSHAは測定用リポジトリのSHAになっているため、作業版はこの文書とmeasure.shの「測った版」で照合する。画像は拡大縮小・位置の補正をしていない。

## 司令塔へ戻すもの

- WEB-019の並び替え方式は判断待ち。今回の範囲は動かないつまみの非表示。
- 代表板の残る違いは下の表のとおり。Pencil、PASSED.tsv、画面全体の骨格は変更していない。統括テンプレートは絵の採用版を確認してから画面担当へ戻す。
- 1152の友だち一覧は名前と対応の重なり・右端の切れがある。1152の変更前撮影を保存していないため、発生時点は断定しない。画面固有の列幅と最小幅を担当が点検する。
- API追加・DB変更の必要はない。
- PR採番後、司令塔が `docs/release-log/unreleased/<PR番号>-kenta-bcommon.md` に利用者向けの1行を追加する。今回の作業役はPRを作成しないため、番号を仮置きしていない。

## 開発枝の取り込みとコミット

開始時の土台：`64096e969c3e748d281b8bc3d1b2bc5e65243060`。
再検証の土台：`5545d30ef51f8a43623a7ed4475a1a5dacedf029`。
競合は `components/shared/tabs.tsx` の1か所。最新本線のitemWidthsKeyによる再計算と今回のResizeObserver、cleanupを両方残した。自動統合された型のCSS・アカウント引き継ぎ・試験も再検証した。

- `d14f9527eb` 共通操作・監査・一覧と離脱の守り
- `9a9f648ac3` 型の余白と現行画面への配線
- `4d757534bc` 試験を現行V8の入口へ移行
- `54789e3f10` 最新の開発枝を取り込み
- 最後の修正・この引き継ぎのSHAは最終報告に記す。

## 変更ファイル

<details>
<summary>本線との差分のパス一覧（画像と測定資料は上記フォルダ）</summary>

- `apps/web/scripts/test-ui-source.mjs`
- `apps/web/src/app/accounts/accounts-setup-visual-parity.test.ts`
- `apps/web/src/app/accounts/handover/handover-v8.test.tsx`
- `apps/web/src/app/accounts/migration-contract.test.ts`
- `apps/web/src/app/affiliate-offers/new/affiliate-offer-account-contract.test.ts`
- `apps/web/src/app/affiliates/affiliate-offer-v6-contract.test.ts`
- `apps/web/src/app/affiliates/feature16-v6-contract.test.ts`
- `apps/web/src/app/auto-replies/edit/wizard-save-notice-contract.test.ts`
- `apps/web/src/app/automations/automation-v8-boards-contract.test.ts`
- `apps/web/src/app/automations/list-board-numbers-contract.test.ts`
- `apps/web/src/app/booking/menus/new/menu-form-tag-search.test.ts`
- `apps/web/src/app/booking/menus/settings-tabs-split.contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-misc-boards-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-v8-boards-contract.test.ts`
- `apps/web/src/app/broadcasts/broadcast-v8-rest-contract.test.ts`
- `apps/web/src/app/contents/media-list-v8-contract.test.tsx`
- `apps/web/src/app/contents/vars/list-v8-board-numbers-contract.test.ts`
- `apps/web/src/app/contents/vars/xxktw-wording-contract.test.ts`
- `apps/web/src/app/conversions/list-board-numbers-contract.test.ts`
- `apps/web/src/app/duplicates/duplicates-contract.test.ts`
- `apps/web/src/app/ec-commerce/ec-connector-v8.test.tsx`
- `apps/web/src/app/error-copy-recovery-contract.test.ts`
- `apps/web/src/app/events/bookings/bookings-v8.test.tsx`
- `apps/web/src/app/events/change-review/change-review-v8.test.tsx`
- `apps/web/src/app/events/events-list-v8.test.tsx`
- `apps/web/src/app/events/new/events-new-v8.test.tsx`
- `apps/web/src/app/folder-count-fallback-removed-contract.test.ts`
- `apps/web/src/app/friends/migrations/friend-migrations-failure-m015m016.test.ts`
- `apps/web/src/app/friends/migrations/friend-migrations-v6-contract.test.ts`
- `apps/web/src/app/friends/u970-friends-search.test.ts`
- `apps/web/src/app/hq/account-create-entry.test.ts`
- `apps/web/src/app/list-state-retry-wiring-contract.test.ts`
- `apps/web/src/app/loading-skeleton-ux15-contract.test.ts`
- `apps/web/src/app/mileage/earning-rules-v6-contract.test.ts`
- `apps/web/src/app/mileage/mileage-audit-541-contract.test.ts`
- `apps/web/src/app/mileage/mileage-v6-contract.test.ts`
- `apps/web/src/app/mileage/rewards/edit/reward-form.test.ts`
- `apps/web/src/app/nen-campaigns/columns/new/u059-preview-order-contract.test.ts`
- `apps/web/src/app/nen-campaigns/edit/campaign-insert-toolbar-audit.test.ts`
- `apps/web/src/app/nen-campaigns/test-recipient-login-users.test.ts`
- `apps/web/src/app/nen-campaigns/u972-header-wrap.test.ts`
- `apps/web/src/app/nen-members/photo-review-contract.test.ts`
- `apps/web/src/app/nen-members/photo-workspace-contract.test.ts`
- `apps/web/src/app/no-permission/no-permission-v8-contract.test.tsx`
- `apps/web/src/app/reminders/reminder-boards-nodes.test.ts`
- `apps/web/src/app/reminders/reminder-empty-vs-error-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-account-scope-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-f4gELj-sections.test.ts`
- `apps/web/src/app/rich-menus/new/create-order-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-publish-check-contract.test.ts`
- `apps/web/src/app/rich-menus/new/create-shape-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-load-failure-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-new-steps.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-preview-bottom-contract.test.ts`
- `apps/web/src/app/rich-menus/new/rich-menu-template-account-scope-contract.test.ts`
- `apps/web/src/app/scenarios/scenario-misc-boards-contract.test.ts`
- `apps/web/src/app/settings/feature-settings-impact.test.ts`
- `apps/web/src/app/settings/manual-links/manual-link-contract.test.ts`
- `apps/web/src/app/settings/manual-links/u071-retry-contract.test.ts`
- `apps/web/src/app/settings/settings-misc-boards-contract.test.ts`
- `apps/web/src/app/settings/settings-v8-rest-contract.test.ts`
- `apps/web/src/app/settings/settings-visual-parity.test.ts`
- `apps/web/src/app/tags/tag-boards-nodes.test.ts`
- `apps/web/src/app/tags/ux-tags-optimistic.test.ts`
- `apps/web/src/app/tags/ux2-tags-detail.test.ts`
- `apps/web/src/app/template-list-board-1152-contract.test.ts`
- `apps/web/src/app/templates/list-v8-date-col-contract.test.ts`
- `apps/web/src/app/templates/template-boards-nodes.test.ts`
- `apps/web/src/app/unsaved-guard-wiring-contract.test.ts`
- `apps/web/src/app/users/friend-0910-audit-contract.test.ts`
- `apps/web/src/app/webhooks/outgoing-1152-overflow-contract.test.ts`
- `apps/web/src/app/webinars/webinar-list-state-contract.test.ts`
- `apps/web/src/components/accounts/account-ordering-close.regression.test.tsx`
- `apps/web/src/components/accounts/account-ordering.tsx`
- `apps/web/src/components/auto-replies/inline-action-rows-v8.tsx`
- `apps/web/src/components/chats/chat-thread-window.tsx`
- `apps/web/src/components/chats/chat-window-react.test.tsx`
- `apps/web/src/components/chats/template-folder-select.tsx`
- `apps/web/src/components/chats/template-picker-perf-12-react.test.tsx`
- `apps/web/src/components/chats/template-picker.tsx`
- `apps/web/src/components/friend-fields/tag-editor-v4.tsx`
- `apps/web/src/components/friends/friends-v4-contract.test.ts`
- `apps/web/src/components/layout/settings-inner-nav.react.test.tsx`
- `apps/web/src/components/layout/settings-inner-nav.tsx`
- `apps/web/src/components/layout/sidebar.tsx`
- `apps/web/src/components/merged-person/merged-person-screen.test.tsx`
- `apps/web/src/components/reminders/reminder-server-data.test.tsx`
- `apps/web/src/components/shared/action-menu.module.css`
- `apps/web/src/components/shared/action-menu.tsx`
- `apps/web/src/components/shared/bcommon-audit.regression.test.tsx`
- `apps/web/src/components/shared/bcommon-wiring.regression.test.ts`
- `apps/web/src/components/shared/button.tsx`
- `apps/web/src/components/shared/command-palette.test.tsx`
- `apps/web/src/components/shared/copy-feedback.regression.test.tsx`
- `apps/web/src/components/shared/copy-text-button.module.css`
- `apps/web/src/components/shared/copy-text-button.tsx`
- `apps/web/src/components/shared/dialog.tsx`
- `apps/web/src/components/shared/drawer.module.css`
- `apps/web/src/components/shared/drawer.tsx`
- `apps/web/src/components/shared/folder-rail-owner-contract.test.ts`
- `apps/web/src/components/shared/list-kpis-contract.test.ts`
- `apps/web/src/components/shared/list-url-state.react.test.tsx`
- `apps/web/src/components/shared/list-url-state.ts`
- `apps/web/src/components/shared/menu-portal.tsx`
- `apps/web/src/components/shared/motion-audit.regression.test.tsx`
- `apps/web/src/components/shared/overlay-utils.ts`
- `apps/web/src/components/shared/refresh-cover.module.css`
- `apps/web/src/components/shared/refresh-cover.tsx`
- `apps/web/src/components/shared/reorder-handle.tsx`
- `apps/web/src/components/shared/row-roving-wiring-contract.test.ts`
- `apps/web/src/components/shared/save-conflict-wiring-contract.test.ts`
- `apps/web/src/components/shared/select.module.css`
- `apps/web/src/components/shared/status-badge.module.css`
- `apps/web/src/components/shared/status-badge.tsx`
- `apps/web/src/components/shared/table.tsx`
- `apps/web/src/components/shared/tabs.tsx`
- `apps/web/src/components/shared/toast-stack.regression.test.tsx`
- `apps/web/src/components/shared/toast.tsx`
- `apps/web/src/components/shared/use-stack-motion.ts`
- `apps/web/src/components/shared/use-step-motion.ts`
- `apps/web/src/components/support/email-thread-draft-react.test.tsx`
- `apps/web/src/components/support/email-thread.tsx`
- `apps/web/src/components/templates/create-page-spacing.test.tsx`
- `apps/web/src/components/templates/page-frame.tsx`
- `apps/web/src/components/templates/page-templates.module.css`
- `apps/web/src/components/templates/settings-layout.regression.test.tsx`
- `apps/web/src/components/templates/settings-page.tsx`
- `apps/web/src/components/ui/copy-text-button.tsx`
- `apps/web/src/components/ui/list-controls-contract.test.ts`
- `apps/web/src/components/ui/u060-kpi-collapse-contract.test.ts`
- `apps/web/src/components/ui/u101-sample-notice-contract.test.ts`
- `apps/web/src/components/webinars/webinar-notifications-contract.test.ts`
- `apps/web/src/last-boards-4-contract.test.ts`
- `apps/web/src/lib/current-entry-source.regression.test.ts`
- `apps/web/src/lib/design-impact.test.ts`
- `apps/web/src/lib/empty-vs-error.test.ts`
- `apps/web/src/lib/qr-image.ts`
- `apps/web/src/lib/qr-retry.regression.test.ts`
- `apps/web/src/lib/server-list-refresh.regression.test.tsx`
- `apps/web/src/lib/use-live-reorder-wiring.test.ts`
- `apps/web/src/lib/use-server-list.ts`
- `apps/web/src/lib/use-unsaved-guard.test.tsx`
- `apps/web/src/lib/use-unsaved-guard.ts`
- `apps/web/src/native-choice-rest-contract.test.ts`
- `apps/web/src/v8/accounts-detail/detail.module.css`
- `apps/web/src/v8/accounts-detail/detail.tsx`
- `apps/web/src/v8/accounts-detail/handover.module.css`
- `apps/web/src/v8/accounts-detail/handover.tsx`
- `apps/web/src/v8/affiliates/drawer.tsx`
- `apps/web/src/v8/automations/create/create.tsx`
- `apps/web/src/v8/automations/create/validation.test.tsx`
- `apps/web/src/v8/common-vars/list.tsx`
- `apps/web/src/v8/dashboard/dashboard-editor.test.tsx`
- `apps/web/src/v8/dashboard/dashboard-editor.tsx`
- `apps/web/src/v8/folder-dot-1152-contract.test.ts`
- `apps/web/src/v8/friend-add/list.test.tsx`
- `apps/web/src/v8/inbox-chat/template-picker-view.tsx`
- `apps/web/src/v8/mileage/score.tsx`
- `apps/web/src/v8/nen-posts/detail-retry.regression.test.tsx`
- `apps/web/src/v8/nen-posts/detail.tsx`
- `apps/web/src/v8/nen-posts/review.tsx`
- `apps/web/src/v8/reminders/detail.tsx`
- `apps/web/src/v8/settings/accounts/accounts.tsx`
- `apps/web/src/v8/settings/getting-started/getting-started.tsx`
- `apps/web/src/v8/settings/pools/pools.tsx`
- `apps/web/src/v8/settings/sa-frame.module.css`
- `apps/web/src/v8/settings/sb-frame/settings-screen.module.css`
- `apps/web/src/v8/settings/sb-frame/settings-screen.tsx`
- `apps/web/src/v8/tags/fields-tab.tsx`
- `apps/web/src/v8/tags/list.module.css`
- `apps/web/src/v8/tags/marks-tab.tsx`
- `apps/web/src/v8/tags/searches-tab.tsx`
- `apps/web/src/v8/tags/tags-tab.tsx`

</details>
