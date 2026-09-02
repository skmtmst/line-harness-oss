import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allFiles, directImporters, routeEntryFiles } from '../../scripts/design-impact.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  const files = allFiles()
  const button = join(SRC, 'components', 'shared', 'button.tsx')
  const buttonCss = join(SRC, 'components', 'shared', 'button.module.css')
  const pagination = join(SRC, 'components', 'shared', 'pagination.tsx')
  const paginationCss = join(SRC, 'components', 'shared', 'pagination.module.css')

  it('共通Buttonを直接importする81ファイルだけを利用先に数える', () => {
    expect(directImporters(files, button).map((file) => relative(SRC, file))).toEqual([
      'app/affiliates/payment-tab.tsx',
      'app/affiliates/tabs.tsx',
      'app/analytics/page.tsx',
      'app/auto-replies/page.tsx',
      'app/automations/page.tsx',
      'app/booking/bookings/new/page.tsx',
      'app/booking/menus/page.tsx',
      'app/booking/staff/page.tsx',
      'app/booking/staff/shifts/page.tsx',
      'app/broadcasts/detail/page.tsx',
      'app/broadcasts/reserved/page.tsx',
      'app/chats/page.tsx',
      'app/common-actions/edit/page.tsx',
      'app/common-actions/new/page.tsx',
      'app/common-actions/page.tsx',
      'app/common-actions/versions/page.tsx',
      'app/contents/page.tsx',
      'app/contents/vars/page.tsx',
      'app/conversions/page.tsx',
      'app/duplicates/page.tsx',
      'app/ec-commerce/identity-candidates/page.tsx',
      'app/form-submissions/page.tsx',
      'app/friend-add-settings/publish/page.tsx',
      'app/friends/identity-candidates/page.tsx',
      'app/friends/page.tsx',
      'app/hq/open/page.tsx',
      'app/hq/page.tsx',
      'app/hq/settings/hq-staff-section.tsx',
      'app/hq/settings/page.tsx',
      'app/inflow-links/page.tsx',
      'app/line-notifications/operator/new/page.tsx',
      'app/line-notifications/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/friends/detail/mileage-adjustment-dialog.tsx',
      'app/mileage/friends/detail/page.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      'app/nen-campaigns/columns/new/page.tsx',
      'app/nen-campaigns/page.tsx',
      'app/nen-members/page.tsx',
      'app/page.tsx',
      'app/reminders/new/page.tsx',
      'app/reminders/page.tsx',
      'app/rich-menus/connections/page.tsx',
      'app/scenarios/detail/scenario-detail-client.tsx',
      'app/scenarios/page.tsx',
      'app/scenarios/results/page.tsx',
      'app/tags/fields/migrate/page.tsx',
      'app/tags/fields/new/page.tsx',
      'app/tags/folders/new/page.tsx',
      'app/tags/page.tsx',
      'app/tags/searches/edit/page.tsx',
      'app/templates/page.tsx',
      'app/templates/questions/new/page.tsx',
      'app/webhooks/page.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'app/webinars/edit/page.tsx',
      'components/auto-replies/edit-dialog.tsx',
      'components/automations/common-action-editor.tsx',
      'components/broadcasts/broadcast-asset-manager.tsx',
      'components/broadcasts/segment-preset-controls.tsx',
      'components/chats/template-folder-select.tsx',
      'components/friend-fields/field-list.tsx',
      'components/friend-fields/mark-list.tsx',
      'components/friend-fields/saved-search-list.tsx',
      'components/friend-fields/support-mark-editor.tsx',
      'components/friend-fields/tag-csv-import-dialog.tsx',
      'components/friend-fields/tag-editor-v4.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/advanced-search-dialog.tsx',
      'components/friends/bulk-run-dialog.tsx',
      'components/hq/account-list.tsx',
      'components/identity/identity-decision-dialog.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/line-notifications/operator-notification-rules.tsx',
      'components/merged-person/merged-delivery-dialog.tsx',
      'components/merged-person/merged-person-detail.tsx',
      // 2026-09-02: 作成画面のV6版が、保存・キャンセルを下部追従バーへ
      // 出すのに共通Buttonを使う。V5版の素のボタンはそのまま。
      'components/shared/create-page.tsx',
      'components/shared/not-connected.tsx',
      'components/store-selection-gate.tsx',
      'components/users/user-row.tsx',
    ])
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss)).toEqual([button])
    expect(directImporters(files, paginationCss)).toEqual([pagination])
  })

  it('共通Paginationを直接importする19ファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    // 2026-09-02: 成果地点と流入経路の押せない「前へ／次へ」も共通へ寄せた。
    expect(directImporters(files, pagination).map((file) => relative(SRC, file))).toEqual([
      // 2026-09-02: 案件一覧が自前のページ送りを持たないまま全件を出していた。
      // 設計 `GH8VL` は表の下にページ送りがある。共通へ寄せた。
      'app/affiliates/tabs.tsx',
      'app/contents/page.tsx',
      'app/contents/vars/page.tsx',
      'app/conversions/page.tsx',
      'app/form-submissions/page.tsx',
      'app/inflow-links/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      'app/reminders/page.tsx',
      'app/rich-menus/page.tsx',
      'app/tags/page.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'components/friend-attributes-v2/tag-list-v2.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/friend-list-table.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/support/pending-inbox-card.tsx',
      'components/users/users-table.tsx',
    ])
  })

  it('全画面共通枠はpageだけでなく親layoutからの到達も調べる', () => {
    const friendsPage = join(SRC, 'app', 'friends', 'page.tsx')
    expect(routeEntryFiles(friendsPage).map((file) => relative(SRC, file))).toContain('app/layout.tsx')
  })
})
