// @vitest-environment happy-dom
/*
 * M030: 発行の失敗は原文表示のままだった（createPageErrorMessage。
 * 403・409・400の3状態で実証。M022系）。保存の失敗は原因どおりに
 * 言い分ける。本物のReactで動かして見る。
 * - 403 → 権限の案内（`API error: 403` のような内部文は出さない）。
 * - 400 → 入力の直し方＋サーバーの案内。
 * - 409 → サーバーの案内（重複の立て直し文）をそのまま。
 * - 機械コードだけの失敗 → 再試行の案内（原文のまま出さない）。
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

const fixture = vi.hoisted(() => ({ accountId: 'account-1' as string | null }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId ? { id: fixture.accountId, name: '検証店' } : null,
    loading: false,
  }),
}))

import { ApiError } from '@/lib/api'
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

async function fillAndPublish() {
  await setValue(byId('ir-name'), '夏の投稿')
  await setValue(byId('ir-ref'), 'm30-summer')
  await click(byExactText('button', '発行してURLを受け取る'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.accountId = 'account-1'
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

describe('M030 流入リンク発行の失敗は原因どおりに言い分ける', () => {
  it('403は権限の案内にし、内部文面は出さない', async () => {
    api.create.mockRejectedValue(new ApiError(403, 'API error: 403'))
    await render()
    await fillAndPublish()

    expect(host.textContent).toContain('権限')
    expect(host.textContent).not.toContain('API error: 403')
  })

  it('400は入力の直し方とサーバーの案内を出す', async () => {
    api.create.mockRejectedValue(new ApiError(400, '名前と ref_code は必須です'))
    await render()
    await fillAndPublish()

    expect(host.textContent).toContain('入力を直してください')
    expect(host.textContent).toContain('名前と ref_code は必須です')
  })

  it('409は重複の立て直し文をそのまま出す', async () => {
    api.create.mockRejectedValue(new ApiError(409, 'この ref_code は既に使われています'))
    await render()
    await fillAndPublish()

    expect(host.textContent).toContain('この ref_code は既に使われています')
  })

  it('機械コードだけの失敗は再試行の案内にし、原文のまま出さない', async () => {
    api.create.mockResolvedValue({ success: false, error: 'SOME_MACHINE_CODE' })
    await render()
    await fillAndPublish()

    expect(host.textContent).not.toContain('SOME_MACHINE_CODE')
    expect(host.textContent).toContain('もう一度お試しください')
  })
})
