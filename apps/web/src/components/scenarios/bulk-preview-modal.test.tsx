// @vitest-environment happy-dom
import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'

/*
 * シナリオの一括プレビューは共通の Dialog で出す（監査の直し）。
 * フォーカスの移動・Esc で閉じるは Dialog（useOverlayFocus）が持つ。
 * 直しを戻す（手書きの div に戻す）と、この試験は赤くなる。
 */
vi.mock('@/lib/api', () => ({
  api: { scenarios: { preview: vi.fn(() => new Promise(() => {})) } },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import BulkPreviewModal from './bulk-preview-modal'
import { api } from '@/lib/api'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('一括プレビューは共通の Dialog', () => {
  it('窓の役割と名前を持つ', () => {
    render(<BulkPreviewModal open scenarioId="sc-1" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '一括プレビュー' })).toBeTruthy()
  })

  it('Esc で閉じる', () => {
    const onClose = vi.fn()
    render(<BulkPreviewModal open scenarioId="sc-1" onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: '一括プレビュー' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('閉じ方は右上の×（フッターに閉じるボタンを置かない）', () => {
    const { container } = render(<BulkPreviewModal open scenarioId="sc-1" onClose={vi.fn()} />)
    expect(container.ownerDocument.body.innerHTML).toContain('aria-label="閉じる"')
    expect(container.ownerDocument.body.innerHTML).not.toContain('>閉じる<')
  })

  it('閉じているときは何も出さない', () => {
    const { container } = render(<BulkPreviewModal open={false} scenarioId="sc-1" onClose={vi.fn()} />)
    expect(container.innerHTML).not.toContain('一括プレビュー')
  })
})

/*
 * R212: 下書きの通を一括プレビューで区別せず表示する。
 * 送られる通と誤解するので、下書きには札を付け、実際の配信と
 * 友だち別の予定には入らないことを窓の説明に書く。
 * 直しを戻す（札を外す）と、この試験は赤くなる。
 */
describe('R212: 一括プレビューは下書きを区別する', () => {
  it('下書きの通に札を付け、扱いの説明を出す', async () => {
    vi.mocked(api.scenarios.preview).mockResolvedValueOnce({
      success: true,
      data: {
        startAt: '2026-09-28T10:00:00+09:00',
        steps: [
          {
            stepOrder: 1,
            deliveryAt: '2026-09-28T10:00:00+09:00',
            deliveryAtLabel: 'Day 0 10:00 (日)',
            messageType: 'テキスト',
            messageContent: '通常の通',
            isDraft: false,
          },
          {
            stepOrder: 2,
            deliveryAt: '2026-09-29T10:00:00+09:00',
            deliveryAtLabel: 'Day 1 10:00 (月)',
            messageType: 'テキスト',
            messageContent: '下書きの通',
            isDraft: true,
          },
        ],
      },
    })
    render(<BulkPreviewModal open scenarioId="sc-1" onClose={vi.fn()} />)
    expect(await screen.findByText('下書き')).toBeTruthy()
    expect(
      screen.getByText('起点からの各通の届く日時と内容の見本です。送りはしません。下書きの通には札を付けますが、実際の配信と友だち別の予定には入りません。'),
    ).toBeTruthy()
  })
})
