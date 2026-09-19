// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 友だち詳細の権限表示を本物のReactで確かめる（N-035 / N-037）。
 *
 *   N-037: PUT /api/friends/:id/fields はオーナー・管理者専用なのに、
 *          staff にも編集欄と「保存」ボタンが出て押すと403になった。
 *          staff には値を読ませるだけにし、保存の口を出さないことを固定する。
 *   N-045: 個人情報の項目は attribute.personal_info.edit を持つ staff が
 *          変更できる。個人情報でない項目の編集・項目の新規登録は従来どおり
 *          オーナー・管理者専用で、押すと403になる口を staff には出さない。
 *   N-035: 担当・対応状況を変える口が友だち側に無かった。
 *          '/chats' 編集キーを持つ人だけが「対応」の編集を開き、
 *          PUT /api/chats/:id へ友だちIDで届くことを固定する。
 *
 * 差し替えるのは api（サーバーとの境界）と next/navigation・next/link
 * だけ。権限は auth-guard が保存する localStorage の値で切り替える。
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
    value: '既存の値',
  },
  personalField: {
    id: 'field-personal',
    folderId: null,
    name: '電話番号',
    fieldKey: 'phone',
    type: 'text' as const,
    options: null,
    defaultValue: null,
    source: 'manual' as const,
    ecFieldPath: null,
    ecIsMaster: false,
    isPersonal: true,
    isStarred: false,
    displayOrder: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    value: '090-0000-0000',
  },
  friendDetail: {
    id: 'friend-1',
    displayName: 'テスト太郎',
    pictureUrl: null,
    isFollowing: true,
    tags: [],
    formSubmissions: [],
    support: { status: 'in_progress' as const, operatorName: '佐藤 けん', notes: '折り返し予定' },
  },
  chatDetail: {
    id: 'friend-1',
    friendId: 'friend-1',
    operatorId: 'op-1',
    status: 'in_progress' as const,
    notes: '折り返し予定',
    revision: 3,
    lastMessageAt: '2026-09-18T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    friendName: 'テスト太郎',
    friendRealName: null,
    friendPictureUrl: null,
    isAttention: false,
    messages: [],
    hasMoreMessages: false,
  },
  operators: [
    { id: 'op-1', name: '佐藤 けん' },
    { id: 'op-2', name: '田中 ゆい' },
  ],
}))

const net = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
}))

// forFriend が返す項目。試験ごとに差し替えられるよう hoisted に置く。
const state = vi.hoisted(() => ({
  fieldItems: [] as unknown[],
  hiddenCount: 0,
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

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: () => Promise.resolve({ success: true, data: fixtures.friendDetail }),
        mileage: () => Promise.reject(new Error('mileage unavailable')),
        richMenu: () => Promise.reject(new Error('rich menu unavailable')),
      },
      friendFields: {
        ...actual.api.friendFields,
        forFriend: () =>
          Promise.resolve({
            success: true,
            data: { items: state.fieldItems, hiddenPersonalCount: state.hiddenCount },
          }),
        saveForFriend: (...args: unknown[]) => {
          net.calls.push({ name: 'friendFields.saveForFriend', args })
          return Promise.resolve({ success: true, data: { updated: 1 }, warnings: [] })
        },
      },
      chats: {
        ...actual.api.chats,
        get: (...args: unknown[]) => {
          net.calls.push({ name: 'chats.get', args })
          return Promise.resolve({ success: true, data: fixtures.chatDetail })
        },
        update: (...args: unknown[]) => {
          net.calls.push({ name: 'chats.update', args })
          return Promise.resolve({ success: true, data: fixtures.chatDetail })
        },
      },
      operators: {
        ...actual.api.operators,
        list: (...args: unknown[]) => {
          net.calls.push({ name: 'operators.list', args })
          return Promise.resolve({ success: true, data: fixtures.operators })
        },
      },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: async () => ({
          success: true as const,
          data: { features: { friend_fields: true } },
        }),
      },
    },
  }
})

let host: HTMLDivElement
let root: Root
let FriendDetailPage: typeof import('./page').default
const storage = new Map<string, string>()

