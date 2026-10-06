// @vitest-environment happy-dom
/*
 * ★V8 一斉配信 かんたんに送る（`P6vbxn`）。
 * 本文・相手・いつ・人数の見込み・承認の順に並べ、
 * 送る・予約・承認を頼むまで一通りできる。v7 は変えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuickSendDialog from './quick-send-dialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const net = vi.hoisted(() => ({
  calls: [] as string[],
  audienceCount: 100,
}))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: {
        ...actual.api.tags,
        list: async () => ({ success: true, data: [] }),
      },
      broadcasts: {
        ...actual.api.broadcasts,
        create: async () => { net.calls.push('create'); return { success: true, data: { id: 'b1' } } },
        send: async () => { net.calls.push('send'); return { success: true, data: null } },
        preflight: async () => ({
          success: true,
          data: { audienceCount: net.audienceCount, hiddenExcluded: 0, warnings: [] },
        }),
        approval: {
          ...actual.api.broadcasts.approval,
          candidates: async () => ({ success: true, data: [] }),
          request: async () => { net.calls.push('request'); return { success: true, data: null } },
        },
      },
    },
  }
})
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  net.calls = []
  net.audienceCount = 100
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

function renderDialog(props?: Partial<React.ComponentProps<typeof QuickSendDialog>>) {
  const onClose = vi.fn()
  const onSent = vi.fn()
  act(() => {
    root.render(<QuickSendDialog open accountId="account-a" onClose={onClose} onSent={onSent} {...props} />)
  })
  return { onClose, onSent }
}

describe('かんたんに送る（P6vbxn）', () => {
  it('板IDと見本の要素が出る', async () => {
    renderDialog()
    await act(async () => {})
    expect(document.body.querySelector('[data-design-node="P6vbxn"]')).not.toBeNull()
    expect(document.body.textContent).toContain('かんたんに送る')
    expect(document.body.textContent).toContain('友だち全員')
    expect(document.body.textContent).toContain('今すぐ')
    expect(document.body.textContent).toContain('詳しく作るへ')
  })

  it('本文を書いて送ると作って送る', async () => {
    renderDialog()
    await act(async () => {})
    const textarea = document.body.querySelector('textarea')
    expect(textarea).not.toBeNull()
    await act(async () => {
      textarea!.focus()
      // React の textarea へ文字を入れる
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '営業日のお知らせ')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const sendButton = Array.from(document.body.querySelectorAll('button'))
      .find((el) => el.textContent === '送る')
    expect(sendButton).toBeDefined()
    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(net.calls).toContain('create')
    expect(net.calls).toContain('send')
  })
})
