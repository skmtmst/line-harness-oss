// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' }))
const network = vi.hoisted(() => ({
  puts: 0,
  saveFails: false,
  delayAccountA: false,
  resolveAccountA: null as ((value: Response) => void) | null,
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
const { default: ToastHost, clearToastsForTest } = await import('@/components/shared/toast')

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

function settingsResponse(accountId: string) {
  return {
    success: true,
    data: {
      // シナリオはカタログ既定ONと逆にして、既定値ではなく保存済みsnapshotへ
      // 戻ることを見分ける。
      features: { scenarios: accountId === 'account-b', broadcasts: true, templates: true, forms: true },
      sidebarItemOrder: accountId === 'account-a' ? { delivery: ['broadcasts', 'scenarios'] } : {},
      specializedFeatureKeys: [],
      version: accountId === 'account-a' ? 3 : 8,
    },
  }
}

let host: HTMLDivElement
let root: Root
let mounted = false

beforeEach(() => {
  fixture.accountId = 'account-a'
  network.puts = 0
  network.saveFails = false
  network.delayAccountA = false
  network.resolveAccountA = null
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    const accountId = new URL(path, 'http://localhost').searchParams.get('account_id') ?? 'account-a'
    if (path.includes('/api/analytics/usage')) return Promise.resolve(response({ success: true, data: { categories: [] } }))
    if (path.includes('/api/settings/features/impact')) {
      return Promise.resolve(response({ success: true, data: { version: 3, impacts: [], requiresConfirmation: false, impactToken: null } }))
    }
    if (path.includes('/api/settings/features') && init?.method === 'PUT') {
      network.puts += 1
      return Promise.resolve(network.saveFails
        ? response({ success: false, error: 'save failed' }, 500)
        : response({ success: true, data: { version: 4 } }))
    }
    if (path.includes('/api/settings/features') && network.delayAccountA && accountId === 'account-a') {
      return new Promise<Response>((resolve) => { network.resolveAccountA = resolve })
    }
    if (path.includes('/api/settings/features')) return Promise.resolve(response(settingsResponse(accountId)))
    return Promise.resolve(response({ success: false, error: 'not found' }, 404))
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
  clearToastsForTest()
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  // 保存の知らせは Toast（右下・4秒）で出す。置き場所も一緒に描く。
  await act(async () => {
    root.render(<><SettingsPage /><ToastHost /></>)
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

function button(label: string, occurrence = 0): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .filter((item) => item.textContent?.trim() === label)[occurrence]
  if (!found) throw new Error(`ボタンが見つかりません: ${label}`)
  return found
}

function mutableSwitch(): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((item) => !item.disabled)
  if (!found) throw new Error('切替可能な機能がありません')
  return found
}

/** 保存に必須の変更理由を入れる。 */
async function fillReason(text = 'テスト') {
  const input = host.querySelector<HTMLInputElement>('#feature-settings-reason')
  if (!input) throw new Error('変更理由の入力欄がありません')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('N-446 機能設定を保存済み状態へ戻す', () => {
  it('変更を取り消すは保存失敗後も、最後に取得したaccount別snapshotへ戻し、APIは呼ばない', async () => {
    await render()
    const toggle = mutableSwitch()
    const savedChecked = toggle.getAttribute('aria-checked')
    await act(async () => { toggle.click() })
    expect(toggle.getAttribute('aria-checked')).not.toBe(savedChecked)

    await fillReason()
    network.saveFails = true
    await act(async () => { button('機能設定を保存').click(); await settle() })
    expect(network.puts).toBe(1)
    await act(async () => { button('変更を取り消す').click() })
    expect(toggle.getAttribute('aria-checked')).toBe(savedChecked)
    expect(network.puts).toBe(1)
    expect(document.body.textContent).toContain('保存済みの機能設定に戻しました。')
  })

  it('初期値は確認後だけ下書きへ入り、二重操作しても保存前にサーバーを変更しない', async () => {
    await render()
    const toggle = mutableSwitch()
    const savedChecked = toggle.getAttribute('aria-checked')
    await act(async () => { button('初期値に戻す').click(); button('初期値に戻す').click() })
    expect(document.body.textContent).toContain('初期値に戻しますか？')
    expect(toggle.getAttribute('aria-checked')).toBe(savedChecked)
    expect(network.puts).toBe(0)
    await act(async () => { button('初期値を下書きに入れる').click(); button('初期値を下書きに入れる').click() })
    expect(network.puts).toBe(0)
    expect(button('機能設定を保存').disabled).toBe(false)
    expect(document.body.textContent).toContain('保存すると反映されます。')
  })

  it('account切替と遅延した旧応答では、旧snapshotや確認窓を新accountへ混ぜない', async () => {
    await render()
    await act(async () => { button('初期値に戻す').click() })
    expect(document.body.textContent).toContain('初期値に戻しますか？')

    fixture.accountId = 'account-b'
    await render()
    await settle()
    expect(document.body.textContent).not.toContain('初期値に戻しますか？')
    expect(mutableSwitch().getAttribute('aria-checked')).toBe('true')

    // Aへ戻る読込を遅らせたあとBへ戻す。遅延A応答が最後に届いても、Bの
    // snapshot/表示を上書きできない。
    network.delayAccountA = true
    fixture.accountId = 'account-a'
    await render()
    fixture.accountId = 'account-b'
    await render()
    await settle()

    await act(async () => {
      network.resolveAccountA?.(response(settingsResponse('account-a')))
      await settle()
    })
    expect(mutableSwitch().getAttribute('aria-checked')).toBe('true')
    expect(button('変更を取り消す').disabled).toBe(true)
  })
})
