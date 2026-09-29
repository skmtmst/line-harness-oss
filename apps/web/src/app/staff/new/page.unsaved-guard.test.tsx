// @vitest-environment happy-dom
/*
 * Devin 監査：重い入力画面（5つの節）なのに、キャンセルで確認なしに
 * 入力が消えていた。入力後にキャンセル・画面内リンクを押すと共通窓で
 * 止め、変更なしなら出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  staffCreate: vi.fn(),
  lineAccountList: vi.fn(),
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
    selectedAccount: { id: 'account-a', name: '店舗A' },
    accounts: [],
    loading: false,
  }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      staff: { create: fixture.staffCreate },
      lineAccounts: { list: fixture.lineAccountList },
    },
  }
})

import NewStaffPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.staffCreate.mockReset()
  fixture.lineAccountList.mockReset()
  fixture.lineAccountList.mockResolvedValue({ success: true, data: [] })
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
  await act(async () => { root.render(<NewStaffPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function cancelLink(): HTMLAnchorElement {
  const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'キャンセル')
  if (!link) throw new Error('キャンセルのリンクが見つかりません')
  return link as HTMLAnchorElement
}

function nameBox(): HTMLInputElement {
  const box = host.querySelector('input#staff-name')
  if (!box) throw new Error('名前の入力欄が見つかりません')
  return box as HTMLInputElement
}

async function typeName(value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(nameBox(), value)
    nameBox().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="dialog"], [role="alertdialog"]')
}

function bodyButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!button) throw new Error(`「${label}」が見つかりません`)
  return button as HTMLButtonElement
}

describe('staff/new の未保存ガード', () => {
  it('未入力のままキャンセルを押しても確認は出ない', async () => {
    await render()
    await flush()

    await act(async () => { fireEvent.click(cancelLink()) })
    await flush()

    expect(dialog()).toBeNull()
    expect(document.body.textContent).not.toContain('保存していない変更があります')
  })

  it('入力後にキャンセルを押すと確認が出て、残ると入力は消えない', async () => {
    await render()
    await flush()

    await typeName('山田')
    await flush()
    expect(nameBox().value).toBe('山田')
    fireEvent.click(cancelLink())
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(bodyButton('編集を続ける')) })
    await flush()

    expect(dialog()).toBeNull()
    expect(nameBox().value).toBe('山田')
  })

  it('「保存せずに移動」を押すと一覧へ進む', async () => {
    await render()
    await flush()

    await typeName('山田')
    await flush()
    await act(async () => { fireEvent.click(cancelLink()) })
    await flush()

    await act(async () => { fireEvent.click(bodyButton('保存せずに移動')) })
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/staff?tab=members')
  })
})
