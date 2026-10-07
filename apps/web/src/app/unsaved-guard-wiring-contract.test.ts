import { readdirSync, readFileSync } from 'node:fs'
import { readUiSource } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * DETAIL-04系（画面によって未保存の離脱警告が出る／出ない）の再発防止。
 *
 * 「未保存の編集状態」を持つ画面は、離脱の番兵を共通フック
 * `useUnsavedGuard`（+ ConfirmDialog）で持つことを機械的に確認する。
 * 新しい編集画面を足したら、GUARDED か COVERED_BY_PARENT か
 * EXEMPTIONS（理由つき）へ分類を追加する。未分類のままだとこのテストが落ちる。
 */

/** 未保存の編集状態を持つ画面の印。dirty系の名前・スナップショット・未保存の文言。 */
const DIRTY_SIGNATURE = /dirty|unsaved|savedSnapshot|未保存/i

/** 番兵を持つ画面。`useUnsavedGuard` と離脱確認ダイアログの両方が必要。 */
const GUARDED = [
  'app/inflow-links/ad-event-mappings.tsx',
  'app/settings/feature-settings-v8.tsx',
  'components/ops/knowledge-editor.tsx',
  'app/affiliate-offers/new-offer-v8.tsx',
  'app/affiliates/new-affiliate-v8.tsx',
  'app/analytics/reports/new/page.tsx',
  'app/auto-replies/edit/wizard-v8.tsx',
  'app/booking/menus/new/menu-form-v8.tsx',
  'app/booking/menus/new/page.tsx',
  'app/booking/menus/payment-tab-v8.tsx',
  'app/booking/menus/settings-v8.tsx',
  'app/booking/menus/staff/assign-v8.tsx',
  'app/booking/menus/staff/page.tsx',
  'app/booking/staff/new/page.tsx',
  'app/booking/staff/new/staff-new-v8.tsx',
  'app/booking/staff/shifts/page.tsx',
  'app/contents/vars/edit/page.tsx',
  'app/contents/vars/new/page.tsx',
  'app/conversions/new/page.tsx',
  'app/ec-commerce/connector-panel.tsx',
  'v8/settings/ec-commerce/connector.tsx',
  'app/form-submissions/edit/page.tsx',
  'app/friend-add-settings/friend-add-rule-editor.tsx',
  'app/inflow-links/new/page.tsx',
  // 2026-10-07：入口は src/v8 の画面を出すだけ。番兵は画面（operator-edit）が持つ。
  'v8/line-notifications/operator-edit.tsx',
  'app/line-notifications/operator/new/operator-new-v8.tsx',
  'app/mileage/earning-rules/edit/page.tsx',
  'app/mileage/earning-rules/edit/v8-earning-rule-edit.tsx',
  'app/mileage/earning-rules/new/page.tsx',
  'app/mileage/earning-rules/new/v8-earning-rule-new.tsx',
  'app/mileage/page.tsx',
  /* 入口 page.tsx は V8 の画面を出すだけ。番兵は src/v8 の画面が持つ。 */
  'v8/mileage/reward-edit.tsx',
  'v8/mileage/earning-rules.tsx',
  'app/mileage/rewards/edit/v8-reward-edit.tsx',
  'app/mileage/v8-earning-rules-tab.tsx',
  'app/nen-campaigns/columns/new/column-new-v8.tsx',
  'app/nen-campaigns/columns/new/page.tsx',
  'app/nen-campaigns/edit/campaign-editor-v8.tsx',
  'app/nen-campaigns/edit/page.tsx',
  'app/nen-campaigns/page.tsx',
  'app/nen/members/lifetime-tab.tsx',
  'app/nen/members/members-v8.tsx',
  'app/nen/members/rank-settings-tab.tsx',
  'app/nen/pets/feeding-tab.tsx',
  'app/nen/pets/pets-v8.tsx',
  // ★V8 マイペットのごはんの目安（h7A2F）。下の帯の保存まで画面に残る変更を useUnsavedGuard で守る。
  'v8/nen-pets/feeding.tsx',
  'app/ops/announcements/page.tsx',
  'app/reminders/edit/edit-v8.tsx',
  'app/reminders/edit/issue469-reminder-screens.tsx',
  'app/reminders/new/new-v8.tsx',
  'app/reminders/new/page.tsx',
  'app/restaurant-test/google/google-business.tsx',
  'app/restaurant-test/google/google-posts.tsx',
  'app/restaurant-test/google/google-profile.tsx',
  'app/restaurant-test/stores/new/page.tsx',
  'app/restaurant-test/v8/reservation-phone.tsx',
  'app/restaurant-test/v8/reservations.tsx',
  'app/rich-menus/edit/page.tsx',
  'app/rich-menus/new/create-v8.tsx',
  'app/rich-menus/new/page.tsx',
  // ★V8：入口（app/settings/file-scan/page.tsx）は src/v8 の画面を出すだけ。番兵は画面と同じ場所のフックが持つ。
  'v8/settings/file-scan/screen.tsx',
  'v8/settings/features/screen.tsx',
  'app/staff/new/page.tsx',
  'app/tags/field-editor-v8.tsx',
  'app/tags/fields/edit/page.tsx',
  'app/tags/fields/new/page.tsx',
  'app/tags/mark-editor-v8.tsx',
  'app/tags/search-editor-v8.tsx',
  'app/tags/searches/edit/page.tsx',
  'app/templates/carousel/page.tsx',
  'app/templates/editor-v8.tsx',
  'app/templates/questions/new/page.tsx',
  'app/webhooks/new/page.tsx',
  'v8/webhooks/create.tsx',
  'v8/conversions/create.tsx',
  'v8/form-edit/edit.tsx',
  'v8/friend-add/editor.tsx',
  'v8/inflow-links/new/create.tsx',
  // ★V8 共通変数の編集・作る（src/v8/common-vars-edit）。useUnsavedGuard で番兵を持つ。
  'v8/common-vars-edit/edit.tsx',
  'v8/common-vars-edit/new.tsx',
  'app/webinars/edit/page.tsx',
  'app/webinars/new/new-v8.tsx',
  'app/webinars/new/page.tsx',
  'components/broadcasts/broadcast-form.tsx',
  'components/events/event-form.tsx',
  'components/events/event-wizard.tsx',
  'components/friend-fields/support-mark-editor.tsx',
  'components/reminders/reminder-publish-flow.tsx',
  /* 2026-10-07：src/v8 に一から書いた画面。それぞれ自分で useUnsavedGuard と離脱確認を持つ。 */
  'v8/affiliates/create.tsx',
  'v8/booking-menus/assign.tsx',
  'v8/booking-menus/menu-form.tsx',
  'v8/booking-menus/settings.tsx',
  'v8/booking-staff/staff-new.tsx',
  'v8/events/create.tsx',
  'v8/mileage/earning-rule-new/create.tsx',
  'v8/nen-campaigns/column-new.tsx',
  'v8/nen-campaigns/edit.tsx',
  'v8/nen-members/lifetime.tsx',
  'v8/nen-members/ranks.tsx',
  'v8/ops/announcements.tsx',
  'v8/ops/knowledge-article.tsx',
  'v8/reminders/edit.tsx',
  'v8/restaurant/google/posts.tsx',
  'v8/restaurant/google/reviews.tsx',
  'v8/restaurant/reservations/phone.tsx',
  'v8/restaurant/store-new/store-new.tsx',
  'v8/hq-broadcasts/create.tsx',
  'v8/settings/booking-media/screen.tsx',
  'v8/template-edit/asset.tsx',
  'v8/visit-stamps/visit-stamps.tsx',
  'v8/template-edit/message.tsx',
  'v8/webinar-edit/edit.tsx',
  'v8/webinar-edit/new.tsx',
  /*
   * 2026-10-07：src/v8 の分類で、保存していない変更を画面に持つのに番兵が無かったので足した。
   * シナリオ詳細（追従バーの「未保存の変更があります」）・アカウントの乗り換え（保存していない判断の書き換え）・
   * 予約枠と在庫（下の帯で保存する配分と開ける時間）・統括のお問い合わせ（書きかけの件名・内容・画像）。
   */
  'v8/scenario-detail/detail.tsx',
  'v8/accounts-detail/handover.tsx',
  'v8/restaurant/inventory/stock.tsx',
  'v8/hq/support.tsx',
  /* 2026-10-07：src/v8 に一から書いた画面（まとめの取り込みで見張りの対象に入った）。それぞれ自分で useUnsavedGuard と離脱確認を持つ。 */
  'v8/affiliate-offer-new/create.tsx',
  'v8/tag-edit/search-edit.tsx',
  'v8/tags/create.tsx',
  'v8/tags/field-editor.tsx',
  'v8/tags/mark-editor.tsx',
  'v8/template-edit/rich.tsx',
  'v8/templates/carousel.tsx',
  'v8/templates/question-new.tsx',
] as const

