// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null, role: 'owner' }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId }),
}))

import AdIntegration from './ad-integration'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let handler: (path: string, method: string) => Promise<unknown>

function mappings(account: string) {
  return { success: true, data: {
    mappings: [{
      conversionPointId: `${account}-point`, conversionPointName: `${account}の成果`,
      adPlatformId: `${account}-ad`, adPlatformName: `${account}の広告`, eventName: 'Purchase',
    }],
    conversionPoints: [{ id: `${account}-point`, name: `${account}の成果` }],
    adPlatforms: [{ id: `${account}-ad`, name: `${account}の広告` }],
  } }
}

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((done) => { resolve = done })
  return { promise, resolve }
}

async function render() {
  await act(async () => { root.render(<AdIntegration view="connections" />) })
  await settle()
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.role = 'owner'
  handler = async (path) => mappings(path.includes('account-b') ? 'account-b' : 'account-a')
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname + new URL(String(input), 'http://localhost').search
    const data = path.startsWith('/api/ad-platforms/event-mappings')
      ? await handler(path, init?.method ?? 'GET')
      : path.startsWith('/api/staff/me')
        ? { success: true, data: { role: fixture.role } }
        : path.startsWith('/api/ad-platforms/logs')
          ? { success: true, data: { items: [], total: 0 } }
          : path.startsWith('/api/ad-costs')
            ? { success: true, data: { rows: [], platforms: [] } }
            : { success: true, data: [] }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('広告の対応表のアカウント切替と保存権限', () => {
  it('前アカウントの遅い読込結果を切替後の対応表へ映さない', async () => {
    const old = deferred()
    handler = async (path) => path.includes('account-a') ? old.promise : mappings('account-b')
    await render()
    fixture.accountId = 'account-b'
    await render()
    expect(host.textContent).toContain('account-bの成果')
    old.resolve(mappings('account-a'))
    await settle()
    expect(host.textContent).toContain('account-bの成果')
    expect(host.textContent).not.toContain('account-aの成果')
  })

  it('切替先を読み込んでいる間、前アカウントの対応表と入力候補を残さない', async () => {
    await render()
    const pending = deferred()
    handler = async () => pending.promise
    fixture.accountId = 'account-b'
    await render()
    expect(host.textContent).not.toContain('account-aの成果')
    expect(host.textContent).not.toContain('account-aの広告')
    pending.resolve(mappings('account-b'))
    await settle()
  })

  it('前アカウントの保存結果を切替後の対応表へ映さない', async () => {
    const oldSave = deferred()
    handler = async (path, method) => method === 'PUT' ? oldSave.promise : mappings(path.includes('account-b') ? 'account-b' : 'account-a')
    await render()
    const save = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '対応表を保存する')!
    expect(save).toBeTruthy()
    await act(async () => { fireEvent.click(save) })
    fixture.accountId = 'account-b'
    await render()
    oldSave.resolve(mappings('account-a'))
    await settle()
    expect(host.textContent).toContain('account-bの成果')
    expect(host.textContent).not.toContain('account-aの成果')
  })

  it('管理者には対応表を表示し、オーナー専用の編集・保存操作を出さない', async () => {
    fixture.role = 'admin'
    await render()
    expect(host.textContent).toContain('account-aの成果')
    expect(host.textContent).not.toContain('対応表を保存する')
    expect(host.querySelector('[aria-label="account-aの成果の広告側の名前"]')).toBeNull()
  })
})
