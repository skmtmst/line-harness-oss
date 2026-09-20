// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NewWebinarPage from './page'

/**
 * Issue #1002 DETAIL-03 の回帰試験。
 *
 * 作ってから動画設定へ進むとき、編集画面は `pane=video` 付きで開く。
 * 付けないと編集画面は先頭の基本設定で開き、「動画設定へ」を押したのに
 * 動画の段に着かない。
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
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/lib/api', () => ({
  webinarApi: {
    folders: async () => ({ success: true, data: [] }),
    create: fixture.create,
  },
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.create.mockReset()
  fixture.create.mockResolvedValue({ success: true, data: { id: 'new-webinar' } })
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

function buttonByText(label: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
  if (!button) throw new Error(`button not found: ${label}`)
  return button
}

describe('ウェビナー作成からの段遷移 (#1002 DETAIL-03)', () => {
  it('「動画設定へ」は作成の成功後に pane=video 付きの編集画面へ進む', async () => {
    await render()
    await flush()

    await act(async () => {
      fireEvent.change(host.querySelector('#webinar-title')!, { target: { value: '回帰ウェビナー' } })
    })
    await act(async () => { buttonByText('動画設定へ').click() })
    await flush()

    expect(fixture.create).toHaveBeenCalledTimes(1)
    expect(fixture.push).toHaveBeenCalledWith('/webinars/edit?id=new-webinar&pane=video')
  })

  it('作成に失敗したら遷移せず、入力した名前を残す', async () => {
    fixture.create.mockRejectedValue(new Error('作成に失敗しました'))
    await render()
    await flush()

    const titleInput = host.querySelector('#webinar-title')! as HTMLInputElement
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: '残したい名前' } })
    })
    await act(async () => { buttonByText('動画設定へ').click() })
    await flush()

    expect(fixture.push).not.toHaveBeenCalled()
    expect(titleInput.value).toBe('残したい名前')
  })

  it('段の並びは編集画面と同じ5段を共有する', async () => {
    await render()
    await flush()

    for (const label of ['基本設定', '動画', 'CTA・フォーム', '通知', '確認']) {
      expect(host.textContent).toContain(label)
    }
  })
})
