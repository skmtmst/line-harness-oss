// @vitest-environment happy-dom
/*
 * 監査 WEB-007：機能オフの案内は、同じ URL のままアカウントを切り替えたら外す。
 * 外さないと、オンのアカウントへ移っても中身が描かれず読み込みも始まらない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const state = vi.hoisted(() => ({ accountId: 'account-a', pathname: '/webinars' }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@/contexts/account-context', () => ({
  useOptionalAccount: () => ({ selectedAccountId: state.accountId, selectedAccount: null, loading: false }),
}))

import FeatureDisabledGate from './feature-disabled-gate'
import { FEATURE_DISABLED_EVENT, fetchApi } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  state.accountId = 'account-a'
  state.pathname = '/webinars'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const render = () => act(async () => {
  root.render(<FeatureDisabledGate><p>ウェビナーの中身</p></FeatureDisabledGate>)
})

it('オフの案内のあと、同じ URL でアカウントを切り替えると中身へ戻る', async () => {
  await render()
  await act(async () => {
    window.dispatchEvent(new CustomEvent(FEATURE_DISABLED_EVENT, { detail: { featureId: 'webinars' } }))
  })
  expect(host.textContent).toContain('この機能は設定でオフになっています')
  expect(host.textContent).not.toContain('ウェビナーの中身')

  state.accountId = 'account-b'
  await render()
  expect(host.textContent).toContain('ウェビナーの中身')
  expect(host.textContent).not.toContain('この機能は設定でオフになっています')
  // 今の画面から取得した機能オフの応答は、引き続き案内を出す。
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'FEATURE_DISABLED', featureId: 'webinars' }), { status: 403 })))
  await act(async () => { await fetchApi('/api/webinars?lineAccountId=account-b').catch(() => undefined) })
  expect(host.textContent).toContain('この機能は設定でオフになっています')
})

it('同じアカウントのまま描き直しても案内は残す', async () => {
  await render()
  await act(async () => {
    window.dispatchEvent(new CustomEvent(FEATURE_DISABLED_EVENT, { detail: { featureId: 'webinars' } }))
  })
  await render()
  expect(host.textContent).toContain('この機能は設定でオフになっています')
})

it('WEB-007：Aの遅い機能オフの返事はBへ切り替えた画面を隠さない', async () => {
  await render()
  state.accountId = 'account-b'
  await render()
  await act(async () => {
    window.dispatchEvent(new CustomEvent(FEATURE_DISABLED_EVENT, { detail: { featureId: 'webinars', accountId: 'account-a' } }))
  })
  expect(host.textContent).toContain('ウェビナーの中身')
  await act(async () => {
    window.dispatchEvent(new CustomEvent(FEATURE_DISABLED_EVENT, { detail: { featureId: 'webinars', accountId: 'account-b' } }))
  })
  expect(host.textContent).toContain('この機能は設定でオフになっています')
})

it.each(['同じアカウントへ戻った後', '別のURLへ移った後'])('WEB-007：%sも古い取得の世代を捨てる', async (scenario) => {
  await render()
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const pending = fetchApi('/api/webinars?lineAccountId=account-a').catch(() => undefined)
  if (scenario === '同じアカウントへ戻った後') {
    state.accountId = 'account-b'
    await render()
    state.accountId = 'account-a'
  } else state.pathname = '/hq/broadcasts'
  await render()
  await act(async () => {
    finish(new Response(JSON.stringify({ code: 'FEATURE_DISABLED', featureId: 'webinars' }), { status: 403 }))
    await pending
  })
  expect(host.textContent).toContain('ウェビナーの中身')
  expect(host.textContent).not.toContain('この機能は設定でオフになっています')
})
