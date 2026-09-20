// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SavedSearchDialog from './saved-search-dialog'
import type { FriendSavedView } from '@/lib/api'

/*
 * FRIEND-18/19: 保存した検索の窓で、取得失敗が「保存なし」と同時に出る、
 * アカウント切替で前の候補が残る、という2件の再現を防ぐ。
 *   ・失敗時は空状態を出さず、再読み込みできる
 *   ・A→Bへ切り替えるとAの候補は消え、Bの結果だけが残る
 */

const net = vi.hoisted(() => ({
  calls: [] as { accountId: string }[],
  next: [] as Array<
    | { ok: true; items: FriendSavedView[] }
    | { ok: false }
  >,
}))

function view(id: string, name: string): FriendSavedView {
  return {
    id,
    name,
    conditions: { all: [{ kind: 'name', op: 'contains', value: 'Alpha' }], any: [], visibility: 'visible_only' },
    revision: 1,
    isShared: false,
    ownerId: 'staff-1',
    lineAccountId: 'account-a',
    displayOrder: 0,
    match: { total: 3, byChannel: { line: null, mail: null }, calculatedAt: '2026-09-19T00:00:00.000Z', error: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friendSavedViews: {
        ...actual.api.friendSavedViews,
        list: (accountId: string) => {
          net.calls.push({ accountId })
          const next = net.next.shift() ?? { ok: true as const, items: [] }
          return next.ok
            ? Promise.resolve({ success: true as const, data: { items: next.items, total: next.items.length } })
            : Promise.resolve({ success: false as const, error: 'サーバーエラー' })
        },
      },
    },
  }
})

vi.mock('@/components/shared/overlay-utils', () => ({
  useOverlayFocus: () => null,
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  net.calls.length = 0
  net.next.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
})

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
}

function renderDialog(accountId: string) {
  return act(async () => {
    root.render(
      <SavedSearchDialog
        accountId={accountId}
        tags={[]}
        onClose={() => {}}
        onApply={() => {}}
        onOpenAdvanced={() => {}}
      />,
    )
  })
}

describe('保存した検索の読み込み状態（FRIEND-18/19）', () => {
  it('取得失敗は空状態と同時に出さず、再読み込みで成功へ戻る', async () => {
    net.next.push({ ok: false }, { ok: true, items: [view('v1', 'VIPだけ')] })
    await renderDialog('account-a')
    await eventually(() => {
      expect(host.textContent).toContain('サーバーエラー')
    })
    expect(host.textContent).not.toContain('保存した条件はまだありません')

    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '再読み込み')
    expect(retry).toBeTruthy()
    await act(async () => {
      retry!.click()
    })
    await eventually(() => {
      expect(host.textContent).toContain('VIPだけ')
    })
    expect(net.calls.length).toBe(2)
  })

  it('取得成功で0件の時だけ登録案内を表示する', async () => {
    net.next.push({ ok: true, items: [] })
    await renderDialog('account-a')
    await eventually(() => {
      expect(host.textContent).toContain('保存した条件はまだありません')
    })
  })

  it('アカウント切替で前の候補を破棄し、Bの失敗時にAの候補を出さない', async () => {
    net.next.push({ ok: true, items: [view('v-a', 'アカウントAの検索')] })
    await renderDialog('account-a')
    await eventually(() => {
      expect(host.textContent).toContain('アカウントAの検索')
    })

    net.next.push({ ok: false })
    await act(async () => {
      root.render(
        <SavedSearchDialog
          accountId="account-b"
          tags={[]}
          onClose={() => {}}
          onApply={() => {}}
          onOpenAdvanced={() => {}}
        />,
      )
    })
    await eventually(() => {
      expect(host.textContent).toContain('サーバーエラー')
    })
    expect(host.textContent).not.toContain('アカウントAの検索')
    expect(net.calls.at(-1)?.accountId).toBe('account-b')
  })
})
