/*
 * Issue #707（監査6: 390pxレスポンシブ残件）の契約テスト。
 * 1. 21 NEN配信: 一覧表の外枠が狭幅で横スクロールを許し、
 *    操作列は sticky で右端へ留める。
 * 2. 32 機能設定: 狭幅で機能グリッドが1列へ落ちる。
 * 3. 16 成果とアフィリエイト: タブ行に続きがある手がかり（端の影）を出す。
 * 4. 28 予約設定: 一覧の操作列を sticky で右端へ留める。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('Issue #707: 21 NEN配信の表は狭幅で横スクロール＋操作列sticky', () => {
  it('外枠が狭幅の横スクロールを許す', () => {
    const css = read('../components/shared/data-table.module.css')
    expect(css).toContain('overflow-x: auto')
    expect(css).not.toMatch(/\.frame\s*\{[^}]*overflow:\s*hidden/s)
  })

  it('nen-overview の3表すべて操作列がsticky', () => {
    const src = read('nen-campaigns/nen-overview.tsx')
    const stickyHeaders = src.match(/sticky right-0 bg-surface-pearl/g) ?? []
    const stickyCells = src.match(/sticky right-0 bg-canvas/g) ?? []
    expect(stickyHeaders.length).toBeGreaterThanOrEqual(3)
    expect(stickyCells.length).toBeGreaterThanOrEqual(3)
  })
})

describe('Issue #707: 32 機能設定は狭幅で1列へ落ちる', () => {
  it('grid の基底が1列＋min-w-0', () => {
    const src = read('settings/page.tsx')
    expect(src).toContain('grid-cols-1')
    expect(src).toContain('xl:grid-cols-3')
  })
})

describe('Issue #707: 16 タブ行は続きがある手がかりを出す', () => {
  it('左右端のスクロールヒントを描く', () => {
    const src = read('../components/layout/scrollable-tabs.tsx')
    expect(src).toContain('data-scroll-hint="left"')
    expect(src).toContain('data-scroll-hint="right"')
    expect(src).toContain('linear-gradient')
  })
})

describe('Issue #707: 28 予約設定の操作列はsticky', () => {
  it('メニュー表の操作列がsticky', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('sticky right-0 bg-canvas-sunken')
    expect(src).toContain('sticky right-0 bg-canvas')
  })
})
