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

  it('共通Buttonを直接importする46ファイルだけを利用先に数える', () => {
    expect(directImporters(files, button).map((file) => relative(SRC, file))).toEqual([
      'app/affiliates/tabs.tsx',
      'app/analytics/page.tsx',
      'app/automations/page.tsx',
      'app/booking/bookings/new/page.tsx',
      'app/chats/page.tsx',
      'app/common-actions/edit/page.tsx',
      'app/common-actions/new/page.tsx',
      'app/common-actions/page.tsx',
      'app/common-actions/versions/page.tsx',
      'app/conversions/page.tsx',
      'app/form-submissions/page.tsx',
      'app/hq/open/page.tsx',
      'app/hq/page.tsx',
      'app/hq/settings/hq-staff-section.tsx',
      'app/hq/settings/page.tsx',
      'app/inflow-links/page.tsx',
      'app/line-notifications/operator/new/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/friends/detail/mileage-adjustment-dialog.tsx',
      'app/mileage/friends/detail/page.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      'app/nen-campaigns/page.tsx',
      'app/nen-members/page.tsx',
      'app/page.tsx',
      'app/reminders/new/page.tsx',
      'app/reminders/page.tsx',
      'app/scenarios/detail/scenario-detail-client.tsx',
      'app/scenarios/page.tsx',
      'app/scenarios/results/page.tsx',
      'app/tags/page.tsx',
      'app/tags/searches/edit/page.tsx',
      'app/templates/detail/page.tsx',
      'app/templates/page.tsx',
      'app/templates/questions/new/page.tsx',
      'components/automations/common-action-editor.tsx',
      'components/broadcasts/broadcast-asset-manager.tsx',
      'components/friend-fields/saved-search-list.tsx',
      'components/friend-fields/tag-csv-import-dialog.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/advanced-search-dialog.tsx',
      'components/hq/account-list.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/line-notifications/operator-notification-rules.tsx',
      'components/shared/folder-edit-dialog.tsx',
      'components/store-selection-gate.tsx',
    ])
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss)).toEqual([button])
    expect(directImporters(files, paginationCss)).toEqual([pagination])
  })

  it('共通Paginationを直接importする13ファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    expect(directImporters(files, pagination).map((file) => relative(SRC, file))).toEqual([
      'app/contents/page.tsx',
      'app/contents/vars/page.tsx',
      'app/form-submissions/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      'app/reminders/page.tsx',
      'app/tags/page.tsx',
      'components/friend-attributes-v2/tag-list-v2.tsx',
      'components/friend-fields/tags-page-v4.tsx',
      'components/friends/friend-list-table.tsx',
      'components/line-notifications/notification-run-list.tsx',
      'components/support/pending-inbox-card.tsx',
    ])
  })

  it('全画面共通枠はpageだけでなく親layoutからの到達も調べる', () => {
    const friendsPage = join(SRC, 'app', 'friends', 'page.tsx')
    expect(routeEntryFiles(friendsPage).map((file) => relative(SRC, file))).toContain('app/layout.tsx')
  })
})
