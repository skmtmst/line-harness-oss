// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, getByRole } from '@testing-library/react'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
import { AccountArchiveDialogV8 as AccountArchiveDialog, AccountRestoreDialogV8 as AccountRestoreDialog, AccountSettingsDialogV8 as AccountSettingsDialog } from '@/v8/hq/account-dialogs'
import type { AccountWithStats } from '@/contexts/account-context'

/*
 * ★V8-B 統括のアカウントの3つの窓（板 ・・）の契約。
 * 設定・保存・復帰の窓が出て、理由と6桁コードで口へ送ることを固定する。
 */
const account = {
  id: 'account-a',
  channelId: '2001234567',
  name: '然 -NEN- 渋谷店',
  isActive: true,
  country: null,
  role: 'owner',
  displayOrder: 1,
} as AccountWithStats
const parent = {
  id: 'account-hq',
  channelId: '2000000001',
  name: '然 -NEN- 本部',
  isActive: true,
  country: null,
  role: 'owner',
  displayOrder: 0,
} as AccountWithStats

let root: Root
let host: HTMLDivElement
let calls: Array<{ url: string; method: string; body: string }>
const response = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json' } },
)

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  calls = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ url: url.pathname, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' })
    if (url.pathname === '/api/auth/step-up') return response({ success: true, data: { token: 'step-up-token', purpose: 'line_account.archive', expiresAt: '2026-10-03T00:00:00' } })
    if (url.pathname === '/api/line-account-tags') return response({ success: true, data: [{ id: 't1', name: '渋谷エリア', color: '#2563eb' }] })
    return response({ success: true, data: { id: 'account-a' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function boxes(): HTMLInputElement[] {
  return Array.from(document.body.querySelectorAll('input[inputmode="numeric"]')) as HTMLInputElement[]
}

async function fillCode(code: string) {
  const inputs = boxes()
  expect(inputs).toHaveLength(6)
  for (let index = 0; index < 6; index += 1) {
    const input = inputs[index]!
    input.focus()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, code[index] ?? '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
}

test('設定の窓は板 HMpVx・名前・親・アーカイブが出る', async () => {
  await act(async () => root.render(
    <AccountSettingsDialog
      account={account}
      accounts={[account, parent]}
      archived={false}
      onClose={() => {}}
      onSaved={() => {}}
      onArchive={() => {}}
      onShowDetails={() => {}}
    />,
  ))
  await settle()
  expect(document.body.querySelector('[data-design-node="HMpVx"]')).toBeTruthy()
  expect(document.body.textContent).toContain('アカウントの設定')
  expect(document.body.textContent).toContain('アーカイブ')
})

test('保存の窓は板 D6ljr・理由と6桁で保存の口へ送る', async () => {
  let done = false
  await act(async () => root.render(
    <AccountArchiveDialog account={account} onClose={() => {}} onDone={() => { done = true }} />,
  ))
  await settle()
  expect(document.body.querySelector('[data-design-node="D6ljr"]')).toBeTruthy()
  await fillCode('123456')
  // 現役の6桁入力は最後の桁で本人確認する。
  await settle()
  expect(calls.some((call) => call.url === '/api/auth/step-up')).toBe(true)
  expect(calls.some((call) => call.url === '/api/line-accounts/account-a/archive')).toBe(true)
  expect(done).toBe(true)
})

test('設定の窓はフォルダを選んで保存すると付け替え口へ送る（板 HMpVx・API-17）', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    calls.push({ url: url.pathname, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' })
    if (url.pathname === '/api/line-account-folders' && (init?.method ?? 'GET') === 'GET') {
      return response({ success: true, data: { folders: [{ id: 'folder-area', name: '渋谷エリア', color: null, displayOrder: 0 }], unfiledCount: 0 } })
    }
    return response({ success: true, data: { id: 'account-a' } })
  }))
  let saved = false
  const tagged = { ...account, tags: [] as Array<{ id: string; name: string; color: string | null }> }
  await act(async () => root.render(
    <AccountSettingsDialog
      account={tagged}
      accounts={[tagged, parent]}
      archived={false}
      onClose={() => {}}
      onSaved={() => { saved = true }}
      onArchive={() => {}}
      onShowDetails={() => {}}
    />,
  ))
  await settle()
  await settle()
  await act(async () => { fireEvent.click(getByRole(document.body, 'button', { name: 'フォルダ' })) })
  const folder = getByRole(document.body, 'option', { name: '渋谷エリア' })
  await act(async () => { fireEvent.click(folder.querySelector('button') ?? folder) })
  expect(getByRole(document.body, 'button', { name: 'フォルダ' }).textContent).toContain('渋谷エリア')
  const save = Array.from(document.body.querySelectorAll('button'))
    .find((button) => (button.textContent ?? '') === '保存')
  expect(save).toBeTruthy()
  await act(async () => { save!.click() })
  await settle()
  const put = calls.find((call) => call.url === '/api/line-accounts/account-a/folder' && call.method === 'PUT')
  expect(put && JSON.parse(put.body)).toEqual({ folderId: 'folder-area' })
  expect(saved).toBe(true)
})

test('戻す窓は板 HFsO9・6桁で復帰の口へ送る', async () => {
  let done = false
  await act(async () => root.render(
    <AccountRestoreDialog account={account} onClose={() => {}} onDone={() => { done = true }} />,
  ))
  await settle()
  expect(document.body.querySelector('[data-design-node="HFsO9"]')).toBeTruthy()
  await fillCode('654321')
  // 現役の6桁入力は最後の桁で本人確認する。
  await settle()
  expect(calls.some((call) => call.url === '/api/line-accounts/account-a/restore')).toBe(true)
  expect(done).toBe(true)
})
