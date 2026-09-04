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

  it('共通Buttonを直接importする96ファイルを利用先に数える', () => {
    // 2026-09-04: LINEアカウントの4画面（★V6 33-1〜33-4）と、下部追従バーへ
    // 寄せた共通情報の2画面が共通 Button を使う。統合 PR #834 #845 #855 の
    // ぶんと、一覧失敗時の再読み込みを持つ ListState と合わせて実測し直す。
    expect(directImporters(files, button)).toHaveLength(96)
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
