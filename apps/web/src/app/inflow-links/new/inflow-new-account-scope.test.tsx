// @vitest-environment happy-dom
/*
 * R23横展開: 流入リンク作成の候補は、いま選んでいるアカウントのものだけ。
 * 本物のReactで動かして見る。
 * - タグ・シナリオ・テンプレート・タグフォルダの取得に選択accountが付く
 * - アカウントを切り替えたら、前の候補にしかない選択を外して知らせる
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  tagsList: vi.fn(),
  scenariosList: vi.fn(),
  poolsList: vi.fn(),
  templatesList: vi.fn(),
  tagGroupsList: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { ...actual.api.tags, list: api.tagsList },
      scenarios: { ...actual.api.scenarios, list: api.scenariosList },
      pools: { ...actual.api.pools, list: api.poolsList },
      templates: { ...actual.api.templates, list: api.templatesList },
      tagGroups: { ...actual.api.tagGroups, list: api.tagGroupsList },
    },
  }
})

vi.mock('@/lib/pools-availability', () => ({
  isPoolsFeatureAvailable: () => Promise.resolve(false),
}))

vi.mock('@/lib/qr-image', () => ({
  qrToDataURL: () => Promise.resolve(''),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

/** アカウント選択を外から変えられるよう、module変数で持つ。 */
const fixture = vi.hoisted(() => ({ accountId: 'account-1' as string | null }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId ? { id: fixture.accountId, name: '検証店' } : null,
    loading: false,
  }),
}))

import NewInflowLinkPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const TAGS: Record<string, Array<{ id: string; name: string }>> = {
  'account-1': [{ id: 'tag-a1', name: '会員' }],
  'account-2': [{ id: 'tag-b2', name: '予約' }],
}
const SCENARIOS: Record<string, Array<{ id: string; name: string }>> = {
  'account-1': [{ id: 'sc-a1', name: '案内A' }],
  'account-2': [{ id: 'sc-b2', name: '案内B' }],
}
const TEMPLATES: Record<string, Array<{ id: string; name: string }>> = {
  'account-1': [{ id: 'tpl-a1', name: '挨拶A' }],
  'account-2': [{ id: 'tpl-b2', name: '挨拶B' }],
}

function stubCandidates() {
  api.tagsList.mockImplementation(async (params?: { accountId?: string }) => ({
    success: true as const,
    data: (params?.accountId ? (TAGS[params.accountId] ?? []) : []),
  }))
  api.scenariosList.mockImplementation(async (params?: { accountId?: string }) => ({
    success: true as const,
    data: (params?.accountId ? (SCENARIOS[params.accountId] ?? []) : []),
  }))
  api.templatesList.mockImplementation(async (_category?: string, accountId?: string) => ({
    success: true as const,
    data: (accountId ? (TEMPLATES[accountId] ?? []) : []),
  }))
  api.poolsList.mockResolvedValue({ success: true as const, data: [] })
  api.tagGroupsList.mockResolvedValue({ success: true as const, data: [] })
}

async function settle(milliseconds = 50) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

/** 共通部品 Select はボタンの見た目で、候補は body 直下の [role="option"] に出る。 */
function triggerById(id: string): HTMLElement {
  const el = host.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLElement
}

/** 変える・決めるの開閉印を押して、候補の Select を出す。 */
async function openPicker(ariaLabel: string) {
  const button = host.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!button) throw new Error(`見つかりません: ${ariaLabel}`)
  await act(async () => {
    fireEvent.click(button)
  })
  await settle(50)
}

async function chooseOption(triggerId: string, label: string) {
  await act(async () => {
    fireEvent.click(triggerById(triggerId))
  })
  await settle(50)
  // 候補の一覧は MenuPortal で document.body 直下に出る（host の中にはない）。
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
    el.textContent?.includes(label),
  )
  if (!option) throw new Error(`候補が見つかりません: ${label}`)
  // 押すのは中のボタン（共通部品 Select の onChange はボタンの onClick）。
  const target = option.querySelector('button') ?? option
  await act(async () => {
    fireEvent.click(target!)
  })
  await settle(50)
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'account-1'
  stubCandidates()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('R23横展開 流入リンク作成の候補は選択accountで絞る', () => {
  it('候補の取得に選択accountが付く', async () => {
    await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
    await settle()
    expect(api.tagsList).toHaveBeenCalledWith({ accountId: 'account-1' })
    expect(api.scenariosList).toHaveBeenCalledWith({ accountId: 'account-1' })
    expect(api.templatesList).toHaveBeenCalledWith(undefined, 'account-1')
    expect(api.tagGroupsList).toHaveBeenCalledWith('account-1')
  })

  it('切り替えたら前の候補にしかない選択を外して知らせる', async () => {
    await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
    await settle(100)
    // account-1 の候補を選ぶ（決める印で候補を開いてから選ぶ）
    await openPicker('付けるタグを決める')
    await chooseOption('ir-tag', '会員')
    await openPicker('始めるシナリオを決める')
    await chooseOption('ir-scenario', '案内A')
    await openPicker('送るメッセージを決める')
    await chooseOption('ir-intro', '挨拶A')
    expect(host.textContent).toContain('会員')
    // account-2 へ切り替えると候補が変わり、前の選択は外れる
    fixture.accountId = 'account-2'
    await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
    await settle(150)
    expect(host.textContent).toContain('まだ決めていません')
    expect(host.textContent).toContain('今のアカウントにないため外しました')
  })

  it('外すものがなければ知らせは出ない', async () => {
    await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
    await settle()
    expect(host.textContent).not.toContain('今のアカウントにないため外しました')
  })
})
