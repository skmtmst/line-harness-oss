// @vitest-environment happy-dom
/*
 * V8 NEN配信「配信を直す」（src/v8/nen-campaigns/edit.tsx：w5pwG）と
 * 「コラムを書く」（column-new.tsx：yRDwW）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * V8 のテーマで出す・選んだ値が保存に乗る・閲覧のみの人には押せない保存を置かない・
 * コラムは配信対象を1つの欄で選び、足りないと保存せずに理由を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const calls = vi.hoisted(() => ({
  settings: vi.fn(),
  forms: vi.fn(),
  overview: vi.fn(),
  loginUsers: vi.fn(),
  updateSetting: vi.fn(),
  tags: vi.fn(),
  audience: vi.fn(),
  createColumn: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenCampaigns: { ...actual.api.nenCampaigns, settings: calls.settings, overview: calls.overview, updateSetting: calls.updateSetting, columnAudience: calls.audience, createColumn: calls.createColumn },
      forms: { ...actual.api.forms, list: calls.forms },
      accountSettings: { ...actual.api.accountSettings, getTestRecipientLoginUsers: calls.loginUsers },
      tags: { ...actual.api.tags, list: calls.tags },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: calls.push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/nen-campaigns/edit',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '然 - NEN -', displayName: '然 - NEN -', liffId: null }, accounts: [], loading: false }),
}))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import CampaignEdit from './edit'
import ColumnNew from './column-new'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const REVIEW = {
  campaignKey: 'review_request', label: '口コミのお願い', category: 'follow_up', triggerEvent: 'ec.order.arrived', delayDays: 10, deliveryTime: '10:00', isEnabled: true,
  title: '口コミのお願い', bodyText: '{{ペットの名前}}ちゃん、{{商品名}}はいかがでしたか。', buttonLabel: '感想を書く（30秒）', buttonUrl: null, imageUrl: null,
  dedupWindowDays: 30, excludeFormRespondents: false,
  afterActions: [
    { kind: 'open_form', formId: 'form-review', formName: '口コミ', buttonLabel: '感想を書く（30秒）' },
    { kind: 'award_mileage', amount: 200, trigger: 'form_submitted' },
  ],
  formIssue: null, updatedAt: '2026-08-25T10:00:00+09:00',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.value = 'owner'
  for (const fn of Object.values(calls)) fn.mockReset()
  calls.settings.mockResolvedValue({ success: true, data: [REVIEW] })
  calls.forms.mockResolvedValue({ success: true, data: [{ id: 'form-review', name: '口コミ', description: null, isActive: true }] })
  calls.overview.mockResolvedValue({ success: true, data: { jobs: { pendingByCampaign: { review_request: 0 } } } })
  calls.loginUsers.mockResolvedValue({ success: true, data: [{ id: 'f-1', staffName: 'Kenta', sameAccount: true }] })
  calls.updateSetting.mockResolvedValue({ success: true, data: { updatedAt: '2026-08-26T10:00:00+09:00' } })
  calls.tags.mockResolvedValue({ success: true, data: [{ id: 'tag-pet', name: 'ペット登録あり', lineAccountId: 'account-a' }] })
  calls.audience.mockResolvedValue({ success: true, data: { count: 1240 } })
  calls.createColumn.mockResolvedValue({ success: true, data: { id: 'c-new', queued: 0 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === name || b.getAttribute('aria-label') === name)

async function pick(label: string, option: string) {
  await act(async () => { fireEvent.click(button(label)!) })
  const item = [...document.querySelectorAll('[role="option"]')].find((node) => (node.textContent ?? '').trim() === option) as HTMLElement | undefined
  expect(item, `${label} に「${option}」がある`).toBeTruthy()
  await act(async () => { fireEvent.click(item!.querySelector('button') ?? item!) })
}

describe('V8 NEN配信「配信を直す」（w5pwG）', () => {
  it('V8 のテーマで節が並び、選んだ日数・時刻・マイルが保存に乗る', async () => {
    await act(async () => { root.render(<CampaignEdit campaignKey="review_request" />) })
    await flush()
    expect(document.documentElement.dataset.theme).toBe('v8')
    expect(host.querySelector('[data-design-node="w5pwG"]')).not.toBeNull()
    for (const heading of ['配信フロー', 'いつ送りますか', '送るもの', '押されたあとにすること']) expect(host.textContent).toContain(heading)
    expect(host.textContent).toContain('200 マイル')
    await pick('きっかけからの日数', '注文が届いた日から 14 日後')
    await pick('送る時刻', '19:00')
    await pick('回答後にマイルを付ける', '500 マイル')
    await act(async () => { fireEvent.click(button('配信内容を保存する')!) })
    await flush()
    expect(calls.updateSetting).toHaveBeenCalledWith('account-a', 'review_request', expect.objectContaining({
      delayDays: 14,
      deliveryTime: '19:00',
      afterActions: expect.arrayContaining([expect.objectContaining({ kind: 'award_mileage', amount: 500 })]),
      expectedUpdatedAt: REVIEW.updatedAt,
    }))
    expect(host.textContent).toContain('配信内容を保存しました')
  })

  it('閲覧のみの人には帯を出し、保存・テスト送信・押せない選ぶ欄を置かない', async () => {
    role.value = 'staff'
    await act(async () => { root.render(<CampaignEdit campaignKey="review_request" />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(button('配信内容を保存する')).toBeUndefined()
    expect(host.textContent).not.toContain('自分にテストを送る')
    expect([...document.querySelectorAll('button[disabled]')].map((b) => b.textContent)).toEqual([])
    expect(host.textContent).toContain('注文が届いた日から 10 日後')
  })
})

describe('V8 NEN配信「コラムを書く」（yRDwW）', () => {
  it('配信対象はタグを1つの欄で選び、保存に乗る', async () => {
    await act(async () => { root.render(<ColumnNew />) })
    await flush()
    expect(host.querySelector('[data-design-node="yRDwW"]')).not.toBeNull()
    for (const heading of ['題名と分類', '記事のリンク', '届く形', 'いつ・だれに出しますか', '読んだ人にすること']) expect(host.textContent).toContain(heading)
    const input = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
    await act(async () => { fireEvent.change(input('題名'), { target: { value: '秋の食事、量はどれくらい？' } }) })
    await act(async () => { fireEvent.change(input('記事の URL'), { target: { value: 'https://nen.example.jp/columns/autumn-food' } }) })
    await pick('配信対象', 'タグで絞る：ペット登録あり')
    await flush()
    expect(host.textContent).toContain('1,240人に届きます')
    await act(async () => { fireEvent.click(button('下書きを保存')!) })
    await flush()
    expect(calls.createColumn).toHaveBeenCalledWith('account-a', expect.objectContaining({ title: '秋の食事、量はどれくらい？', targetMode: 'tag', targetTagId: 'tag-pet' }))
    expect(calls.push).toHaveBeenCalledWith('/nen-campaigns?tab=columns')
  })

  it('題名と記事の URL が無いまま押すと、保存せずに理由を出す', async () => {
    await act(async () => { root.render(<ColumnNew />) })
    await flush()
    await act(async () => { fireEvent.click(button('下書きを保存')!) })
    await flush()
    expect(calls.createColumn).not.toHaveBeenCalled()
    expect(host.textContent).toContain('HTTPSの記事URLを入力してください。')
  })

  it('閲覧のみの人には書く欄も保存も置かず、帯と戻る道だけ出す', async () => {
    role.value = 'staff'
    await act(async () => { root.render(<ColumnNew />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(button('下書きを保存')).toBeUndefined()
    expect(host.querySelector('input[aria-label="題名"]')).toBeNull()
    expect([...document.querySelectorAll('button[disabled]')].map((b) => b.textContent)).toEqual([])
  })
})
