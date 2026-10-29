// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'
import { PostMediaPickerDialog } from './post-media-picker-dialog'

const fixture = vi.hoisted(() => ({
  list: vi.fn(),
  contentUrl: vi.fn((id: string) => `https://example.test/media/${id}`),
}))

vi.mock('@/lib/api', () => ({
  api: { media: { list: fixture.list, contentUrl: fixture.contentUrl } },
  ApiError: class ApiError extends Error {},
}))

const media = (id: string, date: string): MediaItem => ({
  id, lineAccountId: 'account-1', folderId: null, kind: 'image',
  filename: `${id}.jpg`, mimeType: 'image/jpeg', sizeBytes: 100,
  width: 1200, height: 900, durationMs: null, url: '',
  uploadedBy: null, createdAt: date,
})

beforeEach(() => {
  fixture.list.mockReset()
  fixture.list.mockResolvedValue({ success: true, data: { items: [media('new', '2026-10-29T00:00:00Z'), media('old', '2026-10-28T00:00:00Z')], total: 2, limit: 20, offset: 0 } })
})

afterEach(() => cleanup())

describe('投稿画像の登録メディア選択窓', () => {
  it.each(['google', 'instagram'] as const)('%s 用の窓で新しい順に読み、選択後だけ切り取りへ進める', async (target) => {
    const onSelect = vi.fn().mockResolvedValue(undefined)
    render(<PostMediaPickerDialog target={target} accountId="account-1" onClose={vi.fn()} onSelect={onSelect} />)
    expect(await screen.findByRole('dialog', { name: target === 'google' ? 'Google用画像を登録メディアから選ぶ' : 'Instagram用画像を登録メディアから選ぶ' })).toBeTruthy()
    await screen.findByText('new.jpg')
    expect(fixture.list).toHaveBeenCalledWith('account-1', { kind: 'image', query: undefined, sort: 'newest', limit: 20, offset: 0 })
    expect(screen.getAllByRole('radio').map((node) => node.textContent)).toEqual([
      expect.stringContaining('new.jpg'), expect.stringContaining('old.jpg'),
    ])
    const confirm = screen.getByRole('button', { name: '切り取り位置を確認' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /old.jpg/ }))
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'old' })))
  })

  it('キャンセルでonCloseを呼ぶ', async () => {
    const onClose = vi.fn()
    render(<PostMediaPickerDialog target="google" accountId="account-1" onClose={onClose} onSelect={vi.fn()} />)
    await screen.findByText('new.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('画像名で検索し、該当しない結果と通信失敗を区別する', async () => {
    fixture.list.mockResolvedValueOnce({ success: true, data: { items: [], total: 0, limit: 20, offset: 0 } })
    render(<PostMediaPickerDialog target="google" accountId="account-1" onClose={vi.fn()} onSelect={vi.fn()} />)
    await screen.findByText('選べる画像がありません')
    fireEvent.change(screen.getByRole('textbox', { name: '画像名で検索' }), { target: { value: '料理' } })
    fireEvent.click(screen.getByRole('button', { name: '検索' }))
    await waitFor(() => expect(fixture.list).toHaveBeenCalledWith('account-1', { kind: 'image', query: '料理', sort: 'newest', limit: 20, offset: 0 }))
  })
})
