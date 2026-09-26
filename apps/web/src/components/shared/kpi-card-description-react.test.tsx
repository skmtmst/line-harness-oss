// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SummaryCard from './summary-card'

/**
 * #1005: 長い理由・定義は説明アイコンのポップオーバーへ。
 * クリックで開き、Escで閉じて元の位置へ戻ることを実物のReactで確かめる。
 */
describe('SummaryCardの説明ポップオーバー', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  async function render() {
    await act(async () => {
      root.render(
        <SummaryCard
          title="視聴"
          value={null}
          unit="人"
          detail="未取得"
          description="実際に見た区間の記録をまだ集計できないため"
        />,
      )
      await Promise.resolve()
    })
  }

  it('閉じている間は短い状態だけ、開くと全文が読める', async () => {
    await render()
    expect(host.textContent).toContain('未取得')
    expect(host.textContent).not.toContain('実際に見た区間の記録をまだ集計できないため')

    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { button!.click(); await Promise.resolve() })
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('実際に見た区間の記録をまだ集計できないため')
  })

  it('Escで閉じて説明アイコンへ戻る', async () => {
    await render()
    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement
    await act(async () => { button.click(); await Promise.resolve() })
    expect(host.textContent).toContain('実際に見た区間の記録をまだ集計できないため')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })
    expect(host.textContent).not.toContain('実際に見た区間の記録をまだ集計できないため')
    expect(document.activeElement).toBe(button)
  })

  it('カードの外を押すと閉じる', async () => {
    await render()
    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement
    await act(async () => { button.click(); await Promise.resolve() })
    expect(host.textContent).toContain('実際に見た区間の記録をまだ集計できないため')

    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await Promise.resolve()
    })
    expect(host.textContent).not.toContain('実際に見た区間の記録をまだ集計できないため')
  })
})
