// @vitest-environment happy-dom
/**
 * V8 タグと友だち情報の欄の通し試験（見た目のみ）。
 * 流れ：作る→友だちに付ける→外す／欄を作る→値を書く。
 * 各段で「押せる・保存後の知らせ・一覧の変化」を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const searchQuery = vi.hoisted(() => ({ value: '' }))
const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  usePathname: () => '/tags',
  useSearchParams: () => new URLSearchParams(searchQuery.value),
}))

const accountState = vi.hoisted(() => ({
  selectedAccountId: 'account-a',
  selectedAccount: { id: 'account-a', name: '本店' },
  accounts: [{ id: 'account-a', name: '本店' }],
  loading: false,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => accountState,
}))

vi.mock('@/lib/staff-capability', () => ({
  isOwnerOrAdmin: () => true,
  canManageRole: () => true,
  canEditFeature: () => true,
}))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の流れなので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

const store = vi.hoisted(() => ({
  tags: [] as Array<Record<string, unknown>>,
  fields: [] as Array<Record<string, unknown>>,
  friendTags: [] as string[],
  metadata: {} as Record<string, string>,
}))

const listTags = vi.hoisted(() => vi.fn())
const createTag = vi.hoisted(() => vi.fn())
const listGroups = vi.hoisted(() => vi.fn())
const listFields = vi.hoisted(() => vi.fn())
const createField = vi.hoisted(() => vi.fn())
const addTag = vi.hoisted(() => vi.fn())
const removeTag = vi.hoisted(() => vi.fn())
const updateMetadata = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  describeSaveFailure: () => '保存できませんでした。もう一度お試しください。',
  api: {
    tags: {
      list: listTags,
      createDefinition: createTag,
      definition: vi.fn(async () => ({ success: false })),
    },
    tagGroups: { list: listGroups },
    friendFields: {
      list: listFields,
      create: createField,
      stats: vi.fn(async () => ({ success: true, data: {} })),
    },
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    featureSettings: { visibility: vi.fn(async () => ({ success: true, data: {} })) },
    listStats: { get: vi.fn(async () => ({ success: true, data: { tags: { taggedFriends: 1, assignedThisMonth: 2 } } })) },
    staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
    friends: {
      addTag,
      removeTag,
      updateMetadata,
      list: vi.fn(async () => ({ success: true, data: { items: [], total: 0 } })),
    },
  },
}))

import TagsPage from './page'
import NewTagPage from './new/page'
import NewFieldPage from './fields/new/page'
import SingleFriendActions from '@/components/friends/single-friend-actions'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function renderNode(node: React.ReactNode) {
  act(() => {
    root.render(<>{node}<ToastHost /></>)
  })
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

const tagRow = (id: string, name: string) => ({
  id,
  name,
  groupId: null,
  isStarred: false,
  usageCount: 0,
})

beforeEach(() => {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (!g.crypto) g.crypto = {}
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => 'test-uuid-1'
  document.documentElement.dataset.theme = 'v8'
  store.tags = [tagRow('t-1', '流れのタグ')]
  store.fields = []
  store.friendTags = []
  store.metadata = {}
  listTags.mockImplementation(async () => ({ success: true, data: store.tags }))
  createTag.mockImplementation(async (_account: string, body: { name: string }) => ({
    success: true,
    data: { tag: { id: 't-new', name: body.name } },
  }))
  listGroups.mockImplementation(async () => ({ success: true, data: [] }))
  listFields.mockImplementation(async () => ({ success: true, data: store.fields }))
  createField.mockImplementation(async (_account: string, body: { name: string }) => ({
    success: true,
    data: { id: 'f-new', name: body.name },
  }))
  addTag.mockImplementation(async (_friend: string, tagId: string) => {
    store.friendTags = [...store.friendTags, tagId]
    return { success: true, data: null }
  })
  removeTag.mockImplementation(async (_friend: string, tagId: string) => {
    store.friendTags = store.friendTags.filter((id) => id !== tagId)
    return { success: true, data: null }
  })
  updateMetadata.mockImplementation(async (_friend: string, patch: Record<string, string>) => {
    store.metadata = { ...store.metadata, ...patch }
    return { success: true, data: null }
  })
  searchQuery.value = ''
  pushMock.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('V8 タグの通し：作る→付ける→外す', () => {
  it('一覧の作る口は作成へ進む', async () => {
    renderNode(<TagsPage />)
    await flush()
    await screen.findByText('流れのタグ')
    const creates = screen.getAllByRole('link', { name: /タグを作る/ })
    expect(creates.length).toBeGreaterThan(0)
    expect(creates[0].getAttribute('href')).toBe('/tags/new')
  })

  it('名前を入れて作る→知らせ→一覧に戻ると増えている', async () => {
    renderNode(<NewTagPage />)
    await flush()

    const nameInput = host.querySelector('input[placeholder="例: 定期購入者"]') as HTMLInputElement
    expect(nameInput, 'タグ名の入力が見つかりません').toBeTruthy()
    await act(async () => { setInputValue(nameInput, '流れの型2') })
    fireEvent.click(screen.getByRole('button', { name: 'タグを作る' }))
    await waitFor(() => expect(createTag).toHaveBeenCalledTimes(1))
    await screen.findByText('「流れの型2」を作りました')
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/tags?highlight=t-new')))

    store.tags = [...store.tags, tagRow('t-new', '流れの型2')]
    renderNode(<TagsPage />)
    await flush()
    await screen.findByText('流れの型2')
  })

  it('友だちに付ける→知らせ→外す→知らせ', async () => {
    const tags = [tagRow('t-1', '流れのタグ')].map((t) => ({ ...t, accountId: 'account-a' }))
    const onDone = vi.fn()
    renderNode(
      <SingleFriendActions
        friendId="f-1"
        friendName="試す友だち"
        tags={tags as never}
        accountId="account-a"
        onDone={onDone}
      />,
    )
    await flush()

    fireEvent.click(screen.getByRole('button', { name: 'タグを付ける・外す' }))
    const tagSelect = await screen.findByLabelText('タグ')
    fireEvent.change(tagSelect, { target: { value: 't-1' } })

    // 付ける（成功の知らせは行内に出て、窓は閉じる）。
    fireEvent.click(screen.getByRole('button', { name: '付ける' }))
    await waitFor(() => expect(addTag).toHaveBeenCalledWith('f-1', 't-1'))
    await screen.findByText('タグを付けました')
    expect(onDone).toHaveBeenCalled()

    // 外す（窓を開き直す）。
    fireEvent.click(screen.getByRole('button', { name: 'タグを付ける・外す' }))
    fireEvent.change(await screen.findByLabelText('タグ'), { target: { value: 't-1' } })
    fireEvent.click(screen.getByRole('button', { name: '外す' }))
    await waitFor(() => expect(removeTag).toHaveBeenCalledWith('f-1', 't-1'))
    await screen.findByText('タグを外しました')
  })
})

describe('V8 友だち情報の欄の通し：作る→値を書く', () => {
  it('名前とキーを入れて作る→知らせ→一覧に戻ると増えている', async () => {
    renderNode(<NewFieldPage />)
    await flush()

    const nameInput = host.querySelector('input[placeholder="例：愛犬のお名前"]') as HTMLInputElement
    expect(nameInput, '項目名の入力が見つかりません').toBeTruthy()
    await act(async () => { setInputValue(nameInput, '流れの項目') })
    const keyInput = host.querySelector('input[placeholder="pet_name"]') as HTMLInputElement
    expect(keyInput, 'キーの入力が見つかりません').toBeTruthy()
    await act(async () => { setInputValue(keyInput, 'nagare_item') })
    fireEvent.click(screen.getByRole('button', { name: '項目を作る' }))
    await waitFor(() => expect(createField).toHaveBeenCalledTimes(1))
    await screen.findByText('「流れの項目」を作りました')
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/tags?tab=fields&highlight=f-new')))
  })

  it('友だちの欄に値を書く→知らせ', async () => {
    const onDone = vi.fn()
    renderNode(
      <SingleFriendActions
        friendId="f-1"
        friendName="試す友だち"
        tags={[]}
        accountId="account-a"
        onDone={onDone}
      />,
    )
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '友だち情報を書き換える' }))
    fireEvent.change(await screen.findByLabelText('項目名'), { target: { value: '流れの項目' } })
    fireEvent.change(await screen.findByLabelText('値'), { target: { value: '柴' } })
    fireEvent.click(screen.getByRole('button', { name: '書き換える' }))
    await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith('f-1', { '流れの項目': '柴' }))
    await screen.findByText('友だち情報を書き換えました')
    expect(onDone).toHaveBeenCalled()
  })
})
