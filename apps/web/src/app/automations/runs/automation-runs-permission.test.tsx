// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const calls = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), detail: vi.fn(), cancel: vi.fn(), download: vi.fn(), copy: vi.fn(), permissionsUnknown: false }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, fetchApi: calls.list, downloadApiFile: calls.download, api: {
    ...actual.api, staff: { ...actual.api.staff, me: calls.me },
    commonActions: { ...actual.api.commonActions, list: vi.fn(async () => ({ success: true, data: [] })) },
    automations: { ...actual.api.automations, list: vi.fn(async () => ({ success: true, data: [] })),
      templates: vi.fn(async () => ({ success: true, data: [] })), getRun: calls.detail, cancelRun: calls.cancel },
  } }
})
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  usePathname: () => '/automations/runs', useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', loading: false }) }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

vi.mock('@/v8/automations/shell', async original => {
  const actual = await original<typeof import('@/v8/automations/shell')>()
  return { ...actual, useAutomationRunManage: () => { const result = actual.useAutomationRunManage(); return calls.permissionsUnknown ? null : result } }
})

import Page from '@/v8/automations/runs'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity, readStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const retryKey = 'automation.run.retry'
const exportKey = 'automation.run.export'
const row = (id: string, cancel = false) => ({ id, automationId: 'auto-1', occurredAt: '2026-10-29T01:00:00Z',
  subject: cancel ? '待機の記録' : '失敗の記録', accountLabel: '確認用', triggerLabel: '友だち追加',
  status: cancel ? 'waiting' : 'permanent_failed', detail: '表示用の記録', durationMs: 100,
  automationName: '確認ルール', canRetry: !cancel, canCancel: cancel, versionNumber: 1, isTest: false, friendId: 'friend-1',
})
const proxy = (mode: 'read' | 'write') => ({ impersonation: { id: 'proxy', tenantId: 'tenant', mode, piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' as const })
let root: Root | null = null
let container: HTMLDivElement

function seed(overrides: Partial<StaffMember> = {}) {
  verifiedStaffRole('owner')
  act(() => { rememberStaffIdentity({ ...readStaffIdentity()!, ...overrides }) })
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }
async function mount() {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => { root!.render(<Page />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(450) }); await flush()
}
function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(node => node.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
async function click(text: string) { await act(async () => { button(text).click() }); await flush() }
async function open(index: number) {
  const nodes = Array.from(document.querySelectorAll('button')).filter(node => node.textContent === '中身を見る')
  await act(async () => { nodes[index].click() }); await flush()
}
function posts() { return calls.list.mock.calls.filter(([, init]) => init?.method === 'POST') }
function locked(node: HTMLButtonElement) {
  expect(node.getAttribute('aria-disabled')).toBe('true')
  expect(node.hasAttribute('data-permission-locked')).toBe(true)
  expect(node.disabled).toBe(false)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState({}, '', '/automations/runs'); window.dispatchEvent(new PopStateEvent('popstate'))
  forgetStaffIdentity(); forgetSessionSnapshot(); vi.resetAllMocks(); calls.permissionsUnknown = false
  calls.me.mockImplementation(() => new Promise(() => {}))
  calls.list.mockImplementation(async (url: string, init?: { method?: string }) => init?.method === 'POST'
    ? { success: true, data: { status: 'waiting' } }
    : { success: true, data: { summary: { total: 2, executed: 0, skipped: 0, failed: 1, mostRunName: null, mostRunCount: null },
      items: [row('failed'), row('waiting', true)], pagination: { total: 2, limit: 20, offset: 0 } } })
  calls.detail.mockImplementation(async (id: string) => ({ success: true, data: { ...row(id, id === 'waiting'), friendName: '記録の相手', steps: [], currentVersionNumber: 1, isCurrentVersion: true } }))
  calls.cancel.mockResolvedValue({ success: true, data: {} })
  calls.download.mockResolvedValue({ totalCount: 2, returnedCount: 2, truncated: false })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: calls.copy.mockResolvedValue(undefined) } })
})
afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = null; container?.remove(); document.body.innerHTML = ''
  forgetStaffIdentity(); forgetSessionSnapshot(); delete document.documentElement.dataset.theme; vi.useRealTimers()
})

