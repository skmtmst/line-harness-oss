// @vitest-environment happy-dom
/*
 * ★V8-B EC連携の「つなぎ先」（板 `iLJmw`）。
 * V8 の枠（題・説明・設定の中の案内・入口のタブ）で今の板を包み、
 * 見るだけの担当者には保存の入口を出さないこと。
 * 板の目印（data-design-node）は板側（connector-panel）が持つため、
 * 枠側で二重に持たない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const staffMe = vi.hoisted(() => vi.fn())
const ecOverview = vi.hoisted(() => vi.fn())
const ecIdentities = vi.hoisted(() => vi.fn())
const ecConnectorRead = vi.hoisted(() => vi.fn())
const featureVisibility = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: staffMe },
      featureSettings: { ...actual.api.featureSettings, visibility: featureVisibility },
      ecCommerce: {
        ...actual.api.ecCommerce,
        overview: ecOverview,
        operationIdentityCandidates: ecIdentities,
        connector: Object.assign(ecConnectorRead, { read: ecConnectorRead }),
      },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/ec-commerce',
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import EcConnectorV8 from './ec-connector-v8'

const v8css = readFileSync(join(process.cwd(), 'src/app/ec-commerce/ec-connector-v8.module.css'), 'utf8')
const v8tsx = readFileSync(join(process.cwd(), 'src/app/ec-commerce/ec-connector-v8.tsx'), 'utf8')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // 設定の中の案内が読む手元の保存値。試験では空にしておく。
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  staffMe.mockReset()
  ecOverview.mockReset()
  ecIdentities.mockReset()
  ecConnectorRead.mockReset()
  featureVisibility.mockReset()
  staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
  featureVisibility.mockResolvedValue({ success: true, data: {} })
  ecOverview.mockResolvedValue({ success: true, data: { total: 2486, subscriptions: 0 } })
  ecIdentities.mockResolvedValue({ success: true, data: { summary: { unmatched: 24 } } })
  ecConnectorRead.mockResolvedValue({
    success: true,
    data: {
      configured: true,
      connector: {
        id: 'c1',
        provider: 'ec_cube',
        shopDomain: 'https://shop.nen.example',
        status: 'connected',
        secretConfigured: true,
        secretLastFour: 'a3F9',
        secretUpdatedAt: null,
        eventTypes: ['ec.order.confirmed'],
        identityRules: ['verified_email'],
        version: 1,
        updatedAt: '2026-10-02T00:00:00.000Z',
      },
      health: { lastReceivedAt: '2026-10-02T06:58:00.000Z', lastSucceededAt: '2026-10-02T06:58:00.000Z', today: 42, last30Days: 1204, failed: 0 },
      impact: { nenCampaigns: 1, conversions: 2, mileageRules: 0, friendFields: 0, analytics: 0 },
      retryPolicy: null,
    },
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<EcConnectorV8 />) })
  await flush()
}

describe('V8-B つなぎ先（iLJmw）', () => {
  it('V8 の枠で今の板を包む', async () => {
    await renderV8()
    expect(document.querySelector('[data-design-node="iLJmw"]'), '板IDの枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('EC連携')
    expect(document.body.textContent).toContain('つなぎ先の情報')
    expect(document.body.textContent).toContain('設定を保存する')
  })

  it('見るだけの担当者には保存の入口を出さない', async () => {
    staffMe.mockResolvedValue({ success: true, data: { role: 'staff' } })
    await renderV8()
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === '設定を保存する') as HTMLButtonElement
    expect(save, '保存口がある').toBeTruthy()
    expect(save.disabled, '押せない').toBe(true)
    expect(document.body.textContent).toContain('見るだけの権限では設定を変えられません')
  })

  it('V8 の決まり（layer・色直書きなし・準備中なし）を守る', async () => {
    await renderV8()
    expect(v8css.split('\n')[0]).toContain('@layer properties, theme, base, components, utilities;')
    expect(v8css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(v8css).not.toMatch(/box-shadow\s*:/)
    expect(v8tsx).not.toContain('data-design-node=')
    expect(document.querySelector('[data-design-node="iLJmw"]'), '板側の目印が1つある').toBeTruthy()
    expect(document.querySelectorAll('[data-design-node="iLJmw"]').length, '目印は二重にしない').toBe(1)
    expect(v8tsx).not.toContain('準備中')
  })
})
