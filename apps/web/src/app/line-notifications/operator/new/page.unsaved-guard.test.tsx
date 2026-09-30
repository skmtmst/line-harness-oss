// @vitest-environment happy-dom
/*
 * Devin 監査：重い入力画面（条件・宛先・公開設定）なのに、やめる操作で
 * 確認なしに入力が消えていた。入力後にやめるを押すと共通窓で止め、
 * 変更なしなら出さない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  previewRecipients: vi.fn(),
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
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      lineNotifications: {
        operatorRules: {
          previewRecipients: fixture.previewRecipients,
          get: vi.fn(),
        },
      },
    },
  }
})

import NewOperatorNotificationPage from './page'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.previewRecipients.mockReset()
  fixture.previewRecipients.mockResolvedValue({ success: true, data: { items: [] } })
  // 空のまま押した操作が happy-dom を実際に遷移させる。
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
  await act(async () => { root.render(<NewOperatorNotificationPage />) })
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

async function typeName(value: string) {
  const box = host.querySelector('input#operator-name') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function quitLink(): HTMLAnchorElement {
  const link = Array.from(host.querySelectorAll('a')).find((a) => a.textContent === 'キャンセル')
  if (!link) throw new Error('やめるのリンクが見つかりません')
  return link as HTMLAnchorElement
}

function bodyButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!button) throw new Error(`「${label}」が見つかりません`)
  return button as HTMLButtonElement
}

describe('line-notifications/operator/new の未保存ガード', () => {
  it('初期値のままやめるを押しても確認は出ない', async () => {
    await render()
    await flush()

    fireEvent.click(quitLink())
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
  })

  it('入力後にやめるを押すと確認が出て、残ると入力は消えない', async () => {
    await render()
    await flush()

    await typeName('在庫が切れました')
    await flush()
    fireEvent.click(quitLink())
    await flush()

    expect(document.body.textContent).toContain('保存していない変更があります')
    expect(fixture.push).not.toHaveBeenCalled()

    fireEvent.click(bodyButton('編集を続ける'))
    await flush()

    expect(document.body.textContent).not.toContain('保存していない変更があります')
    expect((host.querySelector('input#operator-name') as HTMLInputElement).value).toBe('在庫が切れました')
  })

  it('「保存せずに移る」を押すと一覧へ進む', async () => {
    await render()
    await flush()

    await typeName('在庫が切れました')
    await flush()
    fireEvent.click(quitLink())
    await flush()

    fireEvent.click(bodyButton('保存せずに移る'))
    await flush()

    expect(fixture.push).toHaveBeenCalledWith('/line-notifications?tab=operator')
  })
})
