import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U030/U040: 390pxでタブと右端の操作が重なり、マイル一覧の表は
 * 見出しと数値が潰れて別の行と結び付いて読めた。
 * タブ行は横スクロール＋共通の狭幅対応に任せ（画面側の折り返し上書きは
 * スクロールと衝突して語の途中で割れるため撤去）、残高は狭い幅で
 * 1人1枚の札、決めごとの表は枠の内側で横へ動かせる形にする。
 */
describe('V8マイルのタブと表の重なり', () => {
  it('タブは共通の型へ渡し、幅の上書きを残さない', () => {
    expect(PAGE).toContain('<Tabs')
    expect(PAGE).toContain('label="マイルのタブ"')
    expect(PAGE).not.toContain('data-tabs-row')
    expect(PAGE).not.toContain('nav:has(> span)')
  })
  it('現役の残高は表で同じ人の数字と明細を結び付ける', () => {
    expect(PAGE).toContain('key={member.friendId}')
    expect(PAGE).toContain('member.expiringMiles30d')
    expect(PAGE).toContain('member.monthChange')
    expect(PAGE).toContain('/mileage/friends/detail?id=')
  })
  it('決めごとの表は共通の列の型で枠内に収める', () => {
    expect(PAGE).toContain('data-table-layout="columns"')
    expect(PAGE).toContain('<DataTable')
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../v8/mileage/mileage.module.css'), 'utf8')
    expect(css).toMatch(/\.tableWrap \{[^}]*min-width: 0/s)
    expect(css).not.toContain('min-width: 920px')
  })
})
