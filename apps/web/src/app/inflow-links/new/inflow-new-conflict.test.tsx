// @vitest-environment happy-dom
/*
 * vWJEm（作る・競合）: 発行が 409 で返り、同じ文字の発行済みリンクが
 * あるときは、帯で知らせて比べ・取り込みができる。本物のReactで動かす。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  routesList: vi.fn(),
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
      entryRoutes: { ...actual.api.entryRoutes, create: api.create, list: api.routesList },
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

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

const fixture = vi.hoisted(() => ({ accountId: 'account-1' as string | null }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId ? { id: fixture.accountId, name: '然-NEN- TEST' } : null,
    loading: false,
  }),
}))

import NewInflowLinkPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

/** 保存済みの相手（実データの形）。誰が保存したかは口が持たない。 */
const EXISTING = {
  id: 'route-9',
  refCode: 'summer-ig',
  genre: 'SNS',
  name: '夏のInstagram投稿',
  tagId: null,
  scenarioId: null,
  redirectUrl: 'https://nen.example/summer',
  poolId: null,
  introTemplateId: null,
  runAccountFriendAddScenarios: false,
  isActive: true,
  stoppedAt: null,
  stoppedReason: null,
  lineAccountId: 'account-1',
  createdAt: '2026-10-03T10:00:00+09:00',
  updatedAt: '2026-10-04T14:02:00+09:00',
}

async function settle(milliseconds = 100) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

async function render() {
  await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
  await settle()
}

function byId(id: string): HTMLInputElement {
  const el = host.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement
}

function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

async function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle(20)
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'account-1'
  api.create.mockRejectedValue(new ApiError(409, 'この ref_code は既に使われています'))
  api.routesList.mockResolvedValue({ success: true, data: [EXISTING] })
  api.tagsList.mockResolvedValue({ success: true, data: [] })
  api.scenariosList.mockResolvedValue({ success: true, data: [] })
  api.poolsList.mockResolvedValue({ success: true, data: [] })
  api.templatesList.mockResolvedValue({ success: true, data: [] })
  api.tagGroupsList.mockResolvedValue({ success: true, data: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('流入リンクの作成・競合(実React)', () => {
  it('vWJEm: 文字が重なると帯が出て、フッターは比べの案内になる', async () => {
    await render()
    await setValue(byId('ir-name'), '別の名前')
    await setValue(byId('ir-ref'), 'summer-ig')
    await click(byExactText('button', '発行してURLを受け取る'))

    expect(api.create).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
    expect(host.textContent).toContain('「summer-ig」は既に使われています')
    // 保存日時と名前は実データ。誰が保存したかは口が持たないので出さない。
    expect(host.textContent).toContain('保存の「夏のInstagram投稿」があります')
    expect(host.textContent).not.toContain('坂本さん')
    byExactText('button', '比べてから保存')
  })

  it('vWJEm: 違いを比べると今の入力と保存値が並ぶ', async () => {
    await render()
    await setValue(byId('ir-name'), '別の名前')
    await setValue(byId('ir-ref'), 'summer-ig')
    await click(byExactText('button', '発行してURLを受け取る'))
    await click(byExactText('button', '違いを比べる'))

    expect(host.textContent).toContain('いまの入力と保存されている値の違い')
    expect(host.textContent).toContain('別の名前')
    expect(host.textContent).toContain('夏のInstagram投稿')
    expect(host.textContent).toContain('https://nen.example/summer')
  })

  it('vWJEm: 最新を読み込むと保存値が入力へ写る', async () => {
    await render()
    await setValue(byId('ir-name'), '別の名前')
    await setValue(byId('ir-ref'), 'summer-ig')
    await click(byExactText('button', '発行してURLを受け取る'))
    await click(byExactText('button', '最新を読み込んで続ける'))

    expect(byId('ir-name').value).toBe('夏のInstagram投稿')
    // 文字は競合のままなので、帯は残って文字の変更を促す。
    expect(host.textContent).toContain('「summer-ig」は既に使われています')
  })

  it('vWJEm: 文字を変えると競合が閉じて発行に戻る', async () => {
    await render()
    await setValue(byId('ir-name'), '別の名前')
    await setValue(byId('ir-ref'), 'summer-ig')
    await click(byExactText('button', '発行してURLを受け取る'))
    expect(host.textContent).toContain('「summer-ig」は既に使われています')

    await setValue(byId('ir-ref'), 'summer-ig-2')
    expect(host.textContent).not.toContain('既に使われています')
    byExactText('button', '発行してURLを受け取る')
  })
})
