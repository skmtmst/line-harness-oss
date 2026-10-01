// @vitest-environment happy-dom
/*
 * M507フォロー：配信保存500の案内（保存catch → describeSaveFailure → 帯）。
 * root実GUIで exact合成PUT500 が「API error: 500」とだけ出た残り。
 * 409 VERSION_CONFLICT の日本語先行保存案内・本文保持・最新版取り込み・
 * 再試行・テスト送信境界（M507既存の動き）は触らない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const lineAccountsListApi = vi.hoisted(() => vi.fn())
const settingsApi = vi.hoisted(() => vi.fn())
const updateSettingApi = vi.hoisted(() => vi.fn())
const overviewApi = vi.hoisted(() => vi.fn())
const formsListApi = vi.hoisted(() => vi.fn())
const testRecipientLoginUsersApi = vi.hoisted(() => vi.fn())
const friendFieldsListApi = vi.hoisted(() => vi.fn())
const commonVarsListApi = vi.hoisted(() => vi.fn())
const navigation = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: lineAccountsListApi },
      nenCampaigns: { ...actual.api.nenCampaigns, settings: settingsApi, updateSetting: updateSettingApi, overview: overviewApi },
      forms: { ...actual.api.forms, list: formsListApi },
      accountSettings: { ...actual.api.accountSettings, getTestRecipientLoginUsers: testRecipientLoginUsersApi },
      friendFields: { ...actual.api.friendFields, list: friendFieldsListApi },
      commonVars: { ...actual.api.commonVars, list: commonVarsListApi },
    },
  }
})

const { AccountProvider } = await import('@/contexts/account-context')
const { default: CampaignEditor } = await import('./campaign-editor')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = 'account-nen'
const CAMPAIGN_KEY = 'order_confirmed'

function baseSetting() {
  return {
    campaignKey: CAMPAIGN_KEY,
    label: '注文お礼',
    category: 'transactional' as const,
    triggerEvent: 'ec.order.confirmed',
    delayDays: 0,
    deliveryTime: '10:00:00',
    isEnabled: true,
    title: 'ご注文ありがとうございます',
    bodyText: 'いつもご利用ありがとうございます。',
    buttonLabel: null,
    buttonUrl: null,
    imageUrl: null,
    afterActions: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

let container: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount() {
  localStorage.setItem('lh_selected_account', ACCOUNT_ID)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(AccountProvider, null, React.createElement(CampaignEditor, { campaignKey: CAMPAIGN_KEY })),
    )
  })
  await settle()
}

function saveButton(): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent === '配信内容を保存する',
  )
  if (!found) throw new Error('保存ボタンが見つかりません')
  return found as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', fakeStorage())
  lineAccountsListApi.mockResolvedValue({
    success: true,
    data: [{ id: ACCOUNT_ID, channelId: 'ch-1', name: 'テスト店', isActive: true, country: 'JP', role: 'owner', displayOrder: 0 }],
  })
  settingsApi.mockResolvedValue({ success: true, data: [baseSetting()] })
  overviewApi.mockResolvedValue({
    success: true,
    data: {
      activeCampaigns: 1,
      jobs: { total: 0, pending: 0, sent: 0, failed: 0, pendingByCampaign: {} },
      columns: 0, pets: 0, coupons: 0,
    },
  })
  formsListApi.mockResolvedValue({ success: true, data: [] })
  testRecipientLoginUsersApi.mockResolvedValue({ success: true, data: [] })
  updateSettingApi.mockResolvedValue({ success: true })
  friendFieldsListApi.mockResolvedValue({ success: true, data: [] })
  commonVarsListApi.mockResolvedValue({ success: true, data: [] })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('M507フォロー 保存500の案内', () => {
  it('PUT500（本文なし）は運用者向け日本語を出し、生の API error:500 を出さない', async () => {
    updateSettingApi.mockRejectedValueOnce(new ApiError(500))
    await mount()
    await click(saveButton())
    await settle()
    await settle()

    expect(container.textContent).toContain('サーバー側で保存できませんでした')
    expect(container.textContent).not.toContain('API error:')
  })

  it('409 VERSION_CONFLICT は既存の日本語先行保存案内のまま（M507保持）', async () => {
    updateSettingApi.mockRejectedValueOnce(new ApiError(409, undefined, 'VERSION_CONFLICT'))
    await mount()
    await click(saveButton())
    await settle()
    await settle()

    expect(container.textContent).toContain('ほかの人が先に保存しました')
    expect(container.textContent).not.toContain('API error:')
  })
})
