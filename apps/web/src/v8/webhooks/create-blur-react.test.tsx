// @vitest-environment happy-dom
/*
 * 外部連携を作る：保存を押す前に、離れた欄だけをその場で確かめる（間違えない・怖くない）。
 * 理由は欄の真下に読み上げつきで出し、「何をすれば直るか」の1文にする。正しく入れ終えた欄は、赤と理由をすぐ消す。
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/webhooks/new',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))

import WebhooksCreateV8 from './create'

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: [] }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const field = (id: string) => document.getElementById(id) as HTMLInputElement

test('名前とURLは、離れた欄だけを赤くし、直す1文を読み上げつきで出す', () => {
  render(<WebhooksCreateV8 />)
  fireEvent.blur(field('wh-new-name'))
  expect(field('wh-new-name').getAttribute('aria-invalid')).toBe('true')
  expect(field('wh-new-url').getAttribute('aria-invalid')).toBeNull()
  const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent)
  expect(alerts()).toEqual(['名前を入力してください'])

  fireEvent.change(field('wh-new-url'), { target: { value: 'http://example.com/hook' } })
  fireEvent.blur(field('wh-new-url'))
  expect(field('wh-new-url').getAttribute('aria-invalid')).toBe('true')
  expect(alerts()).toEqual(['名前を入力してください', 'URLは https:// で始めてください'])

  for (const text of alerts()) expect(text).toMatch(/ください$/)
})

test('赤い欄は、正しく入れるとすぐ赤と理由を消す（保存を押し直さない）', () => {
  render(<WebhooksCreateV8 />)
  fireEvent.blur(field('wh-new-name'))
  expect(field('wh-new-name').getAttribute('aria-invalid')).toBe('true')
  fireEvent.change(field('wh-new-name'), { target: { value: '予約台帳' } })
  expect(field('wh-new-name').getAttribute('aria-invalid')).toBeNull()
  expect(document.querySelector('[role="alert"]')).toBeNull()
  fireEvent.change(field('wh-new-url'), { target: { value: 'http://example.com' } })
  fireEvent.blur(field('wh-new-url'))
  fireEvent.change(field('wh-new-url'), { target: { value: 'https://example.com/hook' } })
  expect(field('wh-new-url').getAttribute('aria-invalid')).toBeNull()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
