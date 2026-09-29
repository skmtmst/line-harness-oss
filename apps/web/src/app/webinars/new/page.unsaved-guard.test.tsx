// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/webinars/new" }
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWebinarPage from './page'

/*
 * R18: ウェビナー作成で入力してから一覧へ戻ると、確認なしで消えていた。
 * リッチメニュー作成と同じ共通の番兵（離れる・Esc・保存せず移動）を付ける。
 *
 * - 何も触っていない戻りはそのまま通す（確認を出さない）
 * - 名前・開催形式・フォルダを触っていたら「保存していない変更があります」
 * - 「保存せずに移動」で一覧へ、「入力を続ける」・Esc で残る
 */

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      folders: async () => ({ success: true, data: [] }),
      create: fixture.create,
    },
  }
})

/* happy-dom に localStorage は無い。booking 配下と同じ memory stub を置く。 */
const localStorageValues = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
    removeItem: (key: string) => { localStorageValues.delete(key) },
    clear: () => { localStorageValues.clear() },
  },
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.create.mockReset()
  fixture.create.mockResolvedValue({ success: true, data: { id: 'new-webinar' } })
  /* 保存できる担当者として描く（D001 の権限出し分けの対象外）。 */
  window.localStorage.setItem('lh_staff_role', 'owner')
  // 素の a 押下で happy-dom が実際に遷移するため、試験ごとに住所を戻す。
  // 戻さないと「同じ住所への移動」として番兵が正しく無視してしまう。
  window.history.replaceState(null, '', '/webinars/new')
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
  await act(async () => { root.render(<NewWebinarPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function backLink(): HTMLAnchorElement {
  const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('ウェビナー一覧'))
  if (!link) throw new Error('一覧への戻りリンクが見つかりません')
  return link as HTMLAnchorElement
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[role="alertdialog"], [role="dialog"]')
}

async function typeTitle(value: string) {
  const titleInput = host.querySelector('#webinar-title')! as HTMLInputElement
  await act(async () => {
    fireEvent.change(titleInput, { target: { value } })
  })
}

describe('ウェビナー作成の未保存離脱確認（R18）', () => {
  it('何も入力せずに戻ると確認は出ない', async () => {
    await render()
    await flush()

    await act(async () => { fireEvent.click(backLink()) })
    await flush()

    expect(dialog()).toBeNull()
    expect(document.body.textContent).not.toContain('保存していない変更があります')
  })

  it('名前を入れてから戻ると確認が出て、移動は止まる', async () => {
    await render()
    await flush()
    await typeTitle('QAウェビナー')

    await act(async () => { fireEvent.click(backLink()) })
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()
  })

  it('「保存せずに移動」で一覧へ進む', async () => {
    await render()
    await flush()
    await typeTitle('QAウェビナー')
    await act(async () => { fireEvent.click(backLink()) })
    await flush()

    const leave = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '保存せずに移動')
    if (!leave) throw new Error('「保存せずに移動」が見つかりません')
    await act(async () => { fireEvent.click(leave) })
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/webinars')
  })

  it('「入力を続ける」とEscでは残り、入力は消えない', async () => {
    await render()
    await flush()
    await typeTitle('QAウェビナー')
    await act(async () => { fireEvent.click(backLink()) })
    await flush()
    expect(document.body.textContent).toContain('保存していない変更があります')

    const stay = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '入力を続ける')
    if (!stay) throw new Error('「入力を続ける」が見つかりません')
    await act(async () => { fireEvent.click(stay) })
    await flush()
    expect(dialog()).toBeNull()
    expect(fixture.push).not.toHaveBeenCalled()

    // もう一度戻って Esc。窓だけ閉じて入力は残る。
    await act(async () => { fireEvent.click(backLink()) })
    await flush()
    expect(document.body.textContent).toContain('保存していない変更があります')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(dialog()).toBeNull()
    expect(fixture.push).not.toHaveBeenCalled()
    expect((host.querySelector('#webinar-title') as HTMLInputElement).value).toBe('QAウェビナー')
  })
})
