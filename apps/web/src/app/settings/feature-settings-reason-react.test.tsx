// @vitest-environment happy-dom
/*
 * N-444: 機能設定の保存に変更理由を必須にする画面側の動作を、
 * 実際に描画したページで確認する。
 * - 空・空白だけの理由ではPUTを送らない
 * - 入力した理由はtrimしてPUT本文へ載せる
 * - 保存成功・変更取消・アカウント切替で理由を消す
 * - 保存失敗では入力済みの理由を残す（打ち直しさせない）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' }))
const network = vi.hoisted(() => ({
  saveFails: false,
  puts: [] as Array<{ accountId: string; body: Record<string, unknown> }>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

const { default: SettingsPage } = await import('./page')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

let host: HTMLDivElement
let root: Root
let mounted = false

function featureResponse(accountId: string) {
  return {
    success: true,
    data: {
      features: { scenarios: true, broadcasts: true, templates: true, forms: true },
      sidebarItemOrder: {}, specializedFeatureKeys: [], version: accountId === 'account-a' ? 3 : 8,
    },
  }
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  network.saveFails = false
  network.puts = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    const accountId = new URL(path, 'http://localhost').searchParams.get('account_id') ?? 'account-a'
    if (path.includes('/api/settings/features') && init?.method === 'PUT') {
      network.puts.push({
        accountId,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      })
      return network.saveFails
        ? response({ success: false, error: 'save failed' }, 500)
        : response({ success: true, data: { version: 4 } })
    }
    if (path.includes('/api/settings/features')) return response(featureResponse(accountId))
    if (path.includes('/api/analytics/usage')) return response({ success: true, data: { categories: [] } })
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<SettingsPage />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`ボタンが見つかりません: ${label}`)
  return found
}

function reasonInput(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('#feature-settings-reason')
}

async function makeDirty() {
  const toggle = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
    .find((item) => !item.disabled && item.getAttribute('aria-checked') === 'false')
    ?? [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((item) => !item.disabled)
  if (!toggle) throw new Error('切替可能な機能がありません')
  await act(async () => { toggle.click(); await Promise.resolve() })
  expect(button('機能設定を保存').disabled).toBe(false)
}

async function fillReason(text: string) {
  const input = reasonInput()
  if (!input) throw new Error('変更理由の入力欄がありません')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('N-444 機能設定の変更理由', () => {
  it('変更があるときだけ理由の入力欄を出し、空ではPUTを送らず理由を促す', async () => {
    await render()
    expect(reasonInput()).toBeNull()
    await makeDirty()
    expect(reasonInput()).not.toBeNull()
    await act(async () => { button('機能設定を保存').click(); await settle() })
    expect(network.puts).toHaveLength(0)
    expect(document.body.textContent).toContain('変更理由を入力してください')
  })

  it('空白だけの理由も送らず、入力した理由はtrimしてPUT本文へ載せる', async () => {
    await render()
    await makeDirty()
    await fillReason('   ')
    await act(async () => { button('機能設定を保存').click(); await settle() })
    expect(network.puts).toHaveLength(0)

    await fillReason('  使わない配信を止めるため  ')
    await act(async () => { button('機能設定を保存').click(); await settle(); await settle() })
    expect(network.puts).toHaveLength(1)
    expect(network.puts[0].accountId).toBe('account-a')
    expect(network.puts[0].body.reason).toBe('使わない配信を止めるため')
  })

  it('保存成功で理由を消し、保存失敗では入力済みの理由を残す', async () => {
    await render()
    await makeDirty()
    await fillReason('失敗させる')
    network.saveFails = true
    await act(async () => { button('機能設定を保存').click(); await settle() })
    expect(network.puts).toHaveLength(1)
    expect(reasonInput()!.value).toBe('失敗させる')

    network.saveFails = false
    await act(async () => { button('機能設定を保存').click(); await settle(); await settle() })
    expect(network.puts).toHaveLength(2)
    expect(reasonInput()).toBeNull()
  })

  it('変更を取り消すと理由も消し、アカウント切替で理由を持ち越さない', async () => {
    await render()
    await makeDirty()
    await fillReason('Aでの理由')
    await act(async () => { button('変更を取り消す').click() })
    expect(reasonInput()).toBeNull()

    await makeDirty()
    await fillReason('Aでの理由2')
    fixture.accountId = 'account-b'
    await render()
    expect(reasonInput()).toBeNull()

    // Bでは理由が消えているので、入力なしでは保存を送れない。
    // Aの理由が残っていたら、この保存がAの理由で通ってしまう。
    await makeDirty()
    await act(async () => { button('機能設定を保存').click(); await settle() })
    expect(network.puts).toHaveLength(0)
    expect(document.body.textContent).toContain('変更理由を入力してください')

    await fillReason('Bでの理由')
    await act(async () => { button('機能設定を保存').click(); await settle(); await settle() })
    expect(network.puts).toHaveLength(1)
    expect(network.puts[0].accountId).toBe('account-b')
    expect(network.puts[0].body.reason).toBe('Bでの理由')
  })
})