/*
 * dirty を子（pane・部分部品）から親へ報告し、番兵は親が持つ画面。
 * 子は `onDirtyChange` 等で報告するだけで、自分では確認対話を出さない。
 */
const COVERED_BY_PARENT: Record<string, string> = {
  'app/webinars/edit/basic-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/templates/edit-v8.tsx': 'app/templates/editor-v8.tsx',
  'app/templates/asset-editor-v8.tsx': 'app/templates/editor-v8.tsx',
  'app/templates/carousel/carousel-v8.tsx': 'app/templates/editor-v8.tsx',
  'app/templates/questions/question-v8.tsx': 'app/templates/editor-v8.tsx',
  'components/webinars/webinar-form.tsx': 'app/webinars/edit/page.tsx',
  'components/webinars/webinar-notifications.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/comments-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/video-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/cta-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/notifications-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/participants-v8.tsx': 'app/webinars/edit/page.tsx',
  'app/webinars/edit/review-v8.tsx': 'app/webinars/edit/page.tsx',
  // ★V8 版の描画。番兵（useUnsavedGuard）は同じ画面の page.tsx が
  // 共有フック経由で持つ。どちらのテーマでも同じ番兵が効く。
  'app/affiliate-offers/new/page.tsx': 'app/affiliate-offers/new-offer-v8.tsx',
  'app/settings/page.tsx': 'app/settings/feature-settings-v8.tsx',
  'app/settings/file-scan/file-scan-v8.tsx': 'app/settings/file-scan/page.tsx',
  // 予約設定V8のタブ分割。書きかけは V8TabEditContext で親へ報告し、
  // 番兵（useUnsavedGuard＋離脱確認）は殻の settings-v8.tsx が持つ。
  'app/booking/menus/settings-tabs/shared.tsx': 'app/booking/menus/settings-v8.tsx',
  'app/booking/menus/settings-tabs/hours-tab.tsx': 'app/booking/menus/settings-v8.tsx',
  'app/booking/menus/settings-tabs/holidays-tab.tsx': 'app/booking/menus/settings-v8.tsx',
  'app/booking/menus/settings-tabs/rules-tab.tsx': 'app/booking/menus/settings-v8.tsx',
  // ★V8 予約設定（src/v8/booking-menus）のタブ。書きかけは V8TabEditContext で殻の settings.tsx へ報告し、番兵は殻が持つ。
  'v8/booking-menus/tabs/shared.tsx': 'v8/booking-menus/settings.tsx',
  'v8/booking-menus/tabs/hours-tab.tsx': 'v8/booking-menus/settings.tsx',
  'v8/booking-menus/tabs/holidays-tab.tsx': 'v8/booking-menus/settings.tsx',
  'v8/booking-menus/tabs/rules-tab.tsx': 'v8/booking-menus/settings.tsx',
  // ★V8 ウェビナーの編集（src/v8/webinar-edit）の段。onDirtyChange で edit.tsx へ報告し、番兵は edit.tsx が持つ。
  'v8/webinar-edit/basic.tsx': 'v8/webinar-edit/edit.tsx',
  'v8/webinar-edit/comments.tsx': 'v8/webinar-edit/edit.tsx',
  'v8/webinar-edit/cta.tsx': 'v8/webinar-edit/edit.tsx',
  'v8/webinar-edit/notifications.tsx': 'v8/webinar-edit/edit.tsx',
  'v8/webinar-edit/video.tsx': 'v8/webinar-edit/edit.tsx',
}

