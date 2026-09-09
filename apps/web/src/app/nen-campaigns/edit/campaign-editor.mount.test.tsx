// @vitest-environment happy-dom
/*
 * NEN配信本文編集画面を本物の React で mount し、採用上限
 * `NEN_CAMPAIGN_BODY_MAX_LENGTH`（4500字）の超過を確かめる（Issue #659）。
 *
 * `campaign-editor-contract.test.ts` はソース文字列を見るだけの契約試験で、
 * 上限判定そのものを外しても気づけない。ここは本物の textarea に本物の
 * 入力イベントを配り、本物のReactの描き直しの結果（警告文・保存ボタンの
 * disabled・保存APIが呼ばれるかどうか）を見る。
 *
 * 見張る筋書き:
 *   1. 4500字ちょうどは警告が出ず、保存できる。
 *   2. 4501字（1字超え）は送信前に警告が出て、保存ボタンが無効になり、
 *      保存APIが呼ばれない。超過した入力内容も消えない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared'

const lineAccountsListApi = vi.hoisted(() => vi.fn())
const settingsApi = vi.hoisted(() => vi.fn())
const updateSettingApi = vi.hoisted(() => vi.fn())
const formsListApi = vi.hoisted(() => vi.fn())
const testRecipientLoginUsersApi = vi.hoisted(() => vi.fn())
const friendFieldsListApi = vi.hoisted(() => vi.fn())
const commonVarsListApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: lineAccountsListApi },
      nenCampaigns: { ...actual.api.nenCampaigns, settings: settingsApi, updateSetting: updateSettingApi },
      forms: { ...actual.api.forms, list: formsListApi },
      accountSettings: { ...actual.api.accountSettings, getTestRecipientLoginUsers: testRecipientLoginUsersApi },
      // InsertToolbar（差し込みツールバー）が読む。ここでは差し込みの中身は
      // 見ないので空でよいが、モックしないと実ネットワークへ fetch してしまう。
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

function bodyTextarea(): HTMLTextAreaElement {
  const found = Array.from(container.querySelectorAll('textarea')).find(
    (element) => element.getAttribute('aria-label') === '配信本文',
  )
  if (!found) throw new Error('配信本文の入力欄が見つかりません')
  return found as HTMLTextAreaElement
}

function saveButton(): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent === '配信内容を保存',
  )
  if (!found) throw new Error('保存ボタンが見つかりません')
  return found as HTMLButtonElement
}

async function setBody(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(bodyTextarea(), value)
    bodyTextarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

/*
 * この happy-dom 環境は `window.localStorage` を持たない（未設定だと
 * undefined のまま）。画面側（account-context.tsx）は裸の `localStorage`
 * を直接読み書きするので、最小限のメモリ実装を裸のグローバルへ当てる。
 */
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

describe('NEN配信本文の上限4500字（実mount・Issue #659）', () => {
  it('4500字ちょうどは警告が出ず、保存できる', async () => {
    await mount()
    await setBody('あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH))

    expect(container.textContent).not.toContain('字を超えています')
    expect(saveButton().disabled).toBe(false)

    await click(saveButton())
    await settle()

    expect(updateSettingApi).toHaveBeenCalledTimes(1)
    expect(updateSettingApi.mock.calls[0][2].bodyText).toHaveLength(NEN_CAMPAIGN_BODY_MAX_LENGTH)
  })

  it('4501字（1字超え）は送信前に警告し、保存ボタンを無効化し、保存APIを呼ばない', async () => {
    await mount()
    await setBody('あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH + 1))

    const limitLabel = NEN_CAMPAIGN_BODY_MAX_LENGTH.toLocaleString('ja-JP')
    expect(container.textContent).toContain(`${limitLabel}字を超えています`)
    expect(saveButton().disabled).toBe(true)

    // ボタンが無効でもクリックを配ってみて、保存が起きないところまで見る
    // （save() 自身も bodyCheck.fits を見て打ち切る、二重の守りになっている）。
    await click(saveButton())
    await settle()

    expect(updateSettingApi).not.toHaveBeenCalled()
  })

  it('超過した入力内容は切り詰められずそのまま残る（maxLength を付けていない）', async () => {
    await mount()
    const overLong = 'あ'.repeat(NEN_CAMPAIGN_BODY_MAX_LENGTH + 50)
    await setBody(overLong)

    expect(bodyTextarea().value).toBe(overLong)
    expect(bodyTextarea().hasAttribute('maxlength')).toBe(false)
  })
})
