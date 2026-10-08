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

const state = vi.hoisted(() => ({ accountId: 'account-a' }))
vi.mock('next/navigation', () => ({ usePathname: () => '/webinars' }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: state.accountId, selectedAccount: null, loading: false }),
}))

import FeatureDisabledGate from './feature-disabled-gate'
import { FEATURE_DISABLED_EVENT } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  state.accountId = 'account-a'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
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
})

it('同じアカウントのまま描き直しても案内は残す', async () => {
  await render()
  await act(async () => {
    window.dispatchEvent(new CustomEvent(FEATURE_DISABLED_EVENT, { detail: { featureId: 'webinars' } }))
  })
  await render()
  expect(host.textContent).toContain('この機能は設定でオフになっています')
})