/*
 * dirty はあるが、画面離脱の番兵を「今は」持たないもの。理由を必ず書く。
 * 番兵を付けられるようになったら EXEMPTIONS から GUARDED へ移す。
 */
const EXEMPTIONS: Record<string, string> = {
  'v8/restaurant/closures/closure-dialog.tsx': '臨時休業・貸切を足す・変える窓（提案 E-10 nVvXy）。保存の口は窓の中だけで、開くたびに押した日か記録から作り直し、閉じると入力を破棄する。',
  'v8/restaurant/front-desk/phone-drawer.tsx': '電話予約の引き出し（提案 E-2）。保存の口は引き出しの中だけで、開くたびに空から始まり、閉じると入力を破棄する（入力中は題に * が付く）。',
  'app/hq/account-browser-v8.tsx': 'タグ名だけの小さな窓。保存の口は窓内だけにあり、閉じると入力を破棄する。',
  'app/nen-members/photo-policy-history-v8.tsx': '報酬版を追加する小さな窓。親の設定画面から開き、閉じれば保存前の値を破棄する。',
  'app/affiliates/payment-tab.tsx':
    '支払いCSV出力の確認窓（Vの本人確認入力を含む）。保存する編集画面ではなく番兵の対象外',
  'app/affiliates/new/page.tsx':
    '「未保存の追加情報を破棄して一覧へ戻る」明示フロー。dirty管理ではなく部分保存の案内',
  'app/automations/new/page.tsx':
    'サーバーへ下書き保存する多段ウィザード。段またぎ・店ごとの退避があり離脱の扱いは別途検討',
  'app/automations/new/new-v8.tsx':
    'new/page.tsx と同じ画面の★V8版（M4torY・tJqST・J1VA8）。サーバーへ下書き保存する多段入力で、離脱の扱いは元の画面と一緒に決めるため同じ扱い',
  'app/common-actions/common-action-new-v8.tsx':
    'new/page.tsx（s3 未判定）と同じ画面の★V8版。番兵の要否は元の画面と一緒に決めるため、同じ扱いでここに置く',
  'app/automations/drafts/draft-v8.tsx':
    '見本から作った下書きの仕上げ面。保存は下書き保存・つくって動かすの明示操作でサーバーへ送り、離脱の扱いは new と同じく別途検討',
  'app/accounts/new/page.tsx':
    '登録ウィザードでdirty管理なし（コメント中の「未保存」記述のみ。R523の復帰案内の文言）',
  'app/accounts/new/register-v8.tsx':
    'V8登録ウィザード。入力は端末の下書きへ随時保存（秘密値は除く）し、閉じる確認は手順内の戻る・あとで続きからで済ませる設計',
  'app/booking/bookings/new/page.tsx':
    'dirty管理なし（コメント中の「未保存」記述のみ）',
  'app/hq/templates/template-console.tsx':
    '多段ウィザード＋sessionStorage下書き。段の途中離脱の扱いは別途検討',
  'app/hq/account-settings-dialogs.tsx':
    '統括の3つの窓（HMpVx・D6ljr・HFsO9）。窓内の入力は閉じると戻る仕様で、画面に残る下書きを持たないため画面離脱ガードの対象外',
  'app/line-notifications/page.tsx':
    '入力を端末の下書きへ随時保存し、閉じる確認はエディタ内で済ませる設計。画面離脱への警告は要検討',
  'app/nen-campaigns/nen-overview.tsx':
    '紹介文の下書きは大きな一覧コンポーネント内のローカル状態。親の番兵へ載せるには報告口が要るため別途検討',
  'app/reminders/detail/detail-v8.tsx':
    '登録者の基準日は行内の小さな編集で「基準日を保存」で確定する。detail/page.tsx の registrants-panel（番兵なし）と同じ画面の★V8版のため、同じ扱いでここに置く',
  'app/scenarios/detail/detail-v8.tsx':
    'scenario-detail-client.tsx（s1 手動保存で番兵なし）と同じ画面の★V8版。番兵の要否は元の画面と一緒に決めるため、同じ扱いでここに置く',
  'app/scenarios/mode/page.tsx':
    '★V7: 方式選択はラジオの即時確定で未保存を持たない。名前・フォルダ欄は新規時は確定時に同送、既存時は欄内の保存で確定する小さな操作のため番兵を付けない',
  'app/scenarios/mode-v8.tsx':
    'mode/page.tsx と同じ画面の★V8版。方式選択はラジオ＋主ボタンの確定式で、名前・フォルダ欄も既存時は欄内の保存で確定する。v7と同じ動きなので同じ扱い',
  'app/scenarios/first-step-v8.tsx':
    'first-step/page.tsx（s1 未判定）と同じ画面の★V8版。番兵の要否は元の画面と一緒に決めるため、同じ扱いでここに置く',
  'app/staff/page.tsx':
    '権限プレビューの「変更後の予定」。リンクは下書きを捨てて移る仕様として明示済み',
  'components/automations/automation-draft-editor.tsx':
    '自動化ウィザードの段内エディタ。下書きはサーバーへ保存し、離脱の扱いは app/automations/new/page.tsx と同じく別途検討',
  'components/scenarios/trigger-editor.tsx':
    'ダイアログ内の dirty。閉じると元に戻る仕様で、画面離脱ガードの対象外',
  'app/inflow-links/ad-integration.tsx':
    '費用の手入力はダイアログ内の dirty。閉じると元に戻る仕様で、画面離脱ガードの対象外',
  'components/shared/drawer.tsx':
    'dirty 印（*）を表示するだけの共通部品。編集画面ではない',
  'components/shared/dialog.tsx':
    '確認窓の共通部品。未保存の離脱確認では primaryAction="cancel" で残る方を主にする。窓自体は編集を持たない',
  'components/shared/confirm-dialog.tsx':
    '確認窓の共通部品。未保存の離脱確認では主が取消のとき印を付けない。窓自体は編集を持たない',
  'components/shared/overlay-utils.ts':
    '重なりの共通部品。初回フォーカスの寄せ先を呼出側で選べるだけで、編集を持たない',
  'components/shared/button.tsx':
    'ボタンの共通部品。開いた直後の標的用の ref を受けられるだけで、編集を持たない',
  'v8/settings/pools/create.tsx':
    'new/page.tsx（hq 未判定）と同じ画面の★V8版（前の app/pools/new/pool-new-v8.tsx を置き換えた）。作る前の一時入力だけで下書きを持たないため、番兵の要否は元の画面と一緒に決める',
  'app/form-submissions/page.tsx':
    '一覧と絞り込みが中心。作る操作は下書きを作って編集画面（GUARDED）へ渡すため、この画面に残る下書きを持たない',
  'app/inflow-links/page.tsx':
    '一覧の一括操作（移動・再開）は押した直後に即時保存し、下書きを持たない',
  'v8/automations/common-action-new.tsx':
    'app/common-actions/common-action-new-v8.tsx と同じ画面を src/v8 に一から書いたもの（j2hfkS）。番兵の要否は元の画面（new/page.tsx・s3 未判定）と一緒に決めるため、同じ扱いでここに置く',
  'v8/tags/field-migrate.tsx':
    'app/tags/field-migrate-v8.tsx と同じ項目移行画面を src/v8 に一から書いたもの（GobMd）。事前確認→明示実行の2段階で、途中離脱で失うのは確認状態だけ',
  'v8/tag-edit/edit.tsx':
    'タグの編集（xn95q）を src/v8 に一から書いたもの。元の画面（components/friend-fields/edit-tag-page-v4.tsx・s1 未判定）と同じ扱いで、番兵の要否は元の画面と一緒に決める',
  'app/tags/field-migrate-v8.tsx':
    '★V8 の項目移行画面（GobMd）。事前確認→明示実行の2段階で、途中離脱で失うのは確認状態だけ。離脱番兵の v7 同等画面（fields/migrate/page.tsx）と同じ扱い',
  'app/inflow-links/detail/page.tsx':
    '転送先の編集は保存ボタン確定式。下書き・dirty 管理がなく番兵の扱いは別途検討',
  'app/mileage/score-rules/page.tsx':
    '下書き保存式の編集画面。番兵の扱いは別途検討',
  'app/mileage/v8-score-tab.tsx':
    '★V8 の行動スコア一覧（IRPw8）。点数の変更・ルールの公開停止・できごとの除外は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。名前・できごとの検索欄は絞り込みで閉じると戻る',
  'components/friend-attributes-v2/tag-list-v2.tsx':
    '分類の変更は選んだ直後に即時保存し、下書きを持たない',
  'components/friend-fields/tags-page-v4.tsx':
    '一覧上の操作（表示切替・分類・並び替え）は押した直後に即時保存し、下書きを持たない',
  'app/tags/tags-tab-v8.tsx':
    'tags-page-v4.tsx と同じ一覧のV8版。一覧上の操作（表示切替・分類・並び替え）は押した直後に即時保存し、下書きを持たない',
  'app/tags/searches-v8.tsx':
    '★V8 の保存した検索一覧。詳細パネルの検索名はその場書き換えでEnter確定の即時保存、削除は確認窓で確定し、画面に残る下書きを持たない',
  'app/tags/fields-tab-v8.tsx':
    '★V8 の友だち情報欄一覧。詳細パネルの項目名はその場書き換えでEnter確定の即時保存、削除・フォルダ操作は確認窓か即時保存で確定し、画面に残る下書きを持たない',
  'app/booking/menus/page.tsx':
    '予約メニュー編集窓（Dialog）内の dirty。×・Esc・背景・キャンセルは窓内の破棄確認に集め、閉じると入力は戻る仕様で画面離脱ガードの対象外',
  'app/booking/staff/shifts/staff-detail-v8.tsx':
    '★V8 の勤務とシフト（d5fmnM・E3YDK・wvGke）。各段がそれぞれの「保存」「作る」「足す」でその場で確定し、画面に残る下書きを持たない。v7 の staff-detail.tsx と同じ構造（番兵は shifts/page.tsx 側の GUARDED 行が担保）',
  'components/inflow-links/site-script.tsx':
    'サイトの追加・編集・停止理由の入力はすべてDialog内。閉じると入力は戻る仕様で、画面離脱ガードの対象外',
  'app/restaurant-test/v8/organization.tsx':
    '★V8 の組織・権限（bSp4h）。restaurant-console.tsx（UNTRIAGED）と同じ画面のV8版。行内のフォームは保存ボタン確定式で下書きを持たず、番兵の要否は元の画面と一緒に決める',
  'app/conversions/conversion-points-v8.tsx':
    '★V8-B コンバージョンの一覧（r6dJFy）。探す欄・絞り込み・件数表示は一覧上の操作で下書きを持たない。止める小窓の理由欄は閉じると戻る小窓内の入力',
  'app/inflow-links/ad-integration-v8.tsx':
    '★V8-B 広告連携（qSTVR）。費用の手入力はダイアログ内の dirty。閉じると元に戻る仕様で、画面離脱ガードの対象外',
  'components/inflow-links/site-script-v8.tsx':
    '★V8-B サイトスクリプト（XjOte）。サイトの追加・編集の入力はすべてDialog内。閉じると入力は戻る仕様で、画面離脱ガードの対象外',
  'app/contents/vars/list-v8.tsx':
    '★V8 の共通情報一覧。一覧上の操作（停止・再開・差し替え・削除・フォルダ追加）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。窓内の理由欄は開く・閉じるときに戻るダイアログ内の入力',
  'app/contents/list-v8.tsx':
    '★V8 の登録メディア一覧（O7hUt7）。一覧上の操作（名前を変える・フォルダへ移す・アーカイブ・削除・フォルダ追加）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。名前・理由・移し先の入力は閉じると戻る札・窓の中だけ',
  'app/restaurant-test/v8/tables.tsx':
    '★V8-B の座席・卓管理（BERxg）。restaurant-console.tsx（UNTRIAGED）と同じ画面のV8版。卓の追加・変更は保存ボタン確定式で下書きを持たず、番兵の要否は元の画面と一緒に決める',
  'app/restaurant-test/v8/menu.tsx':
    '★V8-B のメニュー管理（MJoJR）。restaurant-console.tsx（UNTRIAGED）と同じ画面のV8版。メニューの追加・変更は保存ボタン確定式で下書きを持たず、番兵の要否は元の画面と一緒に決める',
  'app/restaurant-test/v8/inventory.tsx':
    '★V8-B の予約枠・在庫（Y8SjT2）。restaurant-console.tsx（UNTRIAGED）と同じ画面のV8版。配分の保存は保存ボタン確定式で下書きを持たず、番兵の要否は元の画面と一緒に決める',
  'app/events/bookings/bookings-v8.tsx':
    '★V8 のイベント予約者（gHmNK）。承認・キャンセル・待ち順の操作は確認窓で確定して即時保存し、お知らせ送信も「送る」で即時送信する。窓内の理由欄は閉じると戻るダイアログ内の入力で、画面に残る下書きを持たない',
  'app/webinars/list-v8.tsx':
    '★V8-B のウェビナー一覧（UyUMw）。一覧と絞り込みが中心で、フォルダの追加・変更・削除とアーカイブは押した直後に確認窓か即時保存で確定する。フォルダ名の入力は閉じると戻る窓の中だけなので、この画面に残る下書きを持たない',
  /* ★V8 の新しい画面（src/v8）。古い画面ファイルの理由をそのまま写した（2026-10-06）。 */
  'v8/broadcasts/list.tsx':
    '★V8 の一斉配信一覧（l5V9a）。一覧と絞り込みが中心。フォルダ・並び替え・保存した検索など一覧上の操作は押した直後に即時保存し、配信の作成は下書きを作って編集画面（GUARDED）へ渡すため、この画面に残る下書きを持たない',
  'v8/conversions/list.tsx':
    '★V8 のコンバージョンの一覧（r6dJFy）。探す欄・絞り込み・件数表示は一覧上の操作で下書きを持たない。止める小窓の理由欄は閉じると戻る小窓内の入力',
  'v8/scenarios/list.tsx':
    '★V8 のシナリオ一覧（axFrW）。一覧上の操作（停止・再開・フォルダ移動・並び替え・複製・削除）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。複製窓の名前欄は閉じると戻るダイアログ内の入力',
  'v8/auto-replies/list.tsx':
    '★V8 の自動応答一覧（uE9gf）。一覧上の操作（停止・再開・フォルダ移動・並び替え・複製・削除）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。止める窓の理由欄は閉じると戻るダイアログ内の入力',
  'v8/forms/list.tsx':
    '★V8 の回答フォーム一覧（I3L41O）。一覧上の操作（受付を止める・複製・削除・フォルダ移動）は押した直後に確認窓か即時保存で確定し、作る操作は下書きを作って編集画面へ渡すため、この画面に残る下書きを持たない。複製・名前の入力は閉じると戻る右のパネル・窓の中だけ',
  'v8/webinars/list.tsx':
    '★V8 のウェビナー一覧（UyUMw）。一覧と絞り込みが中心で、フォルダの追加・変更・削除とアーカイブは押した直後に確認窓か即時保存で確定する。フォルダ名の入力は閉じると戻る窓の中だけなので、この画面に残る下書きを持たない',
  'v8/webhooks/incoming.tsx':
    '★V8 外部連携・こちらで受け取る（gW0F2）。作る窓・合言葉窓・試す窓の入力は閉じると戻る窓の中だけで、保存は窓の中の「作る」「更新する」で確定する。一覧上の操作（動かす・止める・結び付ける・確認した・削除）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない',
  'v8/webhooks/outgoing.tsx':
    '★V8 外部連携・こちらから送る。一覧上の操作（動かす・止める）は押した直後に即時保存し、窓の中の入力は閉じると戻る。画面に残る下書きを持たない',
  'v8/analytics/cross.tsx':
    '★V8 分析のクロス集計。選ぶ欄は集計の条件で、結果の枡から対象者を作って友だち一覧・配信へ渡すだけ。保存する編集画面ではなく、画面に残る下書きを持たない',
  'v8/analytics/funnel.tsx':
    '★V8 分析のファネル。選ぶ欄は見る条件で、結果から対象者を作って友だち一覧・配信へ渡すだけ。保存する編集画面ではなく、画面に残る下書きを持たない',
  /* 2026-10-07：src/v8 に一から書いた画面の分類。元の画面ファイルがあるものはその扱いに合わせた。 */
  'v8/account-new/register.tsx':
    'app/accounts/new/register-v8.tsx と同じ画面の★V8版。dirty 管理は無く、印はコメント中の「未保存」（R523 の照合の説明）だけ。入力は端末の下書きへ随時保存し、閉じる確認は手順内の戻る・あとで続きからで済ませる',
  'v8/automations/create/create.tsx':
    'app/automations/new/new-v8.tsx と同じ画面の★V8版。サーバーへ下書き保存する多段入力で、段またぎ・店ごとの退避があり、離脱の扱いは元の画面と一緒に決めるため同じ扱い',
  'v8/reminders/detail.tsx':
    'app/reminders/detail/detail-v8.tsx と同じ画面の★V8版。登録者の基準日は行内の小さな編集で「基準日を保存」で確定する。元の画面と同じ扱い',
  'v8/settings/line-notifications/screen.tsx':
    'app/line-notifications/page.tsx と同じ画面の★V8版。入力を端末の下書きへ随時保存し、開き直すと復元する。閉じる確認はエディタ内で済ませる設計で、画面離脱への警告は元の画面と一緒に決める',
  'v8/settings/staff/staff.tsx':
    'app/staff/page.tsx と同じ画面の★V8版。dirty は権限プレビューの「変更後の予定」の印で、編集は右の窓の中。窓のリンクは下書きを捨てて移る仕様として明示済み',
  'components/accounts/account-ordering.tsx':
    '★V8 LINEアカウント一覧（src/v8/settings/accounts）の「並び順と親子を変える」窓の中身。並び替えは窓の中だけで、窓を閉じると保存前の並びは捨てて一覧を読み直す（v7 の一覧からは開かない）',
  'v8/accounts-detail/dialogs.tsx':
    '★V8 LINEアカウントの詳細から開く窓（送受信を止める・資格情報の差し替え・アーカイブ・登録の内容を編集）。入力はすべて窓の中で、閉じると戻る',
  'v8/affiliates/drawer.tsx':
    '★V8 アフィリエイターの詳細の引き出し（tnTn9）。支払いの取り決め3欄は引き出しの中の小さな欄で「取り決めを保存する」で確定し、引き出しを閉じると戻る',
  'v8/affiliates/offer-form.tsx':
    '★V8 案件を作る・編集する窓（app/affiliates/tabs.tsx の写し）。入力はすべて窓の中で、閉じると戻る',
  'v8/booking-staff/shifts.tsx':
    'app/booking/staff/shifts/staff-detail-v8.tsx と同じ画面の★V8版（d5fmnM・E3YDK・wvGke）。各段がそれぞれの「保存」「作る」「足す」でその場で確定する。元の画面と同じ扱い',
  'v8/broadcasts/quick-send.tsx':
    '★V8 一斉配信のかんたんに送る（P6vbxn）。小窓の中の入力で、閉じると戻る',
  'v8/common-vars/list.tsx':
    'app/contents/vars/list-v8.tsx と同じ一覧の★V8版。一覧上の操作は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。窓内の理由欄は閉じると戻る',
  'v8/contents/list.tsx':
    'app/contents/list-v8.tsx と同じ一覧の★V8版（O7hUt7）。一覧上の操作は押した直後に確認窓か即時保存で確定し、名前・理由・移し先の入力は閉じると戻る札・窓の中だけ',
  'v8/contents/media-detail-dialog.tsx':
    '★V8 登録メディアの詳細の窓（app/contents/media-detail-dialog.tsx の写し）。名前・差し替えの入力は窓の中で、閉じると戻る',
  'v8/events/bookings.tsx':
    'app/events/bookings/bookings-v8.tsx と同じ画面の★V8版（Mu8qW）。承認・キャンセル・待ち順は確認窓で確定して即時保存し、お知らせは「送る」で即時送信する。窓内の理由欄は閉じると戻る',
  'v8/friend-detail/dialogs.tsx':
    '★V8 友だち詳細の個別操作から開く2つの窓（対応状況を編集・シナリオに登録する）。入力は窓の中で、閉じると戻る',
  'v8/hq-templates/console.tsx':
    'app/hq/templates/template-console.tsx と同じ画面の★V8版。多段の作る・配る流れで、段の途中離脱の扱いは元の画面と一緒に決めるため同じ扱い',
  'v8/hq/account-dialogs.tsx':
    'app/hq/account-settings-dialogs.tsx と同じ3つの窓の★V8版（HMpVx・D6ljr・HFsO9）。窓内の入力は閉じると戻り、画面に残る下書きを持たない',
  'v8/hq/home.tsx':
    'app/hq/account-browser-v8.tsx と同じ画面の★V8版（JKjsE）。タグ名だけの小さな窓と一覧上の絞り込みで、閉じると入力を破棄する',
  'v8/inflow-links/ads.tsx':
    'app/inflow-links/ad-integration-v8.tsx と同じ画面の★V8版（qSTVR）。費用の手入力は窓（ZxKL5）の中で、閉じると戻る',
  'v8/inflow-links/detail.tsx':
    'app/inflow-links/detail/page.tsx と同じ画面の★V8版（Q5le3）。リンクの編集は窓の中の保存で確定し、ほかの欄は読み取り専用のURL・絞り込み・件数',
  'v8/inflow-links/site-script.tsx':
    'components/inflow-links/site-script-v8.tsx と同じ画面の★V8版（XjOte）。サイトの追加・編集の入力はすべて窓の中で、閉じると戻る',
  'v8/nen-posts/policy-history.tsx':
    'app/nen-members/photo-policy-history-v8.tsx と同じ小さな窓の★V8版。親の設定画面から開き、閉じれば保存前の値を破棄する',
  'v8/ops/support.tsx':
    '★V8 運営のお問い合わせ（受信箱型）。返信欄は問い合わせごとの下書きで「下書きを保存する」でサーバへ残し、開き直すと読み戻す。起票は窓の中。問い合わせの切り替えが画面内のため、離脱の扱いは元の画面（app/ops/support/page.tsx・未判定）と一緒に決める',
  'v8/restaurant/menu/menu.tsx':
    'app/restaurant-test/v8/menu.tsx と同じ画面の★V8版（MJoJR）。メニューの追加・変更は窓（NkmwU）の中で、閉じると戻る',
  'v8/restaurant/organization/organization.tsx':
    'app/restaurant-test/v8/organization.tsx と同じ画面の★V8版（bSp4h）。店舗・ユーザーの追加と変更は窓の中で、ログインとの連携も窓の中の「ログインと連携」で確定する',
  'v8/restaurant/tables/tables.tsx':
    'app/restaurant-test/v8/tables.tsx と同じ画面の★V8版（BERxg）。卓の追加・変更は窓（gBrCz）の中で、閉じると戻る',
  'v8/scenario-first-step/first-step.tsx':
    'app/scenarios/first-step-v8.tsx と同じ画面の★V8版（V6xAo）。番兵の要否は元の画面（first-step/page.tsx・未判定）と一緒に決めるため同じ扱い',
  'v8/tags/tags-tab.tsx':
    'app/tags/tags-tab-v8.tsx と同じ一覧の★V8版（I1E7Bt）。一覧上の操作（表示切替・分類・並び替え）は押した直後に即時保存し、フォルダの窓は閉じると戻る',
  'v8/templates/list.tsx':
    '★V8 のテンプレート一覧（v19Ivv）。一覧上の操作（フォルダ移動・複製・削除・まとめて操作）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。種類を選ぶ窓は行き先を選ぶだけ',
  'v8/nen-pets/editor.tsx':
    'app/nen/pets/pet-editor.tsx と同じ窓の★V8版（eLjeQ）。入力はすべて窓の中で、閉じると戻る。番兵の要否は元の窓（未判定）と一緒に決めるため同じ扱い',
}