describe('実行記録の専用権限と閲覧の対照', () => {
  it('再試行の鍵があるstaffはretry/cancel各1、CSVの鍵を代用しない', async () => {
    seed({ role: 'staff', permissionKeys: ['/automations', retryKey] }); await mount()
    locked(button('CSVで書き出す')); await click('CSVで書き出す'); expect(calls.download).not.toHaveBeenCalled()
    await open(0); await click('失敗した処理をもう一度やる'); expect(posts()).toHaveLength(1)
    await open(1); await click('この実行を取りやめる'); await click('取りやめる'); expect(calls.cancel).toHaveBeenCalledExactlyOnceWith('waiting')
  })

  it('CSVの鍵があるstaffはCSV1、再試行0、読取と結果の絞り込みを保つ', async () => {
    seed({ role: 'staff', permissionKeys: ['/automations', exportKey] }); await mount()
    await click('CSVで書き出す'); expect(calls.download).toHaveBeenCalledTimes(1)
    await open(0); locked(button('失敗した処理をもう一度やる')); await click('失敗した処理をもう一度やる')
    expect(posts()).toHaveLength(0); expect(calls.detail).toHaveBeenCalledWith('failed')
    const before = calls.list.mock.calls.length
    const failedTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(node => node.textContent?.startsWith('失敗'))!
    await act(async () => { failedTab.click() }); await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(calls.list.mock.calls.length).toBeGreaterThan(before)
    expect(calls.list.mock.calls.some(([url]) => String(url).includes('status=problems'))).toBe(true)
  })

  it.each([
    { role: 'staff' as const, permissionKeys: ['/automations'] },
    { role: 'viewer' as const }, { readOnly: true }, { roleBundle: 'view_only' as const },
  ])('拒否%jでも同じretry/cancel/CSVを灰色で残し、API0', async restriction => {
    seed(restriction); await mount()
    locked(button('CSVで書き出す')); await click('CSVで書き出す')
    await open(0); locked(button('失敗した処理をもう一度やる')); await click('失敗した処理をもう一度やる')
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click() }); await open(1)
    locked(button('この実行を取りやめる')); await click('この実行を取りやめる')
    expect(posts()).toHaveLength(0); expect(calls.cancel).not.toHaveBeenCalled(); expect(calls.download).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
    expect(calls.detail).toHaveBeenCalledWith('waiting')
  })

  it('owner本人確定後もpermissions未確定なら理由と帯0/native disabled、確定後にCSV1', async () => {
    seed(); calls.permissionsUnknown = true; await mount()
    expect(document.querySelectorAll('[data-read-only-notice], [data-permission-locked]')).toHaveLength(0)
    expect(button('CSVで書き出す').disabled).toBe(true)
    await open(0); expect(button('失敗した処理をもう一度やる').disabled).toBe(true)
    await click('CSVで書き出す'); await click('失敗した処理をもう一度やる')
    expect(posts()).toHaveLength(0); expect(calls.download).not.toHaveBeenCalled()
    calls.permissionsUnknown = false
    await act(async () => { root!.render(<Page />) }); await click('CSVで書き出す')
    expect(calls.download).toHaveBeenCalledTimes(1)
  })

  it('未知は理由と帯0/native disabled/操作0、本人確定後は操作できる', async () => {
    await mount()
    expect(document.querySelectorAll('[data-read-only-notice], [data-permission-locked]')).toHaveLength(0)
    expect(button('CSVで書き出す').disabled).toBe(true)
    await open(0); expect(button('失敗した処理をもう一度やる').disabled).toBe(true)
    await click('失敗した処理をもう一度やる'); expect(posts()).toHaveLength(0)
    seed(); await flush(); await click('失敗した処理をもう一度やる'); expect(posts()).toHaveLength(1)
  })

  it('read代理は書込とサーバCSV0、GETとローカルcopyは保つ。writeへ戻るとCSV1', async () => {
    seed(); rememberSessionSnapshot(proxy('read')); await mount()
    locked(button('CSVで書き出す')); await click('CSVで書き出す'); await open(0)
    locked(button('失敗した処理をもう一度やる')); await click('失敗した処理をもう一度やる')
    const copy = document.querySelector<HTMLButtonElement>('button[aria-label="この記録をコピー"]')!
    expect(copy).not.toBeNull(); await act(async () => { copy.click() }); await flush()
    expect(calls.copy).toHaveBeenCalledTimes(1); expect(calls.detail).toHaveBeenCalledWith('failed')
    expect(posts()).toHaveLength(0); expect(calls.download).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
    await act(async () => { rememberSessionSnapshot(proxy('write')) }); await click('CSVで書き出す')
    expect(calls.download).toHaveBeenCalledTimes(1)
  })

  it('描画更新前のwrite→readでも、保持したretry/cancel/CSVのhandlerを実行時に拒否', async () => {
    seed(); await mount(); await open(1); await click('この実行を取りやめる')
    // Reactが描画し直す前に同じ実DOMからclickし、UIだけの拒否にしない。
    await act(async () => {
      rememberSessionSnapshot(proxy('read'))
      button('取りやめる').click(); button('CSVで書き出す').click()
    }); await flush()
    expect(calls.cancel).not.toHaveBeenCalled(); expect(calls.download).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('実行を取りやめますか？')
    await act(async () => { rememberSessionSnapshot(proxy('write')) }); await open(0)
    await act(async () => { rememberSessionSnapshot(proxy('read')); button('失敗した処理をもう一度やる').click() }); await flush()
    expect(posts()).toHaveLength(0)
  })
})
