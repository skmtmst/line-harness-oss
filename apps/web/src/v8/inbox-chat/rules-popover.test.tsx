// @vitest-environment happy-dom
/*
 * 受信箱の頭の「対応ルール」（M0393 XqSvX）。押してもページを移らず、その場で小窓を開く。
 * - 押すと小窓が開き、対応マークと自動で付く決まりを出す（ページへのリンクではない）
 * - 読み込めないときは理由と「もう一度読み込む」
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const list = vi.fn()
vi.mock('@/lib/api', () => ({ api: { supportMarks: { list: (...args: unknown[]) => list(...args) } } }))

import InboxRulesPopover from './rules-popover'

const mark = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, color: '#b3261e', isDefault: false, autoOnInbound: false, displayOrder: 0, createdAt: '', friendCount: 0, automationRules: [], ...extra,
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  list.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('対応ルールの小窓', () => {
  test('押すとページを移らずに小窓を開き、マークと決まりを出す', async () => {
    list.mockResolvedValue({ success: true, data: [mark('m1', '未対応', { autoOnInbound: true }), mark('m2', '保留')] })
    render(<InboxRulesPopover accountId="acc-1" />)
    const button = screen.getByRole('button', { name: '対応ルール' })
    // ページへのリンク（a 要素）ではなく、その場で開くボタン
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('href')).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByText('受信したとき自動で付く')).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '対応ルール' })).toBeTruthy()
    expect(screen.getByText('保留')).toBeTruthy()
    expect(screen.getByText('手動だけ')).toBeTruthy()
    expect(list).toHaveBeenCalledWith('acc-1')
  })

  test('読み込めないときは理由と「もう一度読み込む」', async () => {
    list.mockResolvedValueOnce({ success: false, error: 'x' })
    list.mockResolvedValueOnce({ success: true, data: [mark('m1', '対応中')] })
    render(<InboxRulesPopover accountId="acc-1" />)
    fireEvent.click(screen.getByRole('button', { name: '対応ルール' }))
    await waitFor(() => expect(screen.getByText('対応ルールを読み込めませんでした。')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(screen.getByText('対応中')).toBeTruthy())
  })
})
