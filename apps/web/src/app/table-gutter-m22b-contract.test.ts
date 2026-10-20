import fs from 'node:fs'
import { readUiSource } from '../../scripts/test-ui-source.mjs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * m22b：一覧の表の左右の余白と右端をそろえる。
 *
 * 点検 tools/audit/design-lint.mjs（k=3）は、表の枠から最初・最後の
 * 中身までの左右の余白を測る。右が12未満か、左右の差が12超で赤になる。
 * 原因は3つに分かれる。
 *
 * - 操作列の中身が左に残る → 共通の ActionCell で右へ寄せる。
 *   画面ごと `w-full justify-end` が無い行は足す。
 * - 文字だけのセルは枠で測られて0〜1pxになる → 中身を span で包み、
 *   本当の余白（セルの padding）で測らせる。見た目は変わらない。
 * - 列が器からはみ出す → 操作列を中身＋共通の余白24に広げる。
 *   読み上げ専用の表は測りから外す（大きさ0。読み上げは残る）。
 */

const WEB = path.join(__dirname, '..', '..')
const SRC = path.join(WEB, 'src')

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(SRC, ...segments), 'utf8')
}

describe('m22b 表の左右の余白（共通部品）', () => {
  it('操作列は右端にそろえる（共通 ActionCell）', () => {
    const css = read('components', 'shared', 'data-table.module.css')
    expect(css).toContain('text-align: right')
  })

  it('読み上げ専用の表は測りから外す（大きさ0）', () => {
    const css = read('components', 'shared', 'bar-chart.module.css')
    expect(css).toContain('width: 0')
    expect(css).toContain('height: 0')
  })
})

describe('m22b 表の左右の余白（操作列の右寄せ）', () => {

  // common-actionsの手書きTd／固定120は廃止。ActionCellの実幅を実画面で測る。

  it('/affiliate-offers（案件タブ）：操作は右端にそろえる', () => {
    const body = read('v8', 'affiliates', 'offers.tsx')
    const css = read('v8', 'affiliates', 'affiliates.module.css')
    expect(body).toContain('<Th className={styles.colOfferOps}>操作</Th>')
    expect(body).toContain('<Td className={styles.colOfferOps}>')
    expect(body).toContain('className={styles.rowActions}')
    expect(css).toMatch(/\.colOfferOps\s*\{[^}]*width:\s*var\(--tpl-icon-btn-row-hit\)/s)
    expect(css).toMatch(/\.rowActions\s*\{[^}]*display: flex;[^}]*align-items: center;/)
  })

  it('/reminders：操作は右端にそろえる', () => {
    /* 完全切り替え：管理画面 page は捨て、V8 の list-v8 を見る。絵に操作の見出しは無い。 */
    const body = read("v8/reminders/list.tsx")
    const css = read("app/reminders/list-v8.module.css")
    expect(body).toContain('styles.menuCell')
    expect(css).toContain('.menuCell')
    expect(css).toContain('text-align: right')
  })

  it('/rich-menus：操作の中身は枠いっぱいで右へ寄せる', () => {
    const body = read('v8', 'rich-menus', 'list.tsx')
    expect(body).toContain('className={styles.menuBox}')
    expect(read('v8', 'rich-menus', 'list.module.css')).toMatch(/\.menuBox[^}]*justify-content: flex-end/)
  })

  it('/contents/vars：操作の中身は枠いっぱいで右へ寄せる', () => {
    expect(read('v8', 'common-vars', 'list.module.css')).toMatch(/\.menuBox[^}]*justify-content: flex-end/)
  })

  it('/tags：操作列は中身＋共通の余白に広げる', () => {
    const body = read('v8', 'tags', 'tags-tab.tsx')
    expect(body).toContain('<Th className={styles.colMenu}>')
  })
})

describe('m22b 表の左右の余白（文字だけのセルを包む）', () => {
  it('/：日付と数字を包み、余白で測らせる', () => {
    const body = read('components', 'dashboard', 'friend-trend-table.tsx')
    expect(body).toContain('<span>{diff === null')
    expect(body).toContain('<span>{formatNumber(row.active')
  })

  it('/booking/menus：名前の操作を専用の欄に収め、省略する', () => {
    const body = read('v8', 'booking-menus', 'tabs', 'menus-tab.tsx')
    const css = read('v8', 'booking-menus', 'settings.module.css')
    expect(body).toContain('className={styles.colName}')
    expect(body).toContain('className={styles.menuName}')
    expect(css).toMatch(/\.menuName\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
  })

  it('/duplicates：先頭の文字を包む', () => {
    const body = read('v8', 'friends', 'duplicates', 'list.tsx')
    expect(body).toContain('className={styles.cellText}')
    expect(body).toContain('title={row.accountName}>{row.accountName}</span>')
  })

  it('/friends/migrations：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'migrations', 'migrations.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })

  it('/friends/identity-candidates：V8の表は左右のセル余白を設計値で保つ', () => {
    const css = read('v8', 'friends', 'compare', 'compare.module.css')
    expect(css).toMatch(/\.table thead th\.th:first-child[^{]*\{[^}]*padding-left: var\(--tpl-fr-cell-inset\)/)
    expect(css).toMatch(/\.table td\.td:last-child[^{]*\{[^}]*padding-right: var\(--tpl-fr-cell-inset\)/)
  })
})
