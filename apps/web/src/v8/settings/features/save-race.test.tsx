// @vitest-environment happy-dom
/*
 * 監査 WEB190/191：機能設定の保存と、保存後の読み直しの世代。
 * - 191：保存中はスイッチを押せない（保存後の読み直しが途中の変更を黙って消すため）
 * - 190：A で保存→読み直しが失敗するまでに B へ切り替えたら、A の版・中身を B に書かない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFeatureSettingsCache } from '@/lib/feature-settings-cache'

const fixture = vi.hoisted(() => ({ account: 'account-a' }))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.account, loading: false }),
}))

const { default: FeatureSettingsScreen } = await import('./screen')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root
let putGate: { resolve: () => void } | null
let afterSaveGet: { reject: () => void } | null
let puts = 0

beforeEach(() => {
  fixture.account = 'account-a'
  puts = 0
  putGate = null
  afterSaveGet = null
  clearFeatureSettingsCache()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    if (path.includes('/api/staff/me')) return response({ success: true, data: { id: 'staff-1', role: 'owner', permissionKeys: [] } })
    if (path.includes('/api/settings/features') && init?.method === 'PUT') {
      puts += 1
      await new Promise<void>((resolve) => { putGate = { resolve } })
      return response({ success: true, data: { version: 4 } })
    }
    if (path.includes('/api/settings/features')) {
      const isB = path.includes('account-b')
      if (!isB && puts > 0) {
        await new Promise<void>((_, reject) => { afterSaveGet = { reject: () => reject(new TypeError('network')) } })
      }
      return response({
        success: true,
        data: { features: { scenarios: true, broadcasts: !isB, webinars: false }, sidebarItemOrder: {}, specializedFeatureKeys: [], version: isB ? 9 : 3 },
      })
    }
    if (path.includes('/api/analytics/usage')) return response({ success: true, data: { categories: [] } })
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }
}

function webinarSwitch(): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
    .find((button) => button.getAttribute('aria-label')?.includes('ウェビナー'))
  if (!found) throw new Error('ウェビナーのスイッチが無い')
  return found
}

async function startSave() {
  await act(async () => { webinarSwitch().click() })
  const reason = host.querySelector<HTMLInputElement>('#feature-settings-reason')
  if (!reason) throw new Error('理由の欄が無い')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(reason, 'テスト')
    reason.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const saveButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('機能設定を保存'))
  if (!saveButton) throw new Error('保存ボタンが無い')
  await act(async () => { saveButton.click() })
  await flush()
}

describe('機能設定の保存の世代（WEB190/191）', () => {
  it('保存中はスイッチを押せない', async () => {
    await act(async () => { root.render(<FeatureSettingsScreen />) })
    await flush()
    // ウェビナーの区分が畳まれていたら開く。
    if (![...host.querySelectorAll('[role="switch"]')].some((b) => b.getAttribute('aria-label')?.includes('ウェビナー'))) {
      for (const button of [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]) {
        await act(async () => { button.click() })
      }
    }
    await startSave()
    expect(putGate).not.toBeNull()
    expect(webinarSwitch().disabled).toBe(true)
    await act(async () => { putGate?.resolve() })
    await flush()
  })

  it('保存後の読み直しが失敗するまでに B へ切り替えたら、A の中身で B を「変更あり」にしない', async () => {
    await act(async () => { root.render(<FeatureSettingsScreen />) })
    await flush()
    for (const button of [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]) {
      await act(async () => { button.click() })
    }
    await startSave()
    await act(async () => { putGate?.resolve() })
    await flush()
    expect(afterSaveGet).not.toBeNull()
    fixture.account = 'account-b'
    await act(async () => { root.render(<FeatureSettingsScreen />) })
    await flush()
    await act(async () => { afterSaveGet?.reject() })
    await flush()
    // B の保存値と画面の値が同じなら、理由の欄（変更ありのときだけ出る）は無い。
    expect(host.querySelector('#feature-settings-reason')).toBeNull()
  })
})
