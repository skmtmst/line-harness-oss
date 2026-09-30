// @vitest-environment happy-dom
/*
 * Devin 監査：重い入力画面（時間・料金・担当・タグ）なのに、キャンセルで
 * 確認なしに入力が消えていた。入力後にキャンセルを押すと共通窓で止め、
 * 変更なしなら出さない。
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
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      tags: { list: async () => ({ success: true, data: [] }) },
      mileage: { rules: async () => ({ success: true, data: [] }) },
    },
    bookingApi: {
      createMenu: vi.fn(),
      getSettings: async () => ({ success: true, data: { menuCount: 1 } }),
      listStaff: async () => ({ staff: [] }),
      getStaffMenus: async () => ({ matrix: [] }),
      putStaffMenus: async () => ({ ok: true }),
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

import NewBookingMenuPage from './page'

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
  await act(async () => { root.render(<NewBookingMenuPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

async function typeMenuName(value: string) {
  const box = host.querySelector('input#bm-name') as HTMLInputElement
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

describe('booking/menus/new の未保存ガード', () => {
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

    await typeMenuName('カット')
    await flush()
    fireEvent.click(cancelLink())
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()

    fireEvent.click(bodyButton('編集を続ける'))
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
    expect((host.querySelector('input#bm-name') as HTMLInputElement).value).toBe('カット')
  })

  it('「保存せずに移る」を押すと予約設定へ進む', async () => {
    await render()
    await flush()

    await typeMenuName('カット')
    await flush()
    fireEvent.click(cancelLink())
    await flush()

    fireEvent.click(bodyButton('保存せずに移る'))
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/booking/menus')
  })
})
