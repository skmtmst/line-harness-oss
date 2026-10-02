// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NoticeDialog from './notice-dialog'
import SavedSearchDialog from './saved-search-dialog'

/*
 * N-039: 「保存した検索」「通知」の2窓に、Escで閉じる動作と
 * フォーカス復元が無かった。共通overlay規約（useOverlayFocus）へ
 * 乗せたことを、実際にコンポーネントをmountして確かめる。
 *   ・開くと窓の中の最初の押し口へフォーカスが入る
 *   ・Tabは窓の中で回り、裏の画面へ抜けない
 *   ・Escで閉じて、開く前に押していたボタンへフォーカスが戻る
 *   ・開いている間は背景のスクロールが止まる
 */

const net = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friendSavedViews: {
        ...actual.api.friendSavedViews,
        list: (...args: unknown[]) => {
          net.calls.push({ name: 'friendSavedViews.list', args })
          return Promise.resolve({
            success: true as const,
            data: {
              items: [
                {
                  id: 'view-1',
                  name: '未対応だけ',
                  conditions: {},
                  revision: 1,
                  isShared: false,
                  ownerId: 'staff-1',
                  lineAccountId: 'account-a',
                  displayOrder: 0,
                  match: {
                    total: 3,
                    byChannel: { line: null, mail: null },
                    calculatedAt: '2026-09-19T00:00:00.000Z',
                    error: null,
                  },
                  createdAt: '2026-09-01T00:00:00.000Z',
                  updatedAt: '2026-09-01T00:00:00.000Z',
                },
              ],
              total: 1,
            },
          })
        },
      },
    },
  }
})

function Harness({ kind }: { kind: 'notice' | 'saved' }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" data-trigger onClick={() => setOpen(true)}>
        窓を開く
      </button>
      {open && kind === 'notice' ? (
        <NoticeDialog
          notice={{ title: '失敗しました。通信を確かめて、もう一度お試しください。', message: 'もう一度お試しください。' }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {open && kind === 'saved' ? (
        <SavedSearchDialog
          accountId="account-a"
          tags={[]}
          onClose={() => setOpen(false)}
          onApply={() => setOpen(false)}
          onOpenAdvanced={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  net.calls.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  document.body.style.overflow = ''
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

function trigger(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!button) throw new Error('開くボタンがありません')
  return button
}

const keydown = (key: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))

async function openDialog(kind: 'notice' | 'saved'): Promise<HTMLElement> {
  await act(async () => {
    root.render(<Harness kind={kind} />)
  })
  const button = trigger()
  await act(async () => {
    button.focus()
    button.click()
  })
  await eventually(() => expect(host.querySelector('[role="dialog"]')).toBeTruthy())
  return host.querySelector<HTMLElement>('[role="dialog"]')!
}

describe.each(['notice', 'saved'] as const)('N-039 %s 窓のoverlay規約', (kind) => {
  it('開くと窓の中へフォーカスが入り、背景スクロールが止まる', async () => {
    const panel = await openDialog(kind)
    await eventually(() => {
      expect(panel.contains(document.activeElement)).toBe(true)
    })
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Tabは窓の中で回り、裏の画面へ抜けない', async () => {
    const panel = await openDialog(kind)
    await eventually(() => expect(panel.contains(document.activeElement)).toBe(true))
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]',
      ),
    )
    expect(focusable.length).toBeGreaterThan(0)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    // 末尾で Tab → 先頭へ戻る。裏の「窓を開く」へは抜けない。
    await act(async () => {
      last.focus()
      keydown('Tab')
    })
    expect(document.activeElement).toBe(first)
    // 先頭で Shift+Tab → 末尾へ回る。
    await act(async () => {
      first.focus()
      keydown('Tab', true)
    })
    expect(document.activeElement).toBe(last)
  })

  it('Escで閉じて、開く前のボタンへフォーカスが戻る', async () => {
    await openDialog(kind)
    const button = trigger()
    await eventually(() => expect(document.activeElement).not.toBe(button))
    await act(async () => {
      keydown('Escape')
    })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(document.body.style.overflow).toBe('')
  })
})

describe('保存した検索の窓', () => {
  it('保存条件の一覧を読み込み、読み込み中も窓の中にフォーカスが留まる', async () => {
    const panel = await openDialog('saved')
    await eventually(() => {
      expect(net.calls.some((call) => call.name === 'friendSavedViews.list')).toBe(true)
      expect(panel.textContent).toContain('未対応だけ')
    })
    /*
      開いた瞬間の最初の押し口（閉じる）へフォーカスが入り、
      一覧の到着で外へは逃げない。
    */
    expect(panel.contains(document.activeElement)).toBe(true)
  })
})
