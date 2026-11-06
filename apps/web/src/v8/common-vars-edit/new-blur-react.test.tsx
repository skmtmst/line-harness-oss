// @vitest-environment happy-dom
/*
 * 共通情報を作る：保存を押す前に、離れた欄だけをその場で確かめる（間違えない・怖くない）。
 * 理由は欄の真下に読み上げつきで出し、「何をすれば直るか」の1文にする。正しく入れ終えた欄は、赤と理由をすぐ消す。
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: { ...actual.api.commonVars, create: vi.fn() },
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    },
  }
})
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', loading: false }) }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

import NewCommonVarV8 from './new'

afterEach(cleanup)

const field = (id: string) => document.getElementById(id) as HTMLInputElement
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent)

test('名前と差し込み名は、離れた欄だけを赤くし、直す1文を読み上げつきで出す', () => {
  render(<NewCommonVarV8 />)
  fireEvent.blur(field('cv-name'))
  expect(field('cv-name').getAttribute('aria-invalid')).toBe('true')
  expect(field('cv-key').getAttribute('aria-invalid')).toBeNull()
  expect(alerts()).toEqual(['共通情報名を入力してください'])
  fireEvent.change(field('cv-key'), { target: { value: '1shop' } })
  fireEvent.blur(field('cv-key'))
  expect(field('cv-key').getAttribute('aria-invalid')).toBe('true')
  expect(alerts()).toEqual(['共通情報名を入力してください', '差し込み名は半角の英小文字で始め、英小文字・数字・下線だけで32文字までにしてください'])
})

test('赤い欄は、正しく入れるとすぐ赤と理由を消す', () => {
  render(<NewCommonVarV8 />)
  fireEvent.blur(field('cv-name'))
  fireEvent.change(field('cv-name'), { target: { value: '営業時間' } })
  expect(field('cv-name').getAttribute('aria-invalid')).toBeNull()
  fireEvent.change(field('cv-key'), { target: { value: 'Shop' } })
  fireEvent.blur(field('cv-key'))
  expect(field('cv-key').getAttribute('aria-invalid')).toBe('true')
  fireEvent.change(field('cv-key'), { target: { value: 'shop_hours' } })
  expect(field('cv-key').getAttribute('aria-invalid')).toBeNull()
  expect(alerts()).toEqual([])
})
