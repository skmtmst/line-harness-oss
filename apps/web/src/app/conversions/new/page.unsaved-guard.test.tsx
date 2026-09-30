// @vitest-environment happy-dom
/*
 * Devin 監査：重い入力画面（金額・対象URL・数えない条件・使う場所）なのに、
 * キャンセルで確認なしに入力が消えていた。入力後にキャンセルを押すと
 * 共通窓で止め、変更なしなら出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: 'A店' },
    accounts: [{ id: 'account-a', name: 'A店' }],
  }),
}))
vi.mock('@/components/layout/header', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/lib/api', () => ({
  api: {
    conversions: {
      points: async () => ({ success: true, data: [] }),
      previewDefinition: async () => ({ success: false, error: 'preview unavailable' }),
    },
    analytics: { v6Funnels: { list: async () => ({ success: true, data: [] }) } },
    automations: { list: async () => ({ success: true, data: [] }) },
    nenCampaigns: { settings: async () => ({ success: true, data: [] }) },
    featureSettings: { visibility: async () => ({ success: true, data: { features: {} } }) },
    tags: { list: async () => ({ success: true, data: [] }) },
    friendFields: { list: async () => ({ success: true, data: [] }) },
    supportMarks: { list: async () => ({ success: true, data: [] }) },
    scenarios: { list: async () => ({ success: true, data: [] }) },
  },
}))

import NewConversionPointPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  // 空のまま押したキャンセルが happy-dom を実際に遷移させる。
  // 次の試験が「同じURLへのリンク」と見なさないよう、URLを戻す。
  window.history.replaceState(null, '', '/')
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render() {
  await act(async () => { root.render(<NewConversionPointPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

async function typeName(value: string) {
  const box = host.querySelector('input#cv-name') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function cancelLink(): HTMLAnchorElement {
  const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'キャンセル')
  if (!link) throw new Error('キャンセルのリンクが見つかりません')
  return link as HTMLAnchorElement
}

function bodyButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!button) throw new Error(`「${label}」が見つかりません`)
  return button as HTMLButtonElement
}

describe('conversions/new の未保存ガード', () => {
  it('未入力のままキャンセルを押しても確認は出ない', async () => {
    await render()
    await flush()

    fireEvent.click(cancelLink())
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
  })

  it('入力後にキャンセルを押すと確認が出て、残ると入力は消えない', async () => {
    await render()
    await flush()

    await typeName('購入完了')
    await flush()
    fireEvent.click(cancelLink())
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()

    fireEvent.click(bodyButton('編集を続ける'))
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
    expect((host.querySelector('input#cv-name') as HTMLInputElement).value).toBe('購入完了')
  })

  it('「保存せずに移る」を押すと一覧へ進む', async () => {
    await render()
    await flush()

    await typeName('購入完了')
    await flush()
    fireEvent.click(cancelLink())
    await flush()

    fireEvent.click(bodyButton('保存せずに移る'))
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/conversions?tab=points')
  })
})
