// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import StatusBadge from '../components/shared/status-badge'
import styles from '../components/shared/status-badge.module.css'
import { contrastRatio, installSharedStyles } from '../components/shared/shared-style-test-support'

let removeStyles: () => void
beforeAll(async () => { removeStyles = await installSharedStyles([['status-badge', styles]]) })
afterAll(() => removeStyles?.())
afterEach(cleanup)

describe('状態を示す文字と背景は読み取れる明暗差を保つ', () => {
  it.each([
    ['accent-deep', 'on-accent', '選んだタブ'],
    ['danger', 'status-danger-soft', '設定不足'],
    ['ink-secondary', 'shell', '下書き'],
    ['success', 'success-bg', '公開中'],
    ['warning', 'warning-bg', '停止中'],
    ['accent-deep', 'accent-soft', '成功'],
    ['status-info-deep', 'status-info-soft', '情報'],
    ['status-warn-deep', 'status-warn-soft', '注意'],
    ['ink-faint', 'canvas-sunken', '停止中の補足'],
  ])('%sと%sの実効色は4.5:1以上', (fg, bg, label) => {
    render(<span style={{ color: `var(--color-${fg})`, backgroundColor: `var(--color-${bg})` }}>{label}</span>)
    const style = getComputedStyle(screen.getByText(label))
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['neutral', '下書き'], ['info', '予約中'], ['warning', '停止中'], ['caution', '要確認'],
    ['success', '配信中'], ['danger', '設定不足'],
  ] as const)('共通バッジの%sは文字と実際の配色を持つ', (tone, label) => {
    const { container } = render(<StatusBadge tone={tone}>{label}</StatusBadge>)
    expect(screen.getByText(label)).toBeTruthy()
    const style = getComputedStyle(container.firstElementChild!)
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })

  it('状態の札は色ごとに違う地の色を持ち、白地のままにしない', () => {
    const tones = ['neutral', 'info', 'warning', 'caution', 'success', 'danger'] as const
    const backgrounds = tones.map((tone) => {
      const { container } = render(<StatusBadge tone={tone}>{tone}</StatusBadge>)
      return getComputedStyle(container.firstElementChild!).backgroundColor
    })
    for (const background of backgrounds) expect(background).not.toMatch(/^(rgb\(255, 255, 255\)|#fff(fff)?|white|transparent|)$/i)
    expect(new Set(backgrounds).size).toBe(tones.length)
  })

  it.each([
    ['#ffffff', '#06c755'], ['#e5484d', '#fef0f0'],
  ])('読みにくい配色%sと%sを合格にしない', (color, backgroundColor) => {
    const { container } = render(<span style={{ color, backgroundColor }}>故障対照</span>)
    const style = getComputedStyle(container.firstElementChild!)
    expect(contrastRatio(style.color, style.backgroundColor)).toBeLessThan(4.5)
  })
})
