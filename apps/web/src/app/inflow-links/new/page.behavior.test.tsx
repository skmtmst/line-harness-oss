// @vitest-environment happy-dom
/*
 * 流入リンクの新規作成画面を本物のReactで動かす試験（R39・R18）。
 *
 * R39: ヘッダーで選んだアカウントを、作成の送りへ付けて渡す。
 * 選んでいないときは送らず、理由を出す。
 * R18: 入力の途中でキャンセルへ出るときは、消える前に確認を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  create: vi.fn(),
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
      entryRoutes: { ...actual.api.entryRoutes, create: api.create },
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

/** アカウント選択を外から変えられるよう、module変数で持つ。 */
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

async function render() {
  await act(async () => { root.render(React.createElement(NewInflowLinkPage)) })
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

function byExactTextInBody(tag: string, text: string): HTMLElement {
  const found = Array.from(document.body.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

async function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'account-1'
  api.create.mockResolvedValue({ success: true, data: { id: 'route-1' } })
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
  vi.restoreAllMocks()
})

describe('流入リンクの新規作成(実React)', () => {
  it('R39: 選んだアカウントを付けて作り、詳細へ進む', async () => {
    await render()
    await setValue(byId('ir-name'), '夏の投稿')
    await setValue(byId('ir-ref'), 'r39-summer')
    await click(byExactText('button', '発行してURLを受け取る'))

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '夏の投稿',
      refCode: 'r39-summer',
      lineAccountId: 'account-1',
    }))
    expect(routerPush).toHaveBeenCalledWith('/inflow-links/detail?id=route-1')
  })

  it('R39: アカウント未選択では送らず理由を出す', async () => {
    fixture.accountId = null
    await render()
    await setValue(byId('ir-name'), '夏の投稿')
    await setValue(byId('ir-ref'), 'r39-summer')
    await click(byExactText('button', '発行してURLを受け取る'))

    expect(api.create).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
    // 理由は共通部品の帯（Notice）で出す。要素の種類ではなく文で見る。
    expect(host.textContent).toContain('LINEアカウントを選んでください（画面上部で選べます）')
  })

  it('R39: 所属するアカウントが画面で分かる', async () => {
    await render()
    expect(host.textContent).toContain('所属するLINEアカウント')
    expect(host.textContent).toContain('然-NEN- TEST')
  })

  it('R18: 入力の途中でキャンセルすると確認が出て、移動を選ぶと一覧へ戻る', async () => {
    await render()
    await setValue(byId('ir-name'), '消えたら困る入力')
    await click(byExactText('a', 'キャンセル'))

    byExactTextInBody('h2', '保存していない変更があります')
    await click(byExactTextInBody('button', '保存せずに移る'))
    expect(routerPush).toHaveBeenCalledWith('/inflow-links')
    expect(api.create).not.toHaveBeenCalled()
  })

  it('R18: 何も入力していなければ確認なしで一覧へ戻る', async () => {
    await render()
    await click(byExactText('a', 'キャンセル'))

    expect(document.body.textContent ?? '').not.toContain('保存していない変更があります')
  })

  /*
   * R610: 不正REFで発行を押した後、有効なREFへ直したら古い検証文は消え、
   * 未発行の見本は新しいREFのURLになる。保存は送らない。
   */
  it('R610: 有効なREFへ直すと古い入力エラーが消え、見本は新しいREFになる', async () => {
    await render()
    await setValue(byId('ir-name'), '夏の投稿')
    await setValue(byId('ir-ref'), 'bad ref!')
    await click(byExactText('button', '発行してURLを受け取る'))

    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('refコードは、半角英数字・_・ハイフンで1〜64文字にしてください')

    await setValue(byId('ir-ref'), 'audit-sample')

    expect(host.textContent).not.toContain('refコードは、半角英数字')
    expect(host.textContent).toContain('/r/audit-sample')
    expect(api.create).not.toHaveBeenCalled()
  })
})
