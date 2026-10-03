// @vitest-environment happy-dom
/*
 * 成果の詳細の引き出しは共通の焦点管理を使う。開いている間はフォーカスが
 * 内側を循環し、Escapeで閉じて起動ボタンへ戻る。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useState } from 'react'

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      reportV2: async () => ({ success: true, data: null }),
      links: async () => ({ success: true, data: [] }),
      journeys: async () => ({ success: true, data: { items: [], cursor: null } }),
      settlementPreview: async () => ({ success: true, data: { affiliates: [] } }),
    },
  },
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

const { default: AffiliateDrawerV8 } = await import('./v8-drawer')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

const row = {
  id: 'a1',
  name: '山田',
  code: 'YMD-1',
  isActive: true,
} as unknown as Parameters<typeof AffiliateDrawerV8>[0]['affiliate']

function Opener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        詳細を開く
      </button>
      {open ? (
        <AffiliateDrawerV8
          affiliate={row}
          accountId="acc-1"
          canEdit={false}
          startInEdit={false}
          linkBaseUrl="https://example.invalid"
          onClose={() => setOpen(false)}
          onChanged={() => {}}
          onStopRequest={() => {}}
        />
      ) : null}
    </>
  )
}

describe('成果引き出しは共通の窓の動きをする', () => {
  test('Escapeで閉じる', async () => {
    render(<Opener />)
    fireEvent.click(screen.getByRole('button', { name: '詳細を開く' }))
    await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('閉じたら起動ボタンへフォーカスが戻る', async () => {
    render(<Opener />)
    const trigger = screen.getByRole('button', { name: '詳細を開く' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
