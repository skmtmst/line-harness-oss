// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  mediaList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-a' }),
}))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/components/shared/confirm-dialog', () => ({
  default: () => null,
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
    webinarApi: { create: fixture.create, update: fixture.update },
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
  fixture.routerPush.mockReset()
  fixture.mediaList.mockResolvedValue({ success: true, data: { items: [MEDIA_VIDEO_1, MEDIA_VIDEO_2], total: 2, limit: 100, offset: 0 } })
  fixture.update.mockResolvedValue({ success: true, data: { id: 'w1' } })
})

afterEach(cleanup)

describe('ウェビナー基本設定の動画選択 (N-115) と旧CTA撤去 (N-114)', () => {
  it('動画はメディア一覧から選び、保存には選択IDを送る', async () => {
    render(<WebinarForm initial={baseWebinar()} />)

    const select = await screen.findByRole('combobox', { name: '配信動画' })
    await waitFor(() => expect(fixture.mediaList).toHaveBeenCalledWith('acc-a', expect.objectContaining({ kind: 'video' })))

    fireEvent.change(select, { target: { value: 'med-2' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))

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
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))

    await waitFor(() => expect(fixture.update).toHaveBeenCalled())
    const [, input] = fixture.update.mock.calls[0] as [string, Record<string, unknown>]
    expect(input.videoMediaId).toBeNull()
  })

  it('ライブラリ外のprefixは維持を選べ、保存では動画欄を送らない', async () => {
    render(<WebinarForm initial={baseWebinar({ videoPrefix: 'webinars/legacy-set', videoMediaId: null })} />)

    const select = await screen.findByRole('combobox', { name: '配信動画' }) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('__external__'))
    expect(screen.getByText('現在の設定を維持（ライブラリ外の動画）')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))
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
