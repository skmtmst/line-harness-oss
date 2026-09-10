// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

/**
 * 友だち詳細（情報欄タブ）の単票保存を本物のReactで動かす試験(N-042 #656)。
 *
 * PUT /api/friends/:id/fields はサーバー側で型検証済みだが、その拒否
 * （422）を画面が黙って「成功」扱いにしないことは、実際にコンポーネントを
 * mountして保存ボタンを押さないと確かめられない。差し替えるのは
 * api.friendFields / api.friends（サーバーとの境界）と
 * next/navigation・next/link だけで、画面の中身（save() の分岐・表示）は
 * 本物のまま動かす。fetchApi自体が422をApiErrorへ変換する契約は
 * api.test.ts 側で別に固定済みのため、ここでは境界の一段上（save()の
 * 呼び出し口）で同じ形の拒否を再現する。
 */

const fixtures = vi.hoisted(() => ({
  textField: {
    id: 'field-text',
    folderId: null,
    name: 'メモ',
    fieldKey: 'memo',
    type: 'text' as const,
    options: null,
    defaultValue: null,
    source: 'manual' as const,
    ecFieldPath: null,
    ecIsMaster: false,
    isPersonal: false,
    isStarred: false,
    displayOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    value: '',
  },
  friendDetail: {
    id: 'friend-1',
    displayName: 'テスト太郎',
    pictureUrl: null,
    isFollowing: true,
    tags: [],
    formSubmissions: [],
    support: null,
  },
}))

const net = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
}))

const routing = vi.hoisted(() => ({
  params: new URLSearchParams('id=friend-1&tab=info'),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => routing.params,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: (...args: unknown[]) => {
          net.calls.push({ name: 'friends.get', args })
          return Promise.resolve({ success: true, data: fixtures.friendDetail })
        },
        mileage: (...args: unknown[]) => {
          net.calls.push({ name: 'friends.mileage', args })
          return Promise.reject(new Error('mileage unavailable'))
        },
        richMenu: (...args: unknown[]) => {
          net.calls.push({ name: 'friends.richMenu', args })
          return Promise.reject(new Error('rich menu unavailable'))
        },
      },
      friendFields: {
        ...actual.api.friendFields,
        forFriend: (...args: unknown[]) => {
          net.calls.push({ name: 'friendFields.forFriend', args })
          return Promise.resolve({
            success: true,
            data: { items: [fixtures.textField], hiddenPersonalCount: 0 },
          })
        },
        saveForFriend: (friendId: string, values: Record<string, string | null>) => {
          net.calls.push({ name: 'friendFields.saveForFriend', args: [friendId, values] })
          const value = values['field-text']
          // 実サーバーのvalidateFriendFieldValueと同じ規則(text型は200文字まで)。
          if (typeof value === 'string' && value.length > 200) {
            return Promise.reject(
              new ApiError(422, '項目の値を確認してください', 'FIELD_VALUE_INVALID', {
                errors: [{ fieldId: 'field-text', name: 'メモ', message: '200文字以内で入力してください' }],
              }),
            )
          }
          return Promise.resolve({ success: true, data: { updated: 1 }, warnings: [] })
        },
      },
    },
  }
})

let host: HTMLDivElement
let root: Root
let FriendDetailPage: typeof import('./page').default

beforeEach(async () => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  net.calls.length = 0
  routing.params = new URLSearchParams('id=friend-1&tab=info')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  FriendDetailPage = (await import('./page')).default
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(React.createElement(FriendDetailPage))
  })
}

function fieldInput(): HTMLInputElement {
  const input = host.querySelector('input[type="text"]')
  if (!input) throw new Error('メモの入力欄が見つかりません')
  return input as HTMLInputElement
}

function setInputValue(input: HTMLInputElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set
  setValue?.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function clickSave() {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '保存')
  if (!button) throw new Error('保存ボタンが見つかりません')
  await act(async () => {
    button.click()
  })
}

describe('友だち情報欄の単票保存を実Reactで固定する（N-042 #656）', () => {
  it('型に合わない値（201文字）は保存できず、成功通知も出ない', async () => {
    await render()
    expect(host.textContent).toContain('テスト太郎')

    await act(async () => {
      setInputValue(fieldInput(), 'x'.repeat(201))
    })
    await clickSave()

    const saveCalls = net.calls.filter((c) => c.name === 'friendFields.saveForFriend')
    expect(saveCalls).toHaveLength(1)
    // 保存に失敗した扱いになり、成功メッセージは出ない。
    expect(host.textContent).toContain('保存に失敗しました')
    expect(host.textContent).not.toContain('件を保存しました')
    // 保存が失敗した経路では再読み込みしない（forFriendは初回の1回だけ）。
    expect(net.calls.filter((c) => c.name === 'friendFields.forFriend')).toHaveLength(1)
  })

  it('型どおりの値は保存でき、成功通知が出る', async () => {
    await render()

    await act(async () => {
      setInputValue(fieldInput(), 'ポチ')
    })
    await clickSave()

    const saveCalls = net.calls.filter((c) => c.name === 'friendFields.saveForFriend')
    expect(saveCalls).toHaveLength(1)
    expect(host.textContent).toContain('1 件を保存しました')
    expect(host.textContent).not.toContain('保存に失敗しました')
  })
})