/*
 * もう描かれない古い画面ファイル（入口は src/v8 の新しい画面か、別の画面を出す）。
 * ファイルは切り替えの日まで残るので、探すと見つかる。見張っても意味が無いので探す対象から外す。
 * 切り替えの日にファイルと一緒にここから消す（2026-10-06 に GUARDED・EXEMPTIONS・UNTRIAGED から移した）。
 * 2026-10-07：載っていた11本はどの入口からも描かれないので消した（外付けSSDの lh-archive-20261007/repo-code に写しあり）。
 * account-ordering.tsx は V8 の LINE アカウント一覧の窓から開くようになったので、ここから EXEMPTIONS へ移した。
 */
const NOT_RENDERED: Record<string, string> = {
}

/*
 * V6R-S0-c: 「dirty を持たない編集画面」も網に入れる。
 *
 * 上の DIRTY_SIGNATURE は、変更の有無を名前や文言で持つ画面しか拾えない。
 * 変更の有無そのものを持たない編集画面（一斉配信の作成・テンプレート編集など）は、
 * 番兵が無くてもこの試験を通っていた。そこで「保存の口」と「入力欄3つ以上」を持つ
 * 画面を編集画面とみなし、分類を求める。
 */
const EDITOR_SAVE_SIGNATURE = /(?:\bapi(?:\.[A-Za-z]+)+|\b[a-z][A-Za-z]*Api)\.(?:create|update|save|patch|upsert)[A-Za-z]*\(/
const EDITOR_INPUT_SIGNATURE = /<(input|textarea|TextField|TextArea|Select|DateField|DateTimeField|TimeField)\b/g
const EDITOR_MIN_INPUTS = 3

/*
 * 編集画面の印はあるが、番兵が要るかをまだ決めていないもの（2026-09-23 時点の棚卸し）。
 * 担当レーンが「GUARDED へ移す」か「理由を書いて EXEMPTIONS へ移す」を決め、ここから消す。
 * **ここへの追加は禁止。** 新しい編集画面は最初から GUARDED か EXEMPTIONS に入れる。
 */
const UNTRIAGED: Record<string, string> = {
  'app/affiliates/tabs.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/analytics/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/auto-replies/publish/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/booking/bookings/detail/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  /* 予約設定V8化でスタッフ編集窓を staff-edit-dialog.tsx へ切り出し、page.tsx から編集画面の印が無くなったので行を消した。 */
  'app/broadcasts/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/chats/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/common-actions/new/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/media-detail-dialog.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/contents/vars/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/events/bookings/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/friends/detail/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  /* ★V7: 書き出し項目を共通 Checkbox へ寄せたら入力の印が3未満になり、編集画面の印が無くなったので行を消した。 */
  'app/hq/support/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/inflow-links/_components/edit-route-modal.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'v8/inflow-links/edit-route-dialog.tsx':
    's3: 上の edit-route-modal.tsx の ★V8 の写し（src/v8/inflow-links/list.tsx から開く）。元と一緒に決める',
  'app/nen/pets/pet-editor.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/ops/support/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/pools/new/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/pools/page.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/restaurant-test/restaurant-console.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/scenarios/detail/scenario-detail-client.tsx':
    's1: シナリオ詳細。手動保存で番兵なし。V6R-S1-d（board#1065）で付ける',
  'app/scenarios/first-step/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/tags/fields/migrate/page.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/templates/page.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/templates/list-v8.tsx':
    '★V8 のテンプレート一覧（v19Ivv）。一覧上の操作（フォルダ移動・複製・削除・まとめて操作）は押した直後に確認窓か即時保存で確定し、画面に残る下書きを持たない。種類を選ぶ窓は行き先を選ぶだけ',
  'app/templates/template-asset-editor.tsx':
    's2: テンプレート編集の本体（app/templates/edit から載る）。V6R-S2-a（board#1066）で付ける',
  'app/webhooks/edit/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'app/webhooks/page.tsx':
    's3: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/accounts/account-edit-modal.tsx':
    'hq: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/auto-replies/edit-dialog.tsx':
    's2: 自動応答の編集。共通ダイアログは背景クリックとEscで閉じる。V6R-S2-a（board#1066）で付ける',
  'components/broadcasts/broadcast-asset-manager.tsx':
    's2: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friend-fields/edit-tag-page-v4.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friend-fields/support-mark-rules-panel.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friends/advanced-search-dialog.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/friends/single-friend-actions.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
  'components/scenarios/action-editor.tsx':
    's1: 未判定。番兵が要る長い編集か、閉じれば戻る小さな操作かを担当が決める',
}

/*
 * 探す場所。V8 の新しい画面は src/v8 に一から書く（2026-10-06〜）。入口が `@/v8/...` を
 * 出すようになったので、ここも探す。古い画面ファイル（もう描かれないもの）は表から外した。
 */
const SCAN_ROOTS = ['app', 'components', 'v8'] as const

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* tsxFiles(path)
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      yield path
    }
  }
}

