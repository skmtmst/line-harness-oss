import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'toast.module.css'), 'utf8')

const block = (selector: RegExp) => css.match(selector)?.[1] ?? ''

/**
 * 知らせが消えるときの動き（動きの点検 13 番・2026-10-07）。
 * 窓と同じ「消えかけ」の印（data-closing）の間、透明度を一方向に下げて消す。
 * 長さ・イージングは変数（--motion-exit・--motion-ease-out）で、数字を直書きしない。
 * 動きを減らす設定では動かさない。
 */
describe('知らせの消える動き', () => {
  const leaving = block(/\[data-theme='v8'\] \.toast\[data-closing\] \{([^}]*)\}/)
  const keyframes = css.match(/@keyframes toast-v8-leave \{([\s\S]*?)\n\}/)?.[1] ?? ''

  it('消えかけの印で、変数の長さ・イージングの消える動きを当てる', () => {
    expect(leaving).toMatch(/animation:\s*toast-v8-leave var\(--motion-exit\) var\(--motion-ease-out\) forwards;/)
    // 消えかけは押せない
    expect(leaving).toMatch(/pointer-events:\s*none;/)
  })

  it('透明度は 1 から 0 へ一方向に下がるだけ（途中で戻らない）', () => {
    const stops = [...keyframes.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]))
    expect(stops).toEqual([1, 0])
  })

  it('動きを減らす設定では消える動きを止める', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(reduced).toMatch(/\.toast\[data-closing\] \{[^}]*animation:\s*none;/)
  })
})
