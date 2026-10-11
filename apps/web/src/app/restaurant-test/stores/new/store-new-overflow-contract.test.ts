import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('../../../../v8/restaurant/store-new/store-new.module.css', import.meta.url), 'utf8')
const TERMS_CSS = readFileSync(new URL('../../../../v8/restaurant/store-new/terms-body.module.css', import.meta.url), 'utf8')
function block(name: string) { return CSS.match(new RegExp('\\.' + name + ' \\{([^}]+)\\}'))?.[1] ?? '' }

/*
 * #974 U095: 390pxで手順説明と規約パネルの右側が画面外へ切れた。
 * グリッドの子は既定で内容の最小幅までしか縮まないため、1列でも
 * minmax(0,1fr) と子の min-w-0 をそろえる。列を落とせない規約の表だけ
 * 内側の横スクロールを許す。
 */
describe('U095 店舗追加の画面全体のはみ出し', () => {
  it('外側と内側のグリッドは1列のとき minmax(0,1fr) で幅を越えない', () => {
    expect(block('split')).toContain('display: flex')
    expect(block('split')).toContain('min-width: 0')
  })

  it('手順・本文・案内の各パネルは内容より細く縮める', () => {
    expect(block('body')).toContain('min-width: 0')
    expect(block('card')).toContain('flex: 1 1 0')
    expect(block('card')).toContain('min-width: 0')
    expect(block('helpPanel')).toContain('flex: 0 0 var(--tpl-rt-side-w)')
  })

  it('長い店舗名を確認画面で折り返す', () => {
    expect(block('summaryValue')).toContain('overflow-wrap: anywhere')
  })

  it('規約の表は枠の内側だけで横へ動かせる', () => {
    expect(block('termsBox')).toContain('overflow-y: auto')
    expect(TERMS_CSS).toMatch(/\.table\s*\{[^}]*width: 100%/)
  })
})
