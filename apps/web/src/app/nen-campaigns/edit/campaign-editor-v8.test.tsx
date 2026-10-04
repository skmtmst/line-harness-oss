// @vitest-environment happy-dom
/*
 * ★V8-B 配信を直す（w5pwG）の骨格。
 * 取得・保存の決めごとは v7（campaign-editor）と同じ。節の並びと保存を見る。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => vi.fn())
const formsList = vi.hoisted(() => vi.fn())
const overview = vi.hoisted(() => vi.fn())
const loginUsers = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready', enabled: () => true, visible: () => true }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status?: number; code?: string },
  describeSaveFailure: () => '保存に失敗しました。',
  api: {
    nenCampaigns: { settings, overview },
    forms: { list: formsList },
    accountSettings: { getTestRecipientLoginUsers: loginUsers },
    /* 差し込み道具が載るため。無いと未処理の失敗が漏れる。 */
    friendFields: { list: async () => ({ success: true, data: [] }) },
    commonVars: { list: async () => ({ success: true, data: [] }) },
  },
}))

import CampaignEditorV8 from './campaign-editor-v8'

const setting = {
  campaignKey: 'review_request',
  label: '口コミのお願い',
  category: 'follow_up',
  triggerEvent: 'ec.order.delivered',
  delayDays: 10,
  deliveryTime: '10:00:00',
  isEnabled: true,
  title: '口コミ',
  bodyText: '{名前}さん、感想を教えてください。',
  buttonLabel: '口コミを書く',
  buttonUrl: null,
  imageUrl: null,
  dedupWindowDays: 30,
  excludeFormRespondents: false,
  afterActions: [],
  formIssue: null,
  updatedAt: 'v1',
}

afterEach(cleanup)

/* happy-dom には localStorage が無い。InsertToolbar の表示判定が裸で読むので当てる。 */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

describe('配信を直す V8', () => {
  it('w5pwG の印で節と保存を出す', async () => {
    vi.stubGlobal('localStorage', fakeStorage())
    settings.mockResolvedValue({ success: true, data: [setting] })
    formsList.mockResolvedValue({ success: true, data: [] })
    overview.mockResolvedValue({ success: true, data: { jobs: { pendingByCampaign: {} } } })
    loginUsers.mockResolvedValue({ success: true, data: [] })
    const { container } = render(<CampaignEditorV8 campaignKey="review_request" />)
    expect(await screen.findByText('配信フロー')).toBeTruthy()
    expect(container.querySelector('[data-design-node="w5pwG"]')).toBeTruthy()
    for (const title of ['いつ送りますか', '送るもの', '押されたあとにすること']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
    expect(screen.getByText('高橋 直人さん（ももちゃん）にはこう届きます')).toBeTruthy()
    expect(screen.getByRole('button', { name: '配信内容を保存する' })).toBeTruthy()
  })
})
