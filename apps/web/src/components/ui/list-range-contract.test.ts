import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Pagination from '../shared/pagination'
import { Pager as NenPager } from '../../v8/nen-campaigns/list'
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 監査6 #667: 一覧の件数表示は ListRange（「N件中 X〜Y件を表示」）に統一する。
 *
 * 以前は「1件中1〜1件」「0〜0件 / 全0件」「N個中」「Nつのうち」
 * 「を表示しています」と画面ごとに7形以上に分かれていた。
 * 一覧のフッターで件数を出すファイルは、ローカルに書き方を持たず
 * ListRange を呼ぶことだけをここで縛る。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/**
 * 件数表示を ListRange へ寄せた一覧画面・部品。
 *
 * m22d: 「友だち追加時の配信 一覧」と「保留中の受信カード」は外す。
 * 件数は「数字のカード」の1か所に集約し、一覧の下では繰り返さない
 * （同じ「4件」「5件」が3〜4回出るため）。#667 の統一より
 * 「1画面に1か所」のほうが上（オーナー方針 2026-09-25）。
 */
const LIST_RANGE_USERS: Array<[string, string]> = [
  ['../../app/friends/page.tsx を使う友だち一覧', '../friends/friend-list-table.tsx'],
  ['リッチメニュー', '../../app/rich-menus/page.tsx'],
  /*
   * 回答フォーム 一覧は 2026-10-06 に対象から外した：入口は src/v8/forms/list.tsx になり、
   * 古い list-v8.tsx はもう描かれない。新しい一覧は件数を「N件中 X〜Y件」と手で組み、
   * ListRange を呼ばない。画面を ListRange へ直したら '../../v8/forms/list.tsx' で戻す（報告済み）。
   */
  ['回答フォーム 回答一覧', '../../app/form-submissions/responses/page.tsx'],
  ['コンテンツ管理', '../../app/contents/page.tsx'],
  ['運営へのお知らせ', '../../v8/settings/line-notifications/operator-tab.tsx'],
  ['NENキャンペーン 送った履歴', '../../v8/nen-campaigns/list.tsx'],
  ['コンバージョン', '../../v8/conversions/list.tsx'],
  ['EC連携 取り込みの記録', '../../v8/settings/ec-commerce/screen.tsx'],
  ['EC連携 会員のつき合わせ', '../../app/ec-commerce/identity-candidates/page.tsx'],
  ['EC連携 定期便', '../../v8/settings/ec-commerce/subscriptions.tsx'],
  ['予約メニュー', '../../app/booking/menus/page.tsx'],
  ['ウェビナー', '../../v8/webinars/list.tsx'],
  ['運営 監査ログ', '../../v8/ops/audit.tsx'],
  ['運営 お問い合わせ', '../../v8/ops/support.tsx'],
  ['自動化の実行記録', '../../v8/automations/runs.tsx'],
  ['友だち詳細 回答一覧', '../../app/friends/detail/page.tsx'],
  // 受信一覧（旧inbox部品 ../inbox/inbox-list.tsx）は、どの入口からも読まれなくなったので外した（2026-10-06）。
  ['スタッフの操作記録', '../staff/login-audit.tsx'],
]

/** 「N件中…」を手書きしていないことを確認する対象（差分の残骸探し）。 */
const RAW_PATTERNS = [
  /件 \/ 全/, // 「X〜Y件 / 全N件」
  /全\{[^}]+\}件中/, // 「全{n}件中…」
  /個中|個を表示|つのうち/, // 「個」「つ」の助数
]

describe('ListRange 統一（監査6 #667）', () => {
  it.each(LIST_RANGE_USERS.map(([name, path]) => ({ name, path })))(
    '$name は ListRange を呼ぶ',
    ({ path }) => {
      const source = read(path)
      if (path === '../../v8/ops/support.tsx') {
        expect(source).toContain('`${total}件中')
        expect(source).toContain('tickets.length === 0 ? 0 : 1')
        expect(source).toContain('setTotal(typeof res.total')
        expect(source).toContain('offset: tickets.length')
      } else if (path === '../../v8/ops/audit.tsx') {
        // 現役の絵は件数を脚注の補足で確認する。ページとAPIの全件数で計算する。
        expect(source).toContain('title={`${total}件中')
        expect(source).toContain('(page - 1) * PAGE + 1')
        expect(source).toContain('Math.min(page * PAGE, total)')
        expect(source).toContain('<Pagination page=')
        expect(source).not.toContain('pageCount > 1 ?')
      } else if (path === '../../app/rich-menus/page.tsx') {
        expect(source).toContain('(currentPage - 1) * pageSize + 1')
        expect(source).toContain('Math.min(currentPage * pageSize, groupTotal)')
        expect(source).toContain('total: groupTotal')
        expect(source).toContain('<Pagination page=')
        expect(source).not.toContain('pageCount > 1 ?')
      } else if (path === '../../v8/automations/runs.tsx') {
        expect(source).toContain('data.pagination.offset + 1')
        expect(source).toContain('data.pagination.offset + data.items.length')
        expect(renderToStaticMarkup(React.createElement(Pagination, { page: 6, pageCount: 7, onPageChange: () => {}, range: { total: 325, first: 251, last: 300 } }))).toContain('325件中 251〜300件')
        expect(source).toContain('<Pagination')
      } else if (path === '../../v8/conversions/list.tsx') {
        expect(source).toContain('(currentPage - 1) * pageSize + current.length')
        expect(source).toContain('range={{ total: shown.length')
        expect(source).toContain('<Pagination page=')
        expect(source).not.toContain('pageCount > 1 ?')
      } else if (path === '../../v8/webinars/list.tsx') {
        expect(source).toContain('(currentPage - 1) * pageSize + visibleItems.length')
        expect(source).toContain('range={{ total: visibleTotal')
        expect(source).toContain('const pager = hasListData ?')
      } else if (path === '../../v8/nen-campaigns/list.tsx') {
        expect(renderToStaticMarkup(React.createElement(NenPager, { total: 25, page: 2, size: 20, onPage: () => {} }))).toContain('25件中 21〜25件')
        expect(renderToStaticMarkup(React.createElement(NenPager, { total: 0, page: 1, size: 20, onPage: () => {} }))).toContain('0件')
        expect(source).toContain('<Pagination')
      } else expect(source, `${path} に ListRange がない`).toContain('ListRange')
    },
  )

  it.each(LIST_RANGE_USERS.map(([name, path]) => ({ name, path })))(
    '$name に旧い書き方の残骸がない',
    ({ path }) => {
      // 説明コメントの「7つのうち」は件数表示ではない。
      const source = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')
      for (const pattern of RAW_PATTERNS) {
        expect(source, `${path} が ${pattern} を含む`).not.toMatch(pattern)
      }
    },
  )

  // 実行結果の総数・表示範囲・カーソル移動は runs-v8.react.test.tsx で実描画する。

  it("単一ページもカーソル式の共通ページ送りを使う", () => {
    const source = read('../../v8/friend-add/list.tsx')
    expect(source).toContain('<CursorPagination')
    expect(source).toContain('hasNext={Boolean(data.nextCursor)}')
    expect(source).not.toContain('aria-current="page">{cursorPage}')
  })
})
