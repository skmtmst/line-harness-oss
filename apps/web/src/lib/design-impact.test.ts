import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allFiles,
  createImportIndex,
  directImporters,
  routeEntryFiles,
} from '../../scripts/design-impact.mjs'
import {
  parseDesignImpactBaseline,
  readDesignImpactBaseline,
} from '../../scripts/design-impact-baseline.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  const files = allFiles()
  // 全ファイルの構文解析は1回だけ。各検査は同じ解決済み索引を共有する。
  const importIndex = createImportIndex(files)
  const button = join(SRC, 'components', 'shared', 'button.tsx')
  const buttonCss = join(SRC, 'components', 'shared', 'button.module.css')
  const pagination = join(SRC, 'components', 'shared', 'pagination.tsx')
  const paginationCss = join(SRC, 'components', 'shared', 'pagination.module.css')
  const baseline = readDesignImpactBaseline()

  it('共通Buttonの実利用先が一覧ファイルと一致する', () => {
    const actual = directImporters(files, button, importIndex).map((file) => relative(SRC, file)).sort()
    expect(
      actual,
      '件数を書き換えず、design-impact-baseline.txtへ利用先の行を追加・削除してください',
    ).toEqual(baseline.sharedButtonImporters)
  })

  it('並行PRが足した2画面を行として同時に保持できる', () => {
    const parsed = parseDesignImpactBaseline([
      'shared-button-importer app/example-a/page.tsx',
      'shared-button-importer app/example-b/page.tsx',
    ].join('\n'))
    expect(parsed.sharedButtonImporters).toEqual([
      'app/example-a/page.tsx',
      'app/example-b/page.tsx',
    ])

    const attributes = readFileSync(join(SRC, '..', '..', '..', '.gitattributes'), 'utf8')
    expect(attributes).toContain('apps/web/design/design-impact-baseline.txt merge=union')
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss, importIndex)).toEqual([button])
    expect(directImporters(files, paginationCss, importIndex)).toEqual([pagination])
  })

  it('共通Paginationを直接importする30ファイルだけを利用先に数える', () => {
    // ダッシュボードの受信カードが自前の「前へ／次へ」をやめて共通へ寄せた。
    // 設計（`vUXKb` / `NjK9q`）は表の下にページ送りがあり、番号で飛べる。
    // 2026-09-02: 成果地点と流入経路の押せない「前へ／次へ」も共通へ寄せた。
    expect(directImporters(files, pagination, importIndex).map((file) => relative(SRC, file))).toEqual([
      // 2026-09-02: 案件一覧が自前のページ送りを持たないまま全件を出していた。
      // 設計 `GH8VL` は表の下にページ送りがある。共通へ寄せた。
      'app/affiliates/tabs.tsx',
      // 2026-09-04: 自動応答の実行結果が入った。表の下にページ送りがある。
      'app/auto-replies/runs/page.tsx',
      // #370: 予約メニュー8件を設計どおり1ページ6件に区切る。
      'app/booking/menus/page.tsx',
      'app/contents/page.tsx',
      // #973: 共通情報の変更影響を1件ずつ確認する一覧にページ送りを追加した。
      'app/contents/vars/impact-review.tsx',
      'app/contents/vars/page.tsx',
      'app/conversions/page.tsx',
      // #572: EC連携の取り込み記録が先頭20件しか出ず、21件目以降の失敗に
      // 届かなかった。状態絞りをサーバへ移し、共通へ寄せた。
      'app/ec-commerce/page.tsx',
      // #731: 定期便の一覧が 100 件で頭打ちのまま、101件目から先へ行く手立てが
      // 無かった。サーバが数えた総数でページ送りを出すため共通へ寄せた。
      'app/ec-commerce/subscriptions-panel.tsx',
      // 2026-09-04: イベント一覧も自前のページ送りをやめて共通へ寄せた。
      // 取れていないときに「1 / 1」と出て、1ページぶんは取れたように見えていた。
      'app/events/bookings/page.tsx',
      'app/events/page.tsx',
      // #543: 一覧の到達不能な回答表（M2削除）と共に共通Paginationの利用を外した。
      'app/form-submissions/responses/page.tsx',
      // #565: 送信履歴が増えても描画を際限なく重くしないよう、20件ずつのページ送りに寄せた。
      'app/inflow-links/ad-integration.tsx',
      'app/inflow-links/page.tsx',
      // #291: 顧客へのお知らせ9種類を、設計どおり1ページ6件に区切る。
      'app/line-notifications/page.tsx',
      'app/mileage/action-score-tab.tsx',
      'app/mileage/mileage-history-tab.tsx',
      'app/mileage/page.tsx',
      // 2026-09-04: 7-1-H 実行結果。友だち×通の実行が並ぶので、表の下にページ送りが要る。
      'app/reminders/detail/page.tsx',
      'app/reminders/page.tsx',
      'app/rich-menus/page.tsx',
      'app/webhooks/webhook-interactions.tsx',
      'app/webhooks/webhook-overviews.tsx',
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
