// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  mediaList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  editor: vi.fn(),
  publish: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-a' }),
}))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後のウェビナーの判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string
    id?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/components/shared/confirm-dialog', () => ({
  default: ({ open, onConfirm, onCancel, confirmLabel }: {
    open: boolean
    onConfirm: () => void
    onCancel: () => void
    confirmLabel: string
  }) => open
    ? React.createElement('div', null,
      React.createElement('button', { onClick: onConfirm }, confirmLabel),
      React.createElement('button', { onClick: onCancel }, 'キャンセル'),
    )
    : null,
}))
vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    constructor(public status: number, message: string) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return {
    ApiError: MockApiError,
    extractApiErrorCode: () => null,
    api: { media: { list: fixture.mediaList } },
    webinarApi: { create: fixture.create, update: fixture.update, editor: fixture.editor, publish: fixture.publish },
  }
})

import WebinarForm from './webinar-form'
import type { Webinar } from '@/lib/api'

const MEDIA_VIDEO_1 = {
  id: 'med-1', lineAccountId: 'acc-a', folderId: null, kind: 'video' as const,
  filename: ' seminar-1.mp4', mimeType: 'video/mp4', sizeBytes: 1000,
  width: null, height: null, durationMs: 3600000, url: 'https://w.example/images/med-1',
  uploadedBy: null, createdAt: '2026-09-01T00:00:00.000Z',
}
const MEDIA_VIDEO_2 = { ...MEDIA_VIDEO_1, id: 'med-2', filename: 'seminar-2.mp4' }

const baseWebinar = (over: Partial<Webinar> = {}): Webinar => ({
  id: 'w1',
  accountId: 'acc-a',
  title: 'テストウェビナー',
  slug: 'test-webinar',
  status: 'draft',
  videoPrefix: null,
  videoMediaId: null,
  durationSeconds: 7200,
  schedule: [],
  cta: null,
  tagOnAttend: null,
  tagOnCtaClick: null,
  folderId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

beforeEach(() => {
  fixture.mediaList.mockReset()
  fixture.create.mockReset()
  fixture.update.mockReset()
  fixture.editor.mockReset()
  fixture.publish.mockReset()
  fixture.routerPush.mockReset()
  fixture.mediaList.mockResolvedValue({ success: true, data: { items: [MEDIA_VIDEO_1, MEDIA_VIDEO_2], total: 2, limit: 100, offset: 0 } })
  fixture.update.mockResolvedValue({ success: true, data: { id: 'w1' } })
  fixture.editor.mockResolvedValue({ success: true, data: { version: 7 } })
  fixture.publish.mockResolvedValue({ success: true, data: {} })
})

afterEach(cleanup)

describe('ウェビナー基本設定の動画選択 (N-115) と旧CTA撤去 (N-114)', () => {
  it('動画はメディア一覧から選び、保存には選択IDを送る', async () => {
    render(<WebinarForm initial={baseWebinar()} />)

    const select = await screen.findByRole('combobox', { name: '配信動画' })
    await waitFor(() => expect(fixture.mediaList).toHaveBeenCalledWith('acc-a', expect.objectContaining({ kind: 'video' })))

    fireEvent.change(select, { target: { value: 'med-2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    const [, input] = fixture.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(input.videoMediaId).toBe('med-2')
    expect(input).not.toHaveProperty('videoPrefix')
    expect(input).not.toHaveProperty('cta')
  })

  it('メディアに紐づく動画は選択状態で始まり、解除すると null を送る', async () => {
    render(<WebinarForm initial={baseWebinar({ videoPrefix: 'media/acc-a/video-1.mp4', videoMediaId: 'med-1' })} />)

    const select = await screen.findByRole('combobox', { name: '配信動画' }) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('med-1'))

    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    const [, input] = fixture.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(input.videoMediaId).toBeNull()
  })

  it('ライブラリ外のprefixは維持を選べ、保存では動画欄を送らない', async () => {
    render(<WebinarForm initial={baseWebinar({ videoPrefix: 'webinars/legacy-set', videoMediaId: null })} />)

    const select = await screen.findByRole('combobox', { name: '配信動画' }) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('__external__'))
    expect(screen.getByText('現在の設定を維持（ライブラリ外の動画）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    const [, input] = fixture.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(input).not.toHaveProperty('videoMediaId')
    expect(input).not.toHaveProperty('videoPrefix')
  })

  it('R2 prefix の自由入力欄と旧CTA欄はもう表示しない', async () => {
    render(<WebinarForm initial={baseWebinar()} />)
    await screen.findByRole('combobox', { name: '配信動画' })
    expect(screen.queryByText('動画 R2 プレフィックス')).toBeNull()
    expect(screen.queryByText('従来CTAボタンの設定')).toBeNull()
    expect(screen.queryByText('CTA ボタンを表示する')).toBeNull()
  })

  it('候補の読み込みに失敗したら再試行できる', async () => {
    fixture.mediaList.mockRejectedValueOnce(new Error('fail'))
    render(<WebinarForm initial={baseWebinar()} />)

    await screen.findByText('動画の候補を読み込めませんでした。')
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(fixture.mediaList).toHaveBeenCalledTimes(2))
    await screen.findByRole('combobox', { name: '配信動画' })
  })
})

describe('R95 基本設定からの公開は公開専用口を通す', () => {
  it('公開中を選んだ保存は通常更新にactiveを送らず公開専用口を呼ぶ', async () => {
    render(<WebinarForm initial={baseWebinar()} />)

    const statusSelect = await screen.findByRole('combobox', { name: '公開状態' })
    const videoSelect = await screen.findByRole('combobox', { name: '配信動画' })
    fireEvent.change(statusSelect, { target: { value: 'active' } })
    fireEvent.change(videoSelect, { target: { value: 'med-1' } })
    // 公開の足切り（動画・枠）を満たすため枠を1件足す
    fireEvent.click(screen.getByRole('button', { name: '＋ ルールを追加する' }))
    fireEvent.click(screen.getByRole('button', { name: '公開する' }))

    // 確認ダイアログで「この内容で公開する」を押す
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で公開する' }))

    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    const [, input] = fixture.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(input.status).toBe('draft')
    await waitFor(() => expect(fixture.publish).toHaveBeenCalledWith('w1', 7))
    expect(fixture.routerPush).toHaveBeenCalledWith('/webinars/published?id=w1')
  })

  it('下書きのままの保存は公開専用口を呼ばない', async () => {
    render(<WebinarForm initial={baseWebinar()} />)
    await screen.findByRole('combobox', { name: '配信動画' })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    expect(fixture.publish).not.toHaveBeenCalled()
    expect(fixture.routerPush).toHaveBeenCalledWith('/webinars')
  })
})
