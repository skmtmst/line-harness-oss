// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BookingMenu } from '@/lib/api'
import type { RowMenuProps } from '@/components/shared/row-actions'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => navigation,
}))
vi.mock('@/components/shared/row-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/row-actions')>()
  return { ...actual, RowMenu: (props: RowMenuProps) => React.createElement(actual.RowMenu, {
    ...props, className: process.env.L2X_MENU_OWNER_FAULT && props.label !== '共通の基準' ? 'page-owned-row-menu' : props.className,
  }) }
})
import { RowMenu } from '@/components/shared/row-actions'
import { MenusTabV8 } from '@/v8/booking-menus/tabs/menus-tab'

afterEach(() => { cleanup(); vi.clearAllMocks() })

/** Tables and row controls keep their shared layout and navigation. */

const HERE = dirname(fileURLToPath(import.meta.url))

function read(relativePath: string): string {
  return readFileSync(join(HERE, relativePath), 'utf8')
}

/** `width: '12%'` のような割合指定を全部拾って合計する。 */
function percentTotal(source: string): number {
  const values = [...source.matchAll(/width:\s*['"](\d+(?:\.\d+)?)%['"]/g)].map((m) =>
    Number(m[1]),
  )
  return values.reduce((sum, value) => sum + value, 0)
}

describe('表は器の幅にぴったり収める', () => {
  it('/booking/menus: 共通の行末操作から長い名前のメニューの中身を開ける', () => {
    const menu: BookingMenu = {
      id: 'menu-long', name: '小型犬のトリミングとシャンプーを一緒に受けるメニュー',
      category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 10,
      base_price: 5000, sort_order: 0, is_active: 1, auto_tag_id: null,
    }
    render(React.createElement(React.Fragment, null,
      React.createElement(MenusTabV8, { accountId: 'account-test', menus: [menu], status: 'ready', error: null,
        menuCount: 1, canEdit: true, onReload: () => {} }),
      React.createElement(RowMenu, { label: '共通の基準', appearance: 'box', size: 'row', items: [] }),
    ))
    expect(screen.getByRole('button', { name: menu.name, exact: true })).toBeTruthy()
    const trigger = screen.getByRole('button', { name: `「${menu.name}」のそのほかの操作` })
    const reference = screen.getByRole('button', { name: '共通の基準' })
    expect(trigger.className).toBe(reference.className)
    expect(trigger.getAttribute('data-size')).toBe(reference.getAttribute('data-size'))
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '中身を編集' }))
    expect(navigation.push).toHaveBeenCalledWith('/booking/menus/new?menu=menu-long')
  })

  it('/events: 操作列は固定幅で、中身が器からはみ出さない', () => {
    const page = read('../v8/events/list.tsx')
    const css = read('../v8/events/list.module.css')
    expect(page).toContain('<DataTable')
    // V8の行末メニューは共通の固定幅。旧2ボタン分の幅へ戻さない。
    expect(page).toContain('<col className={styles.colMenu} />')
    expect(page).toContain('<Th aria-label="操作" />')
    expect(css).toContain('.colMenu { width: var(--tpl-fm-col-menu); }')
    expect(page).not.toMatch(/width:\s*['"]14%['"]/)
    expect(percentTotal(page)).toBeLessThan(100)
  })

  it('/events: 申込条件は1行で省略し、全文は title で確認する', () => {
    const page = read('../v8/events/list.tsx')
    // 申込条件は状態の札の下へ畳む。独立した列に戻すと、狭い器で見出しが
    // 重なり「全員」が縦に折れる（m19d の撮影指摘）。
    expect(page).not.toContain('>申込条件</Th>')
    // タグ名は長さが読めない。省略を外して素の文字に戻さない。
    expect(page).toContain("<TagPill name={e.visible_tag_name ?? '消えたタグ'} size=\"sm\" />")
    const tag = read('../components/shared/tag-pill.tsx')
    expect(tag).toContain('<TruncatedText className={styles.name} value={name} />')
    expect(read('../components/shared/truncated-text.module.css')).toContain('white-space: nowrap; text-overflow: ellipsis;')
  })

  it('/（対応が必要な受信）: 状態列は札に合わせた固定幅で、右に空けない', () => {
    const card = read('../components/support/pending-inbox-card.tsx')
    expect(card).toContain('<DataTable')
    // 状態の札（約52px＋余白）に合わせた 80px。96px に戻さない。
    expect(card).toMatch(/<Th[^>]*width:\s*80[^>]*>状態<\/Th>/)
    expect(card).not.toMatch(/width:\s*96/)
    expect(percentTotal(card)).toBeLessThan(100)
  })
})
