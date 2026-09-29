// @vitest-environment happy-dom
/*
 * Devin 監査：重い入力画面（3つの節＋担当メニュー割当）なのに、キャンセルで
 * 確認なしに入力が消えていた。入力後にキャンセルを押すと共通窓で止め、
 * 変更なしなら出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listMenus: async () => ({ menus: [] }),
  createStaff: vi.fn(),
  putStaffMenus: vi.fn(),
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
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { staff: { list: async () => ({ success: true, data: [] }) } },
    bookingApi: {
      listMenus: fixture.listMenus,
      createStaff: fixture.createStaff,
      putStaffMenus: fixture.putStaffMenus,
    },
  }
})

const memStorage = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
  }
})
vi.stubGlobal('localStorage', memStorage)

import NewBookingStaffPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  memStorage.clear()
  memStorage.setItem('lh_staff_role', 'owner')
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
  await act(async () => { root.render(<NewBookingStaffPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

async function typeName(value: string) {
  const box = host.querySelector('input#bs-name') as HTMLInputElement
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

describe('booking/staff/new の未保存ガード', () => {
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

    await typeName('田中')
    await flush()
    expect((host.querySelector('input#bs-name') as HTMLInputElement).value).toBe('田中')
    fireEvent.click(cancelLink())
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()

    fireEvent.click(bodyButton('編集を続ける'))
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
    expect((host.querySelector('input#bs-name') as HTMLInputElement).value).toBe('田中')
  })

  it('「保存せずに移動」を押すと予約設定へ進む', async () => {
    await render()
    await flush()

    await typeName('田中')
    await flush()
    fireEvent.click(cancelLink())
    await flush()

    fireEvent.click(bodyButton('保存せずに移動'))
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/booking/menus?tab=staff')
  })
})
