// @vitest-environment happy-dom
/*
 * #816 — 記録のタブ（C-3）の描画。
 *
 * 読み込み中・失敗・空・正常の4つを固定する。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ activity: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: { broadcasts: { activity: fixture.activity } } }))

import BroadcastActivity from './broadcast-activity'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const formatDateTime = (value: string | null | undefined) => value ?? '—'

describe('記録のタブ', () => {
  it('読み込み中は1枚だけ出す', () => {
    fixture.activity.mockImplementation(() => new Promise(() => undefined))
    render(<BroadcastActivity broadcastId="b1" formatDateTime={formatDateTime} />)
    expect(screen.getByText('記録を読み込んでいます')).toBeTruthy()
  })

  it('失敗は読み直せる', () => {
    fixture.activity.mockRejectedValue(new Error('down'))
    render(<BroadcastActivity broadcastId="b1" formatDateTime={formatDateTime} />)
    return waitFor(() => expect(screen.getByText('記録を表示できませんでした')).toBeTruthy())
  })

  it('空は記録が増えたら出ると書く', async () => {
    fixture.activity.mockResolvedValue({ success: true, data: [] })
    render(<BroadcastActivity broadcastId="b1" formatDateTime={formatDateTime} />)
    await waitFor(() => expect(screen.getByText('記録はまだありません')).toBeTruthy())
  })

  it('操作と承認を新しい順に並べる', async () => {
    fixture.activity.mockResolvedValue({
      success: true,
      data: [
        { kind: 'lifecycle', action: 'send_started', label: '送信を始めた', actorStaffId: null, actorName: '自動', reason: null, createdAt: '10/1 10:00' },
        { kind: 'approval', action: 'approved', label: '承認した', actorStaffId: 's1', actorName: '佐藤美咲', reason: null, createdAt: '9/25 21:02' },
      ],
    })
    render(<BroadcastActivity broadcastId="b1" formatDateTime={formatDateTime} />)
    await waitFor(() => expect(screen.getByText('送信を始めた')).toBeTruthy())
    const items = screen.getByLabelText('記録').textContent ?? ''
    expect(items.indexOf('送信を始めた')).toBeLessThan(items.indexOf('承認した'))
    expect(items).toContain('記録は消せません')
  })
})
