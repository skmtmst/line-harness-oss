import { readFileSync } from 'node:fs'
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
describe('U030/U040 マイルのタブと表の重なり', () => {
  it('タブ行は共通の横スクロールに任せ、画面側の折り返し上書きを残さない', () => {
    expect(PAGE).toContain('data-design="Tabs"')
    expect(PAGE).not.toContain('data-tabs-row')
    expect(PAGE).not.toContain('nav:has(> span)')
    expect(PAGE).toContain('<MergedTabs')
  })

  it('狭い幅では残高を1人1枚の札にし、誰の残高か見失わない', () => {
    expect(PAGE).toContain('lg:hidden')
    expect(PAGE).toContain('hidden lg:block')
    expect(PAGE).toContain('今月の増減：')
    expect(PAGE).toContain('消える予定：')
    expect(PAGE).toContain('最終変動：')
    // 札でも表でも、明細への行き先は同じ。
    expect(PAGE).toContain('/mileage/friends/detail?id=')
  })

  it('決めごとの表は枠の内側で横へ動かせる', () => {
    expect(PAGE).toContain('data-mileage-table="earning-rules"')
    expect(PAGE).toContain('[data-mileage-table] { overflow-x: auto; }')
    expect(PAGE).toContain('[data-mileage-table] > table { min-width: 920px; }')
  })
})
