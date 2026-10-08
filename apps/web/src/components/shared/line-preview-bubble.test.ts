/*
 * ★V8 OVCot ②：届き方のテキストの吹き出しは、文字に合わせて伸び縮みする（決まった 176×94 の四角にしない）。
 * いちばん広くて186・文字13・行の高さ1.45・内側 8/12・角丸 左上6／ほか18（cfVyj 2026-10-08）。
 * CSS は後に書いたものが勝つので、v8 の宣言を上から順に重ねた最後の値で見る。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./line-preview.module.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function effective(selector: string): Record<string, string> {
  const result: Record<string, string> = {}
  const pattern = /\[data-theme='v8'\]\s+\.(\w+)\s*\{([^}]*)\}/g
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    if (match[1] !== selector) continue
    for (const declaration of match[2].split(';')) {
      const at = declaration.indexOf(':')
      if (at < 0) continue
      result[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim()
    }
  }
  return result
}

describe('LINE の吹き出し（v8）', () => {
  it('吹き出しは文字に合わせる：幅は決めず、いちばん広くて 186', () => {
    const bubble = effective('bubble')
    expect(bubble.width).toBe('auto')
    expect(bubble['max-width']).toBe('186px')
    expect(bubble['min-height']).toBe('0')
    const body = effective('bubbleBody')
    expect(body.width).toBe('auto')
    expect(body['min-height']).toBe('0')
  })

  it('文字13・行の高さ1.45・内側 8/12・角丸 左上6／ほか18・改行はそのまま', () => {
    const body = effective('bubbleBody')
    expect(body['font-size']).toBe('13px')
    expect(body['line-height']).toBe('1.45')
    expect(body.padding).toBe('8px 12px')
    expect(body['border-radius']).toBe('var(--radius-mini) var(--radius-large) var(--radius-large) var(--radius-large)')
    expect(body['white-space']).toBe('pre-wrap')
  })

  it('画像・カードの大きさは今のまま（cfVyj）', () => {
    expect(effective('productCard').width).toBe('186px')
  })
})
