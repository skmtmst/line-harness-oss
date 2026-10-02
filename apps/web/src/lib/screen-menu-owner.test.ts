import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MENU_SECTIONS, SCREEN_MENU_OWNER, menuOwnerForScreen } from './menu'

const SIDEBAR = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'layout', 'sidebar.tsx'),
  'utf8',
)

/**
 * #984 LAY-15: 画面 → 左メニューの所属。
 *
 * UID移行は URL 上 /accounts 配下だが、中身は友だちの主タブの1枚。
 * 「LINEアカウント」ではなく「友だち」が選ばれることを守る。
 */
describe('画面→メニュー所属の正本（#984 LAY-15）', () => {
  it('UID移行は「友だち」の画面として選ばれる', () => {
    expect(SCREEN_MENU_OWNER['/accounts?tab=migration']).toBe('friends')
    expect(menuOwnerForScreen('/accounts', '?tab=migration')).toEqual(['friends'])
  })

  it('クエリの並びや追加パラメータに左右されない', () => {
    // 共有URLや遷移元の情報がクエリへ乗っても同じ画面として扱う。
    expect(menuOwnerForScreen('/accounts', '?from=sidebar&tab=migration')).toEqual(['friends'])
    // 通常の /accounts は宣言の対象外（LINEアカウントが選ばれる）。
    expect(menuOwnerForScreen('/accounts', '')).toBeUndefined()
    expect(menuOwnerForScreen('/accounts', '?tab=general')).toBeUndefined()
    expect(menuOwnerForScreen('/friends', '')).toBeUndefined()
  })

  it('所属先の項目がメニューに実在する', () => {
    const ids = new Set(MENU_SECTIONS.flatMap((section) => section.items.map((item) => item.id)))
    for (const [screen, owner] of Object.entries(SCREEN_MENU_OWNER)) {
      const candidates = typeof owner === 'string' ? [owner] : owner
      for (const id of candidates) {
        expect(ids.has(id), `${screen} の所属先 ${id} がメニューに無い`).toBe(true)
      }
    }
  })

  it('サイドバーが正本を読んで選択へ反映する', () => {
    expect(SIDEBAR).toContain('menuOwnerForScreen')
    // 宣言がある画面では、パス一致ではなく所属先の項目を選ぶ。
    expect(SIDEBAR).toContain('item.id === ownerItemId')
  })
})
