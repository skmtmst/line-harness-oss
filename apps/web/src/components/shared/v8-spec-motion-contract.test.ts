import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/*
 * ★V8 仕上げ3回目（M10）の動きの契約。値は --motion-* だけ、
 * V8（[data-theme='v8']／[data-theme="v8"]）だけ、減らす設定では
 * 出さない（opacity だけ・または無し）。
 */
describe('V8 仕上げ3回目の動き', () => {
  it('①④ 表の行は上から順に少しずつ（200ms・40msずらし・4行目以降同時）', () => {
    const css = read('../../app/globals.css')
    expect(css).toMatch(/\[data-theme="v8"\] tbody > tr \{\s*animation:\s*v8-content-in var\(--motion-base\)/s)
    expect(css).toMatch(/tbody > tr:nth-child\(2\) \{\s*animation-delay:\s*40ms/s)
    expect(css).toMatch(/tbody > tr:nth-child\(n \+ 4\) \{\s*animation-delay:\s*120ms/s)
  })
})
