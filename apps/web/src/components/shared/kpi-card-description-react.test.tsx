// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MoreHorizontal } from 'lucide-react'
import KpiCard, { type KpiCardProps } from './kpi-card'

/**
 * #1005: 長い理由・定義は説明アイコンのポップオーバーへ。
 * クリックで開き、Escで閉じて元の位置へ戻ることを実物のReactで確かめる。
 */
describe('KpiCardの説明ポップオーバー', () => {
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

  async function render(overrides: Partial<KpiCardProps> = {}) {
    await act(async () => {
      root.render(
        <KpiCard
          title="視聴"
          value={null}
          unit="人"
          detail="未取得"
          description="実際に見た区間の記録をまだ集計できないため"
          {...overrides}
        />,
      )
      await Promise.resolve()
    })
  }

  it('閉じている間は短い状態だけ、開くと全文が読める', async () => {
    await render()
    expect(host.querySelector('[data-kpi-label]')?.textContent).toBe('視聴')
    expect(host.textContent).toContain('未取得')
    expect(host.textContent).not.toContain('実際に見た区間の記録をまだ集計できないため')

    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => { button!.click(); await Promise.resolve() })
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('実際に見た区間の記録をまだ集計できないため')
  })

  it('省略する補足の全文をtitleへ残し、文中の数と要素も失わない', async () => {
    await render({ detail: <>タグ・<strong>シナリオ</strong>・対応マークなど {12}件</> })
    const note = host.querySelector('[data-kpi-detail] [role="note"]')!
    expect(note.textContent).toBe('タグ・シナリオ・対応マークなど 12件')
    expect(note.getAttribute('title')).toBe(note.textContent)
    expect(note.querySelector('strong')?.textContent).toBe('シナリオ')
  })

  it('括弧の前で補足を2行に分け、全文と行き先と再試行を保つ', async () => {
    const retry = vi.fn(), action = vi.fn()
    await render({ detail: '購読の数（再参加を含む）', detailLayout: 'qualifier', onRetry: retry, action: { label: '一覧を見る', onClick: action } })
    const note = host.querySelector('[data-kpi-detail] [role="note"]')!
    expect(note.textContent).toBe('購読の数\n（再参加を含む）')
    expect(note.getAttribute('title')).toBe('購読の数（再参加を含む）')
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-kpi-detail] button')
    await act(async () => {
      buttons[0].click()
      buttons[1].click()
    })
    expect(retry).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledOnce()
  })

  it('絵に？がある題の指定だけ、説明の印を追加する', async () => {
    await render({ helpDisplay: 'question' })
    expect(host.querySelector('[data-kpi-label]')?.textContent).toBe('視聴')
    expect(host.querySelector('[data-kpi-label] svg[data-help-mark]')).not.toBeNull()
    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(host.textContent).toContain('実際に見た区間の記録をまだ集計できないため')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(document.activeElement).toBe(button)
  })

  it('印のない題も、題から説明と詳しい行き先を読める', async () => {
    await render({ icon: null, helpHref: '/analytics', helpHrefLabel: '計算方法' })
    expect(host.querySelector('[data-kpi-icon]')).toBeNull()
    expect(host.querySelector('[data-kpi-label]')?.textContent).toBe('視聴')
    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/analytics')
    expect(host.querySelector('a')?.textContent).toBe('計算方法')
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

  it('titleだけの旧い説明も押して読め、Escで閉じられる', async () => {
    await render({ description: undefined, menu: <button type="button" title="見た区間の定義" aria-label="旧い説明"><MoreHorizontal size={16} aria-hidden="true" /></button> })
    expect(host.querySelector('[aria-label="旧い説明"]')).toBeNull()
    const button = host.querySelector('button[aria-label="視聴の説明"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(host.textContent).toContain('見た区間の定義')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(host.textContent).not.toContain('見た区間の定義')
    expect(document.activeElement).toBe(button)
  })

  it('操作を持つメニューの押下を保つ', async () => {
    const onClick = vi.fn()
    await render({ description: undefined, menu: <button type="button" title="内訳を開く" aria-label="操作" onClick={onClick}>…</button> })
    await act(async () => { (host.querySelector('[aria-label="操作"]') as HTMLButtonElement).click() })
    expect(onClick).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="視聴の説明"]')).toBeNull()
  })

  it('無効な操作を説明の押し口へ変えない', async () => {
    await render({ description: undefined, menu: <button type="button" title="管理者だけの操作" aria-label="管理操作" disabled>…</button> })
    expect((host.querySelector('[aria-label="管理操作"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('[aria-label="視聴の説明"]')).toBeNull()
  })

  it('図柄に操作がある場合もその押下を保つ', async () => {
    const onClick = vi.fn()
    await render({ description: undefined, menu: <button type="button" title="内訳" aria-label="図柄の操作"><MoreHorizontal size={16} aria-hidden="true" onClick={onClick} /></button> })
    await act(async () => { host.querySelector('[aria-label="図柄の操作"] svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onClick).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="視聴の説明"]')).toBeNull()
  })

  it('すでに説明があるときは、別のtitleの情報も残す', async () => {
    await render({ help: '集計の定義', menu: <button type="button" title="別の補足" aria-label="別の説明">…</button> })
    expect(host.querySelector('[aria-label="別の説明"]')?.getAttribute('title')).toBe('別の補足')
    await act(async () => { (host.querySelector('[aria-label="視聴の説明"]') as HTMLButtonElement).click() })
    expect(host.textContent).toContain('集計の定義')
  })
})
