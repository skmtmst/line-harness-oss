// @vitest-environment happy-dom
/*
 * リッチメニューを友だちへ表示する窓の、一括適用の鍵の試験。
 * - 失敗のあとの「やり直す」は同じ鍵で送る（台帳へ二重に記録しない）
 * - 相手を変えたら新しい鍵で送る
 */
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { ApplyToTagModal } from './apply-to-tag-modal'

type Sent = { key: string | null; body: unknown }
let sent: Sent[] = []
let fail = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  sent = []
  fail = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/tags') return json({ success: true, data: [{ id: 'tag-vip', name: 'VIP', color: '#16a34a' }] })
    if (url.pathname === '/api/rich-menu-groups/g-1/apply-to-tag') {
      sent.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: JSON.parse(String(init?.body)) })
      return fail
        ? json({ success: false, error: 'busy' }, 500)
        : json({ success: true, data: { chunks: 1, total: 3 } })
    }
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function runOnce(view: ReturnType<typeof render>, expected: number) {
  fireEvent.click(view.getByRole('button', { name: '実行する' }))
  await waitFor(() => expect(sent).toHaveLength(expected))
}

describe('一括適用の鍵', () => {
  it('失敗のあとの「やり直す」は同じ鍵で送り、成功したら終わったと出す', async () => {
    const view = render(<ApplyToTagModal groupId="g-1" groupName="通常メニュー" onClose={() => {}} />)
    await runOnce(view, 1)
    fireEvent.click(await view.findByRole('button', { name: 'やり直す' }))
    fail = false
    await runOnce(view, 2)
    expect(sent[0].key).toBeTruthy()
    expect(sent[1].key).toBe(sent[0].key)
    expect(sent[1].body).toEqual({ mode: 'bulk-link', tagId: null })
    await view.findByText('✓ 完了しました')
  })

  it('相手をタグに変えたら新しい鍵で、そのタグへ送る', async () => {
    const view = render(<ApplyToTagModal groupId="g-1" groupName="通常メニュー" onClose={() => {}} />)
    await runOnce(view, 1)
    fireEvent.click(await view.findByRole('button', { name: 'やり直す' }))
    const tagChoice = await view.findByRole('radio', { name: /タグで絞り込んで適用/ })
    await waitFor(() => expect((tagChoice as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(tagChoice)
    await runOnce(view, 2)
    expect(sent[1].body).toEqual({ mode: 'bulk-link', tagId: 'tag-vip' })
    expect(sent[1].key).toBeTruthy()
    expect(sent[1].key).not.toBe(sent[0].key)
  })
})
