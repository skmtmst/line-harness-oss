import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Node用の静的検査を、実際のソースと同じ入口で試す
import { sourceFiles, globalTokens, resolveValue, cssShapeCandidates, classShapeCandidates, v8Sources } from '../../../scripts/card-shape-contract.mjs'

const SRC = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(file, 'utf8')
const tokens = globalTokens(read(resolve(SRC, 'app/globals.css')))
type Candidate = { file: string; selector: string }
const key = ({ file, selector }: Candidate) => `${file} ${selector}`

// B-168: ファイル全体・名前のパターンでは免除しない。該当する規則だけ。
// 新しい箱はここを足さず、共通の Card / content-card の形を使う。
const EXCEPTIONS: [file: string, selector: string, reason: string][] = [
  ["components/shared/combobox.module.css", ".popup", "開いた入力欄の選ぶ面。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/date-field.module.css", ".popover", "開いた入力欄の選ぶ面。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/date-time-field.module.css", ".popover", "開いた入力欄の選ぶ面。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/multi-select.module.css", ".popup", "開いた入力欄の選ぶ面。浮く面の影を使い、カードの影を重ねない。"],
  ["app/accounts/new/register-v8.module.css", ".checkList", "設定項目の一覧の外枠。行で区切り、影を重ねない。"],
  ["app/affiliates/create-v8.css", ".af-create-choiceCard", "申込方法の選択肢。内容をまとめるカードではない。"],
  ["app/affiliates/list-v8.css", ".af-list-tableWrap", "一覧表を切り取る枠。表の外側に影を重ねない。"],
  ["app/affiliates/list-v8.css", ".af-list-stateWrap", "一覧表の空・待機状態。表の枠と同じ形を保つ。"],
  ["app/analytics/readonly-v8.css", "[data-theme='v8'] .v8-ro-analytics-funnelFlow, [data-theme='v8'] .v8-ro-analytics-funnelSelected", "閲覧のみのファネル図の入れ子と選択枠。カードにしない。"],
  ["app/auto-replies/publish/publish.css", ".arp-stickyBar", "保存の追従帯。浮く帯の影を使い、カードの影を重ねない。"],
  ["app/automations/new/new-automation.module.css", ".summaryBar", "現在の設定を示す数の帯。カードの影を付けない。"],
  ["app/friend-add-settings/friend-add-rule-editor.css", ".friend-add-editor-dialog", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["app/hq/readonly-v8.css", "[data-theme='v8'] .v8-ro-hq-page .v8-ro-hq-tiles[data-ro-kpis] [data-design-version]", "閲覧のみの数の帯。数値のまとまりで、内容のカードではない。"],
  ["app/mileage/earning-rules/new/v8-create-form.module.css", ".choice", "獲得方法を選ぶ入力。選択枠で区別する。"],
  ["app/nen/pets/pets-v8.module.css", ".dialog", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["app/reminders/wizard-v8.module.css", ".choice", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["app/reminders/wizard-v8.module.css", ".addStep", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["components/friend-fields/tag-csv-import-dialog.module.css", ".panel", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/friend-fields/tag-csv-import-dialog.module.css", ".summary", "取り込む件数の数の帯。影を重ねない。"],
  ["components/friend-fields/tag-csv-import-dialog.module.css", ".tableFrame", "取り込み内容の表の枠。影を重ねない。"],
  ["components/hq/account-menu.module.css", ".menu", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/account-switch-menu.module.css", ".panel", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/action-menu.module.css", ".menu", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/check-card.module.css", ".card", "複数選択の入力欄。枠は選択状態を示す。"],
  ["components/shared/check-card.module.css", "[data-theme='v8'] .card", "複数選択の入力欄。枠は選択状態を示す。"],
  ["components/shared/command-palette.module.css", ".panel", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/data-table.module.css", "[data-theme='v8'] .frame[data-table-presentation='account-list'], [data-theme='v8'] .frame[data-table-presentation='account-handover']", "アカウント一覧と乗り換えの表の枠。影を重ねない。"],
  ["components/shared/file-drop.module.css", ".zone", "ファイルを落とす入力欄。内容のカードではない。"],
  ["components/shared/file-drop.module.css", ".row", "選んだファイルの入力行。外側の入力欄と影を重ねない。"],
  ["components/shared/layout-picker.module.css", ".tile", "面の分け方の選択肢。選択枠で区別する。"],
  ["components/shared/line-preview.module.css", ".flat", "LINEに届く内容の見本。管理画面のカードの影は付けない。"],
  ["components/shared/media-slot.module.css", ".frame", "画像を入れる入力欄。内容のカードではない。"],
  ["components/shared/message-composer.module.css", ".bubble", "メッセージ本文の入力欄。内容のカードではない。"],
  ["components/shared/multi-select.module.css", ".overflow", "選びきれない札を表示する副ボタン。カードではない。"],
  ["components/shared/notification-panel.module.css", ".panel", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/radio-card.module.css", ".card", "一つを選ぶ入力欄。枠は選択状態を示す。"],
  ["components/shared/radio-card.module.css", "[data-theme='v8'] .card", "一つを選ぶ入力欄。枠は選択状態を示す。"],
  ["components/shared/seat-tile.module.css", ".map", "席を選ぶ入力。枠は選択状態を示す。"],
  ["components/shared/select-menu.module.css", ".surface", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/source-picker-dialog.module.css", ".selectedRow", "選ぶ窓の中の仮選択行。入れ子に影を重ねない。"],
  ["components/shared/sticky-bar.module.css", ".bar", "保存の追従帯。V8の帯は別の影を持つ。"],
  ["components/shared/tap-area-editor.module.css", ".frame", "押したら行うことの入れ子の編集欄。影を重ねない。"],
  ["components/shared/time-field-v8.module.css", ".panel", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["components/shared/toast.module.css", ".toast", "一時的な知らせ。知らせ専用の影を保つ。"],
  ["components/shared/toast.module.css", "[data-theme='v8'] .toast", "一時的な知らせ。知らせ専用の影を保つ。"],
  ["v8/account-new/register.module.css", ".checkList", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/analytics/analytics.module.css", ".table", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/analytics/analytics.module.css", ".reportTable", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/analytics/analytics.module.css", ".waitBox", "警告・閲覧のみ・状態・待機の帯。線で区別する。"],
  ["v8/friends/compare/compare.module.css", ".panel, .historyCard", "値を決めるカード内の判定欄と履歴の小箱。入れ子に影を重ねない。"],
  ["v8/booking-menus/menu-form.module.css", ".subSection", "カード内の小箱・入れ子・階層の行。影を重ねない。"],
  ["v8/broadcast-detail/detail.module.css", ".linkList", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/broadcast-detail/detail.module.css", ".approval", "警告・閲覧のみ・状態・待機の帯。線で区別する。"],
  ["v8/broadcasts/list.module.css", ".datePopover", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["v8/conversions/list.module.css", ".tableWrap", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/form-edit/edit.module.css", ".blockOpenCard", "カード内の小箱・入れ子・階層の行。影を重ねない。"],
  ["v8/form-edit/edit.module.css", ".subBox", "カード内の小箱・入れ子・階層の行。影を重ねない。"],
  ["v8/friends/list/list.module.css", ".columnsMenu", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["v8/hq-broadcasts/create.module.css", ".checkEmpty", "未選択の入力欄。破線は空の状態を示す。"],
  ["v8/hq-broadcasts/create.module.css", ".notYet", "入力が未設定の注意帯。カードではない。"],
  ["v8/hq-templates/console.module.css", ".tableBox", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/hq-templates/folder-distribution-dialog.module.css", ".list", "配る窓の中のアカウント一覧の枠。影を重ねない。"],
  ["v8/inbox-chat/inbox-chat.module.css", ".pop", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["v8/inbox-chat/inbox-chat.module.css", ".inputBox", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["v8/inbox-chat/inbox-chat.module.css", ".attachPop", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["v8/inflow-links/ad-pages.module.css", ".table", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/inflow-links/list.module.css", ".presetPanel", "開いたメニュー・選ぶ欄。浮く面の影を使い、カードの影を重ねない。"],
  ["v8/inflow-links/qr-dialog.module.css", ".qr", "札・印・画像・端末の見本。カードの影を付けない。"],
  ["v8/nen-posts/review.module.css", ".tableWrap", "投稿の公開記録を表示する表の枠。影を重ねない。"],
  ["v8/ops/auth.module.css", ".digit", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["v8/restaurant/closures/closures.module.css", ".grid", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/rich-menus/connections.module.css", ".menu", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["v8/scenarios/results.module.css", ".kpiBox", "数の帯。B-153に従い線で区切る。"],
  ["v8/scenarios/results.module.css", ".stepList", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/scenarios/results.module.css", ".table", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/settings/accounts/accounts.module.css", ".table", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/settings/getting-started/getting-started.module.css", ".steps", "表・一覧の行。外側のカードと影を重ねない。"],
  ["v8/templates/question-new.module.css", ".choice", "入力欄・補助操作・選択肢。中身のカードではない。"],
  ["app/accounts/migration.tsx", "className=\"bg-canvas rounded-card border-hairline border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/affiliates/action-dialogs.tsx", "className=\"flex w-full flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-overlay\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["app/affiliates/attribution-view.tsx", "className=\"bg-canvas border-hairline mt-2 overflow-x-auto rounded-card border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/affiliates/tabs.tsx", "className=\"bg-canvas rounded-card border-hairline flex flex-wrap items-center gap-2 border p-3\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["app/affiliates/tabs.tsx", "className=\"bg-canvas rounded-card border-hairline border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/affiliates/tabs.tsx", "className=\"bg-canvas rounded-card border-hairline overflow-x-auto border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/affiliates/tabs.tsx", "className=\"rounded-card border-hairline bg-canvas border p-4\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/affiliates/tabs.tsx", "className=\"bg-canvas rounded-card border-hairline mt-3 flex flex-wrap items-center gap-3 border p-3\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["app/broadcasts/detail/broadcast-recipients.tsx", "className=\"bg-canvas rounded-card border-hairline border p-5\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/common-actions/branch-editor.tsx", "className=\"border-hairline bg-canvas-sunken mt-3 rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/contents/media-detail-dialog.tsx", "className=\"bg-canvas-sunken rounded-card flex min-h-96 items-center justify-center overflow-hidden border border-hairline\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/contents/media-upload-dialog.tsx", "className=\"border-hairline max-h-screen w-full max-w-2xl overflow-y-auto rounded-card border bg-canvas shadow-float\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["app/emergency/send-path-coverage-panel.tsx", "className=\"border-hairline rounded-card border bg-canvas px-4 py-3 text-xs text-ink-faint\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/events/change-review/change-review-v8.tsx", "className=\"text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/events/new/events-new-v8.tsx", "className=\"bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/nen-members/photo-review-detail.tsx", "className=\"mt-4 rounded-card border border-hairline bg-canvas p-4\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/nen/health/summary-drawer.tsx", "className=\"rounded-card border border-hairline bg-canvas p-3\"", "数の帯のマス。B-153に従い線で区切る。"],
  ["app/nen/pets/pets-tab.tsx", "className=\"divide-hairline divide-y rounded-card border-hairline border bg-canvas md:hidden\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/restaurant-test/google/google-business.tsx", "className=\"border-hairline bg-canvas text-ink min-w-0 overflow-hidden rounded-card border\"", "画面全体の外枠。内側の中身のカードにだけ影を付ける。"],
  ["app/restaurant-test/google/google-business.tsx", "className=\"border-hairline mb-3 rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/restaurant-test/google/google-posts.tsx", "className=\"border-hairline rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/restaurant-test/google/google-profile.tsx", "className=\"border-hairline bg-accent-soft flex flex-col gap-4 rounded-card border p-5\"", "今日の営業状態の帯。カードではなく状態の通知。"],
  ["app/restaurant-test/google/google-profile.tsx", "className=\"border-hairline bg-canvas flex w-full flex-col gap-2 rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/restaurant-test/google/google-profile.tsx", "className=\"border-hairline bg-canvas flex min-w-0 flex-col gap-3 rounded-card border p-5\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/restaurant-test/google/google-profile.tsx", "className=\"border-hairline overflow-hidden rounded-card border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["app/restaurant-test/google/google-profile.tsx", "className=\"border-hairline bg-canvas flex flex-col gap-3 rounded-card border p-5\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/scenarios/detail/detail-v8.tsx", "className={editingStepId ? '' : 'border-hairline rounded-card bg-canvas-sunken border p-4'}", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/scenarios/detail/detail-v8.tsx", "className=\"border-hairline rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["app/tags/edit-field-page-v8.tsx", "className=\"rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/tags/search-editor-v8.tsx", "className=\"rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/templates/staff-asset-list.tsx", "className=\"bg-canvas border-hairline text-ink-faint col-span-full rounded-card border border-dashed p-12 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["app/webhooks/outgoing-v8.tsx", "className=\"overflow-x-auto rounded-card border border-hairline bg-canvas\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["components/automations/common-action-editor.tsx", "className=\"border-hairline rounded-card border bg-canvas p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/broadcasts/broadcast-approval.tsx", "className=\"bg-warning-bg rounded-card border-hairline border p-5\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/broadcasts/broadcast-form.tsx", "className=\"border-hairline mt-4 rounded-card border bg-canvas p-5\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/broadcasts/broadcast-form.tsx", "className=\"rounded-card border border-hairline bg-canvas p-8 text-center\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/broadcasts/broadcast-form.tsx", "className=\"bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/broadcasts/broadcast-form.tsx", "className=\"border-hairline bg-canvas-sunken text-ink-secondary mt-3 rounded-card border px-4 py-2 text-xs\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/broadcasts/broadcast-step-rail.tsx", "className=\"border-hairline bg-canvas rounded-card mb-4 border p-4 sm:hidden\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/broadcasts/segment-preset-controls.tsx", "className=\"divide-y divide-hairline rounded-card border border-hairline bg-canvas\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["components/dashboard/dashboard-editor.tsx", "className=\"border-hairline bg-canvas-sunken rounded-card border p-3\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/events/event-wizard.tsx", "className=\"bg-canvas rounded-card border-hairline border p-12 text-center text-sm text-ink-faint\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/events/event-wizard.tsx", "className=\"bg-canvas rounded-card border-hairline mb-4 flex flex-col gap-2 border p-4 sm:flex-row\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/events/event-wizard.tsx", "className=\"text-ink-faint border-hairline rounded-card border border-dashed p-6 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/forms/block-editor.tsx", "className={`rounded-card border p-4 transition-colors ${ selected ? 'border-accent bg-canvas' : 'border-hairline bg-canvas' }`}", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/forms/form-preview.tsx", "className=\"rounded-card border-hairline border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/forms/hq-form-definition-editor.tsx", "className=\"rounded-card border border-dashed border-hairline bg-canvas p-8 text-center text-sm text-ink-faint\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/friend-fields/mark-list.tsx", "className={`flex max-h-[calc(100dvh-2rem)] w-full ${v8 ? 'max-w-xl' : 'max-w-[680px]'} flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-overlay`}", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/friend-fields/saved-search-list.tsx", "className=\"bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/friend-fields/tag-editor-v4.tsx", "className=\"relative w-full max-w-[670px] -translate-y-7 rounded-card border border-hairline bg-canvas p-7 shadow-overlay\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/friend-fields/tags-page-v4.tsx", "className=\"relative w-full max-w-[670px] -translate-y-5 rounded-card border border-hairline bg-canvas p-7 shadow-overlay\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/friends/saved-search-dialog.tsx", "className=\"mt-4 rounded-card border border-hairline bg-surface-pearl p-4\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/friends/single-friend-actions.tsx", "className=\"bg-canvas rounded-card border-hairline mt-2 border p-3\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/rich-menus/rich-menu-create-form.tsx", "className=\"border-hairline rounded-card space-y-4 border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/rich-menus/rich-menu-create-form.tsx", "className=\"border-hairline bg-canvas-sunken rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/scenarios/action-editor.tsx", "className=\"border-hairline rounded-card border\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/scenarios/action-editor.tsx", "className=\"text-ink-faint rounded-card border-hairline border border-dashed py-8 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/scenarios/carousel-picker.tsx", "className=\"border-hairline rounded-card border border-dashed px-4 py-6 text-center\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/scenarios/insert-toolbar.tsx", "className=\"border-hairline rounded-card bg-canvas max-h-64 w-64 overflow-y-auto border shadow-float\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/scenarios/insert-toolbar.tsx", "className=\"border-hairline rounded-card bg-canvas w-72 border p-3 shadow-float\"", "開いた窓・メニュー。浮く面の影を使い、カードの影を重ねない。"],
  ["components/scenarios/message-kind-fields.tsx", "className={(`rounded-card border p-1.5 transition-colors ${ on ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken' }`) + ' h-auto whitespace-normal'}", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/scenarios/question-editor.tsx", "className=\"border-hairline rounded-card border\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/scenarios/step-preview.tsx", "className=\"border-hairline rounded-card text-ink-faint border border-dashed px-3 py-6 text-center text-micro\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["components/scenarios/trigger-editor.tsx", "className=\"border-hairline rounded-card flex flex-wrap items-center justify-between gap-2 border px-4 py-3\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/shared/condition-builder.tsx", "className=\"border-hairline bg-canvas rounded-card flex flex-wrap items-start gap-2 border p-3\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/shared/condition-builder.tsx", "className=\"border-hairline rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/shared/create-page.tsx", "className={`${styles.choice} rounded-card border p-3 text-left transition-colors ${ selected ? 'border-accent bg-accent-soft' : 'border-hairline hover:bg-canvas-sunken' }`}", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/shared/stepper.tsx", "className=\"border-hairline bg-canvas rounded-card mb-4 border p-4\"", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/shared/version-history.tsx", "className={ active ? 'rounded-card border border-accent bg-canvas' : 'rounded-card border border-hairline bg-canvas' }", "絞り込み・段の切り替え・選択の枠。中身のカードではない。"],
  ["components/staff/login-audit.tsx", "className=\"overflow-hidden rounded-card border border-hairline bg-canvas\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["components/staff/login-audit.tsx", "className=\"flex h-28 flex-col gap-1 rounded-card border border-hairline bg-canvas p-4\"", "数の帯のマス。B-153に従い線で区切る。"],
  ["components/templates/message-template-editor.tsx", "className=\"border-hairline rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["components/webinars/webinar-form.tsx", "className=\"group rounded-card border border-hairline bg-canvas-sunken/60\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/affiliates/attribution-view.tsx", "className=\"bg-canvas border-hairline mt-2 overflow-x-auto rounded-card border\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["v8/automations/branch-editor.tsx", "className=\"border-hairline bg-canvas-sunken mt-3 rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/contents/media-detail-dialog.tsx", "className=\"bg-canvas-sunken rounded-card flex min-h-96 items-center justify-center overflow-hidden border border-hairline\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/nen-posts/detail.tsx", "className=\"mt-4 rounded-card border border-hairline bg-canvas p-4\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
  ["v8/scenario-detail/detail.tsx", "className={editingStepId ? '' : 'border-hairline rounded-card bg-canvas-sunken border p-4'}", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/scenario-detail/detail.tsx", "className=\"border-hairline rounded-card border p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/settings/staff/staff.tsx", "className=\"rounded-card border border-hairline bg-canvas p-4\"", "カード内の小箱・入力のまとまり・内容の見本。影を重ねない。"],
  ["v8/settings/staff/staff.tsx", "className=\"mt-2 divide-y divide-hairline overflow-hidden rounded-card border border-hairline\"", "表・履歴・一覧の器。内容は行で区切り、影は重ねない。"],
  ["v8/templates/staff-asset-list.tsx", "className=\"bg-canvas border-hairline text-ink-faint col-span-full rounded-card border border-dashed p-12 text-center text-sm\"", "未取得・未選択・空の状態・警告。線とメッセージで区別する。"],
]

function candidates(): Candidate[] {
  const files: string[] = sourceFiles(SRC)
  // *.module.css だけでなく通常のCSS・globals.cssの部品規則も読む。
  const css = files.filter(file => file.endsWith('.css')).flatMap(file =>
    cssShapeCandidates(read(file), tokens).map((selector: string) => ({ file: relative(SRC, file), selector })))
  const classes = (v8Sources(SRC, files) as string[]).flatMap(file =>
    classShapeCandidates(read(file), tokens).map((selector: string) => ({ file: relative(SRC, file), selector })))
  return [...css, ...classes]
}

const all = candidates()

describe('B-168 カードの角丸・枠・影', () => {
  it('カードの角丸と枠を持つ規則には共通の影がある（理由つきの非カードだけ除外）', () => {
    const permitted = new Set(EXCEPTIONS.map(([file, selector]) => key({ file, selector })))
    const missing = all.filter(candidate => !permitted.has(key(candidate)))
    expect(missing, 'Card / content-card の共通の縁と影を使ってください').toEqual([])
  })

  it('例外にはファイル・規則・理由があり、不要になった例外を残さない', () => {
    const found = new Set(all.map(key))
    const keys = EXCEPTIONS.map(([file, selector]) => key({ file, selector }))
    expect(new Set(keys).size).toBe(keys.length)
    expect(EXCEPTIONS.every(([file, selector, reason]) => file && selector && reason.length > 10)).toBe(true)
    expect(keys.filter(entry => !found.has(entry)), '影を付けた規則や消した規則の例外は外してください').toEqual([])
  })

  it('globalsの変数の連鎖・V8の上書き・フォールバックを解く（循環では止まる）', () => {
    const vars = globalTokens(`@theme { --radius-card: 8px; --alias: var(--radius-card); }
      [data-theme="v8"] { --radius-card: 12px; }
      .component { --radius-card: 3px; }`)
    expect(resolveValue('var(--alias)', vars)).toBe('12px')
    expect(resolveValue('var(--missing, var(--alias))', vars)).toBe('12px')
    expect(resolveValue('var(--a)', new Map([['--a', 'var(--b)'], ['--b', 'var(--a)']]))).toBe('var(--a)')
  })

  it.each(['12px', 'var(--radius-card)', 'var(--tpl-htn-radius-l)', 'var(--missing, var(--radius-card))'])('角丸 %s と枠だけの新しいカードを検出する', radius => {
    expect(cssShapeCandidates(`.newCard { border-radius: ${radius}; border: 1px solid var(--color-hairline); }`, tokens)).toEqual(['.newCard'])
  })

  it('ringのみ・none・別の薄い影・分割した影の取り消しも検出する', () => {
    for (const shadow of ['var(--tpl-fe-ring)', 'none', 'var(--control-shadow)', 'var(--shadow-card)']) {
      expect(cssShapeCandidates(`@media (min-width: 1000px) { .newCard { border-radius: var(--radius-card); border: 1px solid var(--color-hairline); box-shadow: ${shadow}; } }`, tokens)).toEqual(['.newCard'])
    }
    expect(cssShapeCandidates(`.newCard { border-radius: 12px; border: 1px solid var(--color-hairline); box-shadow: var(--card-shadow); } .newCard { box-shadow: none; }`, tokens)).toEqual(['.newCard'])
    expect(cssShapeCandidates('.ringCard { border-radius: var(--tpl-htn-radius-l); box-shadow: var(--tpl-htn-ring); }', tokens)).toEqual(['.ringCard'])
  })

  it('共通の影・その別名・カード以外の角丸・コメントは誤検知しない', () => {
    for (const shadow of ['var(--card-shadow)', 'var(--shadow-card-surface)', 'var(--tpl-fe-ring), var(--card-shadow)']) {
      expect(cssShapeCandidates(`.newCard { border-radius: 12px; border: 1px solid var(--card-edge); box-shadow: ${shadow}; }`, tokens)).toEqual([])
    }
    expect(cssShapeCandidates('/* .bad { border-radius:12px; border:1px solid var(--color-hairline); } */ .input { border-radius:8px; box-shadow:var(--tpl-fe-ring); }', tokens)).toEqual([])
    expect(cssShapeCandidates('.icon { border-radius:12px; }', tokens)).toEqual([])
  })

  it('Tailwindも同じ要素で判定し、条件分岐やクラスの合成で逃がさない', () => {
    const bad = [
      '<section className="rounded-card border border-hairline" />',
      '<section className="rounded-card border-hairline shadow-none" />',
      '<section className="rounded-card border-hairline shadow-field" />',
      '<section className="rounded-card border-hairline shadow-card" />',
      '<section className={cn("rounded-card", "border-hairline")} />',
      '<section className={`rounded-card border-hairline ${ok ? "shadow-card" : ""}`} />',
      'const shape = "rounded-card border-hairline"; const View = () => <section className={shape} />',
      '<section className="rounded-card border-hairline"><div className="shadow-card" /></section>',
    ]
    for (const source of bad) expect(classShapeCandidates(source, tokens), source).toHaveLength(1)
    for (const shadow of ['shadow-card-surface', 'content-card']) {
      expect(classShapeCandidates(`<section className="rounded-card border-hairline ${shadow}" />`, tokens)).toEqual([])
    }
    expect(classShapeCandidates('<div className="rounded-card"><div className="border-hairline" /></div>', tokens)).toEqual([])
    const named = new Map(tokens).set('--shadow-card-surface', 'var(--card-shadow)')
    expect(classShapeCandidates('<div className="rounded-card border-hairline shadow-card-surface" />', named)).toEqual([])
    named.set('--shadow-card-surface', 'none')
    expect(classShapeCandidates('<div className="rounded-card border-hairline shadow-card-surface" />', named)).toHaveLength(1)
  })
})
