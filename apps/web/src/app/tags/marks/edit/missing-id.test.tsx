// @vitest-environment happy-dom
/*
 * 監査 Issue #1058: /tags/marks/edit を `?id=` なしで開くと、以前は
 * 新規作成の器（/tags/marks/new と同じ）が黙って出ていた。
 * 編集ルートでは対象未指定の案内と一覧への口を出すことを確かめる。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ search: '' }))
const captured = vi.hoisted(() => ({ markId: undefined as string | undefined }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
}))
vi.mock('@/components/feature-gate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/friend-fields/support-mark-editor', () => ({
  default: ({ markId }: { markId?: string }) => {
    captured.markId = markId
    return <div data-testid="support-mark-editor" />
  },
}))
vi.mock('@/components/shared/list-state', () => ({
  default: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div>{title}{action}</div>
  ),
}))
vi.mock('@/components/shared/button', () => ({
  default: ({ href, children }: { href?: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import Page from './page'

afterEach(() => {
  cleanup()
  captured.markId = undefined
  state.search = ''
})

describe('#1058 対応マーク編集の `?id=` 欠落', () => {
  it('`?id=` なしでは作成フォームを出さず、一覧へ戻す案内を出す', () => {
    render(<Page />)
    expect(screen.getByText('対象の対応マークが指定されていません')).toBeTruthy()
    expect(screen.getByText('対応マークの一覧へ戻る').closest('a')?.getAttribute('href'))
      .toBe('/tags?tab=marks')
    // 編集器そのものは描かない（作成フォームが出ない）。
    expect(screen.queryByTestId('support-mark-editor')).toBeNull()
  })

  it('`?id=` ありでは編集器へそのIDを渡す', () => {
    state.search = 'id=mark-1'
    render(<Page />)
    expect(screen.getByTestId('support-mark-editor')).toBeTruthy()
    expect(captured.markId).toBe('mark-1')
    expect(screen.queryByText('対象の対応マークが指定されていません')).toBeNull()
  })
})
