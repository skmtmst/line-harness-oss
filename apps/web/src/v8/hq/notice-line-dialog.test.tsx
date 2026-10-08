// @vitest-environment happy-dom
/*
 * 監査 WEB213：契約者専用 LINE の案内。読めなかったら「まだ設定されていません」と言わず、
 * 開き直したら前の確認コードを残さない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const net = vi.hoisted(() => ({ lineRegistration: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, hqNotices: { ...actual.api.hqNotices, lineRegistration: (...args: unknown[]) => net.lineRegistration(...args) } } }
})

import NoticeLineDialogV8 from './notice-line-dialog'
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('読めなかったら「まだ設定されていません」と言わない', async () => {
  net.lineRegistration.mockRejectedValue(new Error('down'))
  render(<NoticeLineDialogV8 open onClose={() => undefined} />)
  await waitFor(() => expect(screen.getByText(/案内を読み込めませんでした/)).toBeTruthy())
  expect(screen.queryByText(/まだ運営側で設定されていません/)).toBeNull()
})

test('開き直したとき、前の確認コードを出したままにしない', async () => {
  net.lineRegistration.mockResolvedValueOnce({ success: true, data: { available: true, addFriendUrl: 'https://line.me/x', accountName: '運営', linked: false, code: '123456' } })
  const view = render(<NoticeLineDialogV8 open onClose={() => undefined} />)
  await waitFor(() => expect(screen.getByLabelText('確認コード 123456')).toBeTruthy())
  net.lineRegistration.mockImplementation(() => new Promise(() => undefined))
  view.rerender(<NoticeLineDialogV8 open={false} onClose={() => undefined} />)
  await act(async () => { view.rerender(<NoticeLineDialogV8 open onClose={() => undefined} />) })
  expect(screen.queryByLabelText('確認コード 123456')).toBeNull()
})
