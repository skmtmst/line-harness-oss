import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'slide-panel.module.css'), 'utf8')
const source = readFileSync(join(here, 'slide-panel.tsx'), 'utf8')

/**
 * ★A の切り替わり（M10）。手順とタブの中身は、次へは右から
 * 24px＋薄く、戻るは逆（240ms glide）。V8 のときだけ。
 */
describe('★A 切り替わり（手順・タブの中身）', () => {
  it('次へは右から・戻るは左から（24px＋薄く・240ms glide）', () => {
    expect(css).toMatch(
      /\[data-theme='v8'\] \.panel\[data-slide-direction='forward'\] \{\s*animation: slide-panel-forward var\(--motion-panel\) var\(--motion-glide\);/s,
    )
    expect(css).toMatch(
      /\[data-theme='v8'\] \.panel\[data-slide-direction='back'\] \{\s*animation: slide-panel-back var\(--motion-panel\) var\(--motion-glide\);/s,
    )
    expect(css).toMatch(/translateX\(24px\)/)
    expect(css).toMatch(/translateX\(-24px\)/)
  })

  it('目印と向きを受け取り、向きをそのまま出す', () => {
    expect(source).toMatch(/panelKey: string/)
    expect(source).toMatch(/direction: SlideDirection/)
    expect(source).toMatch(/data-slide-direction=\{direction\}/)
    expect(source).toMatch(/key=\{panelKey\}/)
  })

  it('v7 の規定は持たない（V8 のときだけ動く）', () => {
    expect(css).not.toMatch(/\[data-theme='v7'\]/)
    // 動かす行はすべて V8 の印付き（v7 では目印が変わっても今までどおり）。
    const bad = css
      .split('\n')
      .filter((line) => line.includes('animation: slide-panel') && !line.includes("[data-theme='v8']"))
    expect(bad).toEqual([])
  })
})