function setRole(role: string | null, permissions: string[] = [], viewPermissions: string[] = []) {
  if (role === null) storage.delete('lh_staff_role')
  else storage.set('lh_staff_role', role)
  storage.set('lh_staff_permissions', JSON.stringify(permissions))
  storage.set('lh_staff_view_permissions', JSON.stringify(viewPermissions))
}

beforeEach(async () => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  net.calls.length = 0
  state.fieldItems = [fixtures.textField]
  state.hiddenCount = 0
  routing.params = new URLSearchParams('id=friend-1&tab=info')
  // 権限の正本は auth-guard が保存する localStorage。試験では Map で同じ形を用意する。
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  setRole('admin')
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
  vi.unstubAllGlobals()
})

async function render(tab = 'info') {
  routing.params = new URLSearchParams(`id=friend-1&tab=${tab}`)
  await act(async () => {
    root.render(React.createElement(FriendDetailPage))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

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

function buttonsByText(text: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === text)
}

function linksByText(text: string): HTMLAnchorElement[] {
  return Array.from(host.querySelectorAll('a')).filter((a) => a.textContent === text)
}

async function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('N-037 staffの情報欄は読み取り専用（403と画面を一致）', () => {
  it('管理者には入力欄と「保存」「項目を追加」が出る', async () => {
    setRole('admin')
    await render('info')
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')
    expect(input).toBeTruthy()
    expect(input!.disabled).toBe(false)
    expect(buttonsByText('保存')).toHaveLength(1)
    expect(linksByText('項目を追加').length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('情報欄の値を保存できるのは')
  })

  it('staffは値を読めるが、編集欄・保存・項目追加は出ない', async () => {
    setRole('staff', ['/tags'])
    await render('info')
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')
    // 値は読める（読み取り専用として表示される）
    expect(input).toBeTruthy()
    expect(input!.disabled).toBe(true)
    expect(input!.value).toBe('既存の値')
    // 押すと403になる口は出さない
    expect(buttonsByText('保存')).toHaveLength(0)
    expect(linksByText('項目を追加')).toHaveLength(0)
    expect(host.textContent).toContain('情報欄の値を保存できるのはオーナー・管理者、または個人情報の編集権限を持つスタッフです。')
  })
})

describe('N-045 個人情報の項目は個別権限で編集する', () => {
  beforeEach(() => {
    state.fieldItems = [fixtures.textField, fixtures.personalField]
  })

  function inputs(): HTMLInputElement[] {
    return Array.from(host.querySelectorAll<HTMLInputElement>('input[type="text"]'))
  }

  it('edit キーを持つ staff は個人情報の項目だけ編集でき、保存口が出る', async () => {
    setRole('staff', ['/tags', 'attribute.personal_info.edit'])
    await render('info')
    const [text, personal] = inputs()
    // 個人情報でない項目はサーバーも受けないため、入力欄を閉じる
    expect(text.disabled).toBe(true)
    expect(text.value).toBe('既存の値')
    // 個人情報の項目は編集できる
    expect(personal.disabled).toBe(false)
    expect(personal.value).toBe('090-0000-0000')
    expect(buttonsByText('保存')).toHaveLength(1)
    // 項目の定義を足す口はオーナー・管理者専用のまま
    expect(linksByText('項目を追加')).toHaveLength(0)
    expect(host.textContent).toContain('個人情報')
  })

  it('edit キーを持つ staff が個人情報を変えて保存すると saveForFriend へ届く', async () => {
    setRole('staff', ['/tags', 'attribute.personal_info.edit'])
    await render('info')
    const [, personal] = inputs()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(personal, '080-1111-2222')
      personal.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      buttonsByText('保存')[0].click()
    })
    await eventually(() => {
      const call = net.calls.find((c) => c.name === 'friendFields.saveForFriend')
      expect(call).toBeTruthy()
      expect(call!.args[0]).toBe('friend-1')
      expect(call!.args[1]).toEqual({ 'field-personal': '080-1111-2222' })
    })
  })

  it('view キーだけの staff は個人情報を読めるが編集・保存の口は出ない', async () => {
    setRole('staff', ['/tags'], ['attribute.personal_info.view'])
    await render('info')
    const [text, personal] = inputs()
    expect(text.disabled).toBe(true)
    expect(personal.disabled).toBe(true)
    // 値は読める
    expect(personal.value).toBe('090-0000-0000')
    expect(buttonsByText('保存')).toHaveLength(0)
    expect(linksByText('項目を追加')).toHaveLength(0)
  })

  it('鍵の無い staff はサーバーが個人情報を返さない前提で、読み取り専用のまま', async () => {
    // サーバーは個人情報の項目を items に含めず hiddenPersonalCount で知らせる。
    state.fieldItems = [fixtures.textField]
    state.hiddenCount = 1
    setRole('staff', ['/tags'])
    await render('info')
    expect(inputs()).toHaveLength(1)
    expect(host.textContent).toContain('個人情報の項目が 1 件あります。')
    expect(host.textContent).toContain('表示には個人情報の閲覧権限が要ります。')
    expect(buttonsByText('保存')).toHaveLength(0)
  })
})

describe('N-035 友だち詳細から担当・対応状況を変える', () => {
  it('管理者は「対応」の編集を開いて担当・対応状況を保存できる', async () => {
    setRole('admin')
    await render('timeline')

    const editButtons = buttonsByText('編集')
    expect(editButtons).toHaveLength(1)
    await act(async () => {
      editButtons[0].click()
    })
    await eventually(() => {
      expect(host.querySelector('[data-support-editor]')).toBeTruthy()
      expect(net.calls.some((c) => c.name === 'chats.get' && c.args[0] === 'friend-1')).toBe(true)
      expect(net.calls.some((c) => c.name === 'operators.list')).toBe(true)
    })

    const statusSelect = host.querySelector<HTMLSelectElement>('select[aria-label="対応状況を変える"]')!
    const operatorSelect = host.querySelector<HTMLSelectElement>('select[aria-label="担当者を変える"]')!
    // いまの値（chatDetail）が入っている
    expect(statusSelect.value).toBe('in_progress')
    expect(operatorSelect.value).toBe('op-1')
    // 選択肢には未割り当てと担当者一覧がある
    expect(Array.from(operatorSelect.options).map((o) => o.textContent)).toEqual(['未割り当て', '佐藤 けん', '田中 ゆい'])

    await setSelectValue(statusSelect, 'resolved')
    await setSelectValue(operatorSelect, 'op-2')
    const save = buttonsByText('保存する')[0]
    await act(async () => {
      save.click()
    })
    await eventually(() => {
      const call = net.calls.find((c) => c.name === 'chats.update')
      expect(call).toBeTruthy()
      expect(call!.args[0]).toBe('friend-1')
      expect(call!.args[1]).toEqual({ status: 'resolved', operatorId: 'op-2', revision: 3 })
    })
    await eventually(() => expect(host.textContent).toContain('担当・対応状況を更新しました'))
  })

  it('「未割り当て」を選ぶと operatorId=null で送る', async () => {
    setRole('admin')
    await render('timeline')
    await act(async () => {
      buttonsByText('編集')[0].click()
    })
    await eventually(() => expect(host.querySelector('[data-support-editor]')).toBeTruthy())
    await setSelectValue(host.querySelector<HTMLSelectElement>('select[aria-label="担当者を変える"]')!, '')
    await act(async () => {
      buttonsByText('保存する')[0].click()
    })
    await eventually(() => {
      const call = net.calls.find((c) => c.name === 'chats.update')
      expect(call!.args[1]).toEqual({ status: 'in_progress', operatorId: null, revision: 3 })
    })
  })

  it('chats編集キーを持つstaffにも同じ口が出る', async () => {
    setRole('staff', ['/chats'])
    await render('timeline')
    expect(buttonsByText('編集')).toHaveLength(1)
  })

  it('chats編集キーの無いstaffには編集口を出さない（受信箱への案内だけ）', async () => {
    setRole('staff', ['/friends'])
    await render('timeline')
    // 「編集」はボタンではなく受信箱へのリンクのまま
    expect(buttonsByText('編集')).toHaveLength(0)
    expect(linksByText('編集').length).toBeGreaterThan(0)
    expect(host.querySelector('[data-support-editor]')).toBeNull()
  })
})