function dirtyTrackingFiles(): string[] {
  const found: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const path of tsxFiles(join(SRC, root))) {
      const file = path.slice(SRC.length + 1)
      if (file in NOT_RENDERED) continue
      if (DIRTY_SIGNATURE.test(readFileSync(path, 'utf8'))) {
        found.push(file)
      }
    }
  }
  return found.sort()
}

function editorFiles(): string[] {
  const found: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const path of tsxFiles(join(SRC, root))) {
      if (path.slice(SRC.length + 1) in NOT_RENDERED) continue
      const source = readFileSync(path, 'utf8')
      if (DIRTY_SIGNATURE.test(source)) continue
      if (!EDITOR_SAVE_SIGNATURE.test(source)) continue
      if ((source.match(EDITOR_INPUT_SIGNATURE) ?? []).length < EDITOR_MIN_INPUTS) continue
      found.push(path.slice(SRC.length + 1))
    }
  }
  return found.sort()
}

describe('未保存の編集がある画面は離脱の番兵を持つ契約（DETAIL-04系）', () => {
  it('dirty を持つ画面は「番兵あり／親が持つ／理由つき対象外」のどれかへ分類されている', () => {
    const classified = new Set([...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS)])
    const unclassified = dirtyTrackingFiles().filter((file) => !classified.has(file))
    expect(
      unclassified,
      '未保存の編集状態を持つ画面が未分類です。useUnsavedGuard を付けて GUARDED へ、' +
        'または理由を書いて EXEMPTIONS へ追加してください（unsaved-guard-wiring-contract.test.ts）',
    ).toEqual([])
  })

  /*
   * 画面の守りを共有フック（同じフォルダの use-*.ts）へ寄せた画面は、
   * フックの中身も合わせて1つの画面として見る。
   */
  function screenSources(file: string): string {
    const dir = dirname(join(SRC, file))
    const hooks = readdirSync(dir)
      .filter((name) => /^use-[^/]+\.ts$/.test(name) && !name.includes('.test.'))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
    return [readUiSource(join(SRC, file), 'utf8'), ...hooks].join('\n')
  }

  it('番兵を持つ画面は共通フックと離脱確認ダイアログを配線している', () => {
    for (const file of GUARDED) {
      const source = screenSources(file)
      expect(source, file).toContain('useUnsavedGuard(')
      expect(source, `${file} の離脱確認`).toContain('leaveTarget !== null')
    }
  })

  it('親へ dirty を報告する画面の親は、共通フックで番兵を持っている', () => {
    for (const [file, parent] of Object.entries(COVERED_BY_PARENT)) {
      const parentSource = screenSources(parent)
      expect(parentSource, `${file} の番兵を持つ親 ${parent}`).toContain('useUnsavedGuard(')
    }
  })

  it('分類表に載せたファイルは実在し、対象外には理由がある', () => {
    for (const file of [...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS)]) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} が見つかりません`).not.toThrow()
    }
    for (const [file, reason] of Object.entries(EXEMPTIONS)) {
      expect(reason.length, `${file} の対象外理由`).toBeGreaterThan(0)
    }
    for (const file of Object.keys(NOT_RENDERED)) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} は消えたので NOT_RENDERED から消す`).not.toThrow()
    }
  })

  it('dirty を持たない編集画面も、分類か未判定の一覧のどちらかに載っている（V6R-S0-c）', () => {
    const known = new Set([
      ...GUARDED, ...Object.keys(COVERED_BY_PARENT), ...Object.keys(EXEMPTIONS), ...Object.keys(UNTRIAGED),
    ])
    const unclassified = editorFiles().filter((file) => !known.has(file))
    expect(
      unclassified,
      '保存の口と入力欄を持つ編集画面が未分類です。useUnsavedGuard を付けて GUARDED へ、' +
        'または理由を書いて EXEMPTIONS へ追加してください（UNTRIAGED への追加は禁止）',
    ).toEqual([])
  })

  it('未判定の一覧は、まだ番兵が無く・まだ編集画面の印を持つものだけ（直したら一覧から消す）', () => {
    const editors = new Set(editorFiles())
    for (const file of Object.keys(UNTRIAGED)) {
      const source = readFileSync(join(SRC, file), 'utf8')
      expect(source.includes('useUnsavedGuard('), `${file} は番兵が付いたので GUARDED へ移す`).toBe(false)
      expect(editors.has(file), `${file} はもう編集画面の印が無いので UNTRIAGED から消す`).toBe(true)
    }
  })
})
