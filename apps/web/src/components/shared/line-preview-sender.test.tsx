// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinePreviewMessage } from './line-preview'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('見本の送り主名の全文確認', () => {
  it('長名の全文を保持し、ホバーとフォーカスで確認できる', async () => {
    const name = '長いアカウント名を最後まで確認します'
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    render(<LinePreviewMessage accountName={name} avatar="店" time="10:00">見本の本文</LinePreviewMessage>)
    await act(async () => { await Promise.resolve() })
    const sender = screen.getByText(name)
    expect(sender.title).toBe(name)
    expect(sender.tabIndex).toBe(0)
    fireEvent.mouseEnter(sender)
    expect(screen.getByRole('tooltip').textContent).toBe(name)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.focus(sender)
    expect(screen.getByRole('tooltip').textContent).toBe(name)
    expect(screen.getByText('見本の本文')).toBeTruthy()
    expect(screen.getByText('10:00')).toBeTruthy()
  })

  it.each(['Kenta', ''])('短い名前や空の名前にも切り詰めた値を作らない（%s）', async name => {
    const view = render(<LinePreviewMessage accountName={name} avatar={null} time="">本文</LinePreviewMessage>)
    await act(async () => { await Promise.resolve() })
    const sender = view.container.querySelector('[class*="senderName"]') as HTMLElement
    expect(sender.textContent).toBe(name)
    expect(sender.title).toBe(name)
    expect(sender.hasAttribute('tabindex')).toBe(false)
  })

  it('送信側は送り主の欄を足さず、本文と時刻だけを残す', () => {
    const view = render(<LinePreviewMessage direction="outgoing" accountName="送り主" avatar="店" time="10:01">返信の本文</LinePreviewMessage>)
    expect(view.container.querySelector('[data-truncated-text]')).toBeNull()
    expect(screen.queryByText('送り主')).toBeNull()
    expect(screen.getByText('返信の本文')).toBeTruthy()
    expect(screen.getByText('10:01')).toBeTruthy()
  })
})
