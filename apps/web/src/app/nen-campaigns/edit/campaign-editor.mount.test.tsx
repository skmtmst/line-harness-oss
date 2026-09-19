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

  it('差し込み展開後に長すぎる恐れがある入力では、実際に注意文が出る（#659: 到達不能だった注意文の修正）', async () => {
    // {{pet_name}} を並べただけの本文。差し込み前は上限に収まる（保存も
    // できる）が、既定のペット名見本（サーバ側の実際の上限いっぱい）で
    // 展開すると明確に超える。以前は既定の見本が置換元より短い固定文言
    // だったため、この注意文は画面上で一度も出せなかった。
    await mount()
    await setBody('{{pet_name}}'.repeat(300))

    expect(saveButton().disabled).toBe(false)
    expect(container.textContent).toContain('差し込む名前が長いと、送るときに長すぎる場合があります。')
  })
})

describe('文言と実態の一致・書きかけの保護（実mount・#935）', () => {
  it('N-299: 配信待ちの実数と、スナップショットの実態を言う', async () => {
    overviewApi.mockResolvedValue({
      success: true,
      data: {
        activeCampaigns: 1,
        jobs: { total: 7, pending: 7, sent: 0, failed: 0, pendingByCampaign: { [CAMPAIGN_KEY]: 7 } },
        columns: 0, pets: 0, coupons: 0,
      },
    })
    await mount()

    expect(container.textContent).toContain('配信待ちの7通は予約したときの中身のまま届きます')
    expect(container.textContent).not.toContain('42通')
  })

  it('N-301: 書きかけで画面内リンクを押すと確認し、確認後に移動する', async () => {
    await mount()
    await setBody('書きかけの本文')

    const link = Array.from(container.querySelectorAll('a[href]'))
      .find((a) => a.getAttribute('href') === '/nen-campaigns?tab=auto')
    expect(link).toBeDefined()
    await click(link!)

    // 確認対話は document.body へ portal される。
    expect(document.body.textContent).toContain('入力中の内容があります')
    expect(navigation.push).not.toHaveBeenCalled()

    const leave = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent === '保存せずに移動')
    await click(leave!)
    expect(navigation.push).toHaveBeenCalledWith('/nen-campaigns?tab=auto')
  })

  it('N-301: 書きかけでブラウザを閉じる操作を止め、保存後は止めない', async () => {
    await mount()
    await setBody('書きかけの本文')

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)

    await click(saveButton())
    await settle()
    const afterSave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterSave)
    expect(afterSave.defaultPrevented).toBe(false)
  })
})
