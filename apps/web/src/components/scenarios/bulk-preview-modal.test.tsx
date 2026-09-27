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

afterEach(() => {
  cleanup()
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
