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

  it('共通Buttonを直接importする104ファイルを利用先に数える', () => {
    // development 側の102件に、流入リンク詳細の削除確認とリマインダ実行結果を加えた実測値。
    expect(directImporters(files, button)).toHaveLength(104)
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss)).toEqual([button])
    expect(directImporters(files, paginationCss)).toEqual([pagination])
  })

  it('共通Paginationを直接importする20ファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    // 2026-09-02: 成果地点と流入経路の押せない「前へ／次へ」も共通へ寄せた。
    expect(directImporters(files, pagination).map((file) => relative(SRC, file))).toEqual([
      // 2026-09-02: 案件一覧が自前のページ送りを持たないまま全件を出していた。
      // 設計 `GH8VL` は表の下にページ送りがある。共通へ寄せた。
      'app/affiliates/tabs.tsx',
      // 2026-09-04: 自動応答の実行結果が入った。表の下にページ送りがある。
      'app/auto-replies/runs/page.tsx',
      'app/contents/page.tsx',
      'app/contents/vars/page.tsx',
      'app/conversions/page.tsx',
      // 2026-09-04: イベント一覧も自前のページ送りをやめて共通へ寄せた。
      // 取れていないときに「1 / 1」と出て、1ページぶんは取れたように見えていた。
      'app/events/page.tsx',
      'app/form-submissions/page.tsx',
      'app/inflow-links/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      // 2026-09-04: 7-1-H 実行結果。友だち×通の実行が並ぶので、表の下にページ送りが要る。
      'app/reminders/detail/page.tsx',
      'app/reminders/page.tsx',
      'app/rich-menus/page.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'app/webinars/page.tsx',
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
