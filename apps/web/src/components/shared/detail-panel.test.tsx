// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DetailPanel, { useDetailPanelUrl } from './detail-panel'

afterEach(() => {
  cleanup()
})

function renderPanel(props?: Partial<React.ComponentProps<typeof DetailPanel>>) {
  return render(
    <DetailPanel open title="配信A" onClose={() => {}} {...props}>
      <p>中身</p>
    </DetailPanel>,
  )
}

describe('DetailPanel（右から出る詳細・C①）', () => {
  it('閉じているときは何も出さない', () => {
    renderPanel({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('配信A')).toBeNull()
  })

  it('名前付きの詳細パネルへ焦点を移し、閉じると元の行へ戻す', () => {
    const row = document.createElement('button')
    document.body.append(row)
    row.focus()
    const rendered = renderPanel()
    const panel = screen.getByRole('dialog', { name: '配信A' })
    expect(document.activeElement).toBe(panel)
    rendered.rerender(<DetailPanel open={false} title="配信A" onClose={() => {}} />)
    expect(document.activeElement).toBe(row)
    row.remove()
  })

  it('↑↓で前・次の行へ、端では押せない', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderPanel({ onPrev, onNext, hasPrev: false, hasNext: true })
    expect((screen.getByRole('button', { name: '前の行' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(onPrev).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(onNext).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '次の行' }))
    expect(onNext).toHaveBeenCalledTimes(2)
  })

  it('入力欄の中では上下キーを横取りしない', () => {
    const onPrev = vi.fn()
    render(
      <DetailPanel open title="配信A" onClose={() => {}} onPrev={onPrev} hasPrev>
        <input aria-label="名前" defaultValue="x" />
      </DetailPanel>,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名前' }), { key: 'ArrowUp' })
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('Esc で閉じる', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('useDetailPanelUrl（URL に今の行を残す）', () => {
  function Probe({ id }: { id: string }) {
    const [current, change] = useDetailPanelUrl('row')
    return (
      <button type="button" onClick={() => change(current === id ? null : id)}>
        {current ?? 'なし'}
      </button>
    )
  }

  it('?row=id を読んで置き換える', async () => {
    window.history.replaceState(null, '', '/broadcasts')
    render(<Probe id="b1" />)
    expect(screen.getByRole('button').textContent).toBe('なし')
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(new URLSearchParams(window.location.search).get('row')).toBe('b1')
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(new URLSearchParams(window.location.search).get('row')).toBeNull()
    window.history.replaceState(null, '', '/broadcasts')
  })
})
