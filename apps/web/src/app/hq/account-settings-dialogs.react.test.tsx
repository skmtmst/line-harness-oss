// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { AccountArchiveDialog, AccountRestoreDialog, AccountSettingsDialog } from './account-settings-dialogs'
import type { AccountWithStats } from '@/contexts/account-context'

/*
 * ★V8-B 統括のアカウントの3つの窓（板 `HMpVx`・`D6ljr`・`HFsO9`）の契約。
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
  const confirm = Array.from(document.body.querySelectorAll('button'))
    .find((button) => (button.textContent ?? '').includes('本人確認してアーカイブする'))
  expect(confirm).toBeTruthy()
  await act(async () => { confirm!.click() })
  await settle()
  expect(calls.some((call) => call.url === '/api/auth/step-up')).toBe(true)
  expect(calls.some((call) => call.url === '/api/line-accounts/account-a/archive')).toBe(true)
  expect(done).toBe(true)
})

test('設定の窓はタグの付け外しを付け替えの口へ送る', async () => {
  let done = false
  await act(async () => root.render(
    <AccountSettingsDialog
      account={account}
      accounts={[account, parent]}
      archived={false}
      accountTags={[{ id: 't1', name: '渋谷エリア', color: '#2563eb' }]}
      onClose={() => {}}
      onSaved={() => { done = true }}
      onArchive={() => {}}
      onShowDetails={() => {}}
    />,
  ))
  await settle()
  const box = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
  expect(box).toBeTruthy()
  expect(box.checked).toBe(true)
  await act(async () => { box.click() })
  const save = Array.from(document.body.querySelectorAll('button'))
    .find((button) => (button.textContent ?? '').includes('保存'))
  expect(save).toBeTruthy()
  await act(async () => { save!.click() })
  await settle()
  const put = calls.find((call) => call.url === '/api/line-accounts/account-a/tags' && call.method === 'PUT')
  expect(put).toBeTruthy()
  expect(JSON.parse(put!.body)).toEqual({ tagIds: [] })
  expect(done).toBe(true)
})

test('戻す窓は板 HFsO9・6桁で復帰の口へ送る', async () => {
  let done = false
  await act(async () => root.render(
    <AccountRestoreDialog account={account} onClose={() => {}} onDone={() => { done = true }} />,
  ))
  await settle()
  expect(document.body.querySelector('[data-design-node="HFsO9"]')).toBeTruthy()
  await fillCode('654321')
  const confirm = Array.from(document.body.querySelectorAll('button'))
    .find((button) => (button.textContent ?? '').includes('本人確認して戻す'))
  expect(confirm).toBeTruthy()
  await act(async () => { confirm!.click() })
  await settle()
  expect(calls.some((call) => call.url === '/api/line-accounts/account-a/restore')).toBe(true)
  expect(done).toBe(true)
})
