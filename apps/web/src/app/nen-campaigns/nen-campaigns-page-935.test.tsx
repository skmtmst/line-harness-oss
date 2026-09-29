// @vitest-environment happy-dom
/*
 * #935 N-301: コラムの紹介文を書きかけのまま離れると消えていた。
 * 本物のページを React で mount し、次を操作で確かめる。
 *
 *   1. 紹介文を変えたあと別のコラムを選ぶと、確認が出て移らない。
 *      「保存せずに移る」を押すと移る。
 *   2. 画面内リンク（コラムを書く）を押すと、確認のあと移動する。
 *   3. ブラウザを閉じる操作（beforeunload）は書きかけの間だけ止める。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenCampaignSetting, NenColumn } from '../../lib/api'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
const network = vi.hoisted(() => ({
  columns: vi.fn(),
  settings: vi.fn(),
  flowMetrics: vi.fn(),
  columnMetrics: vi.fn(),
  deliveries: vi.fn(),
  birthdayCoupon: vi.fn(),
  columnAudience: vi.fn(),
  updateColumnMessage: vi.fn(),
  testRecipients: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/nen-campaigns',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenCampaigns: {
        ...actual.api.nenCampaigns,
        settings: network.settings,
        columns: network.columns,
        flowMetrics: network.flowMetrics,
        columnMetrics: network.columnMetrics,
        deliveries: network.deliveries,
        birthdayCoupon: network.birthdayCoupon,
        columnAudience: network.columnAudience,
        updateColumnMessage: network.updateColumnMessage,
      },
      accountSettings: {
        ...actual.api.accountSettings,
        getTestRecipients: network.testRecipients,
      },
    },
  }
})

const { default: NenCampaignsPage } = await import('./page')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const columnSetting = (): NenCampaignSetting => ({
  campaignKey: 'column',
  label: 'NENコラム',
  category: 'column',
  triggerEvent: null,
  delayDays: 0,
  deliveryTime: '10:00',
  isEnabled: true,
  title: 'コラム',
  bodyText: '本文',
  buttonLabel: 'コラムを読む',
  buttonUrl: null,
  imageUrl: null,
  dedupWindowDays: 0,
  excludeFormRespondents: false,
  afterActions: [],
})

const column = (id: string, over: Partial<NenColumn> = {}): NenColumn => ({
  id,
  externalId: null,
  slug: `slug-${id}`,
  title: `題名${id}`,
  category: '食事',
  excerpt: '概要',
  introText: `紹介文${id}`,
  articleUrl: 'https://example.com/a',
  imageUrl: null,
  publishedAt: '2026-08-01T00:00:00Z',
  deliveryStatus: 'draft',
  deliveryAt: null,
  lineAccountId: 'account-a',
  updatedAt: '2026-08-01T00:00:00Z',
  targetMode: 'all',
  targetTagId: null,
  completionEventName: null,
  completionTagId: null,
  sourceColumnId: null,
  ...over,
})

let container: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(NenCampaignsPage))
  })
  await settle()
}

async function click(element: HTMLElement) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await settle()
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!found) throw new Error(`ボタン「${label}」が見つかりません: ${container.textContent?.slice(0, 200)}`)
  return found as HTMLButtonElement
}

/* ConfirmDialog は document.body へ portal される。確認文・その中のボタンは body 側で読む。 */
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (label: string): HTMLButtonElement => {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!found) throw new Error(`ボタン「${label}」が見つかりません`)
  return found as HTMLButtonElement
}

function introTextarea(): HTMLTextAreaElement {
  const found = container.querySelector('aside textarea')
  if (!found) throw new Error('紹介文の入力欄が見つかりません')
  return found as HTMLTextAreaElement
}

async function typeIntro(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(introTextarea(), value)
    introTextarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 一覧の「コラム」タブを開き、最初のコラムを選ぶ。 */
async function openColumn() {
  // タブは件数を内側に持つ（「コラム2」）。見出しで始まるボタンを拾う。
  const tab = Array.from(container.querySelectorAll('button'))
    .find((b) => /^コラム\d*$/.test(b.textContent ?? ''))
  if (!tab) throw new Error('コラムのタブが見つかりません')
  await click(tab)
  await click(button('選ぶ'))
}

beforeEach(() => {
  vi.clearAllMocks()
  network.settings.mockResolvedValue({ success: true, data: [columnSetting()] })
  network.columns.mockResolvedValue({
    success: true,
    data: [column('c1'), column('c2')],
    pagination: { total: 2, limit: 200, offset: 0 },
  })
  network.flowMetrics.mockResolvedValue({ success: true, data: { summary: { associatedConversions: 0, associatedConversionAmount: 0 }, flows: [] } })
  network.columnMetrics.mockResolvedValue({ success: true, data: { columns: [] } })
  network.deliveries.mockResolvedValue({
    success: true,
    data: {
      range: { days: 30, from: '2026-08-01', to: '2026-09-01' },
      summary: { pending: 0, processing: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0, retryRequired: 0, unmetReasons: {}, skippedReasons: {} },
      deliveries: [],
      pagination: { total: 0, limit: 20, cursor: '0', nextCursor: null },
    },
  })
  network.birthdayCoupon.mockResolvedValue({ success: true, data: { isEnabled: false, codePrefix: '', benefitLabel: '', discountAmount: 0, validityDays: 0, leapYearPolicy: 'feb28', updatedAt: '' } })
  network.columnAudience.mockResolvedValue({ success: true, data: { count: 5, targetMode: 'all', targetTagId: null } })
  network.updateColumnMessage.mockResolvedValue({ success: true })
  network.testRecipients.mockResolvedValue({ success: true, data: [] })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container.remove()
})

describe('紹介文の書きかけを守る（#935 N-301）', () => {
  it('書きかけのまま別のコラムを選ぶと確認し、やめるなら選び直さない', async () => {
    await mount()
    await openColumn()
    await typeIntro('書きかけの紹介文')

    await click(button('選ぶ'))

    expect(bodyText()).toContain('入力した紹介文が保存されていません')
    // まだ c1 が選ばれたまま（c2 へ移っていない）。
    expect(container.textContent).toContain('「題名c1」')
    expect(introTextarea().value).toBe('書きかけの紹介文')

    // 「書き続ける」で入力に残る。
    await click(bodyButton('書き続ける'))
    expect(introTextarea().value).toBe('書きかけの紹介文')
  })

  it('「保存せずに移る」で別のコラムへ移り、紹介文はそのコラムのものになる', async () => {
    await mount()
    await openColumn()
    await typeIntro('書きかけの紹介文')

    await click(button('選ぶ'))
    await click(bodyButton('保存せずに移る'))

    expect(introTextarea().value).toBe('紹介文c2')
  })

  it('書きかけのまま画面内リンクを押すと確認し、確認後に移動する', async () => {
    await mount()
    await openColumn()
    await typeIntro('書きかけの紹介文')

    const link = Array.from(container.querySelectorAll('a[href]'))
      .find((a) => a.getAttribute('href') === '/nen-campaigns/columns/new')
    expect(link).toBeDefined()
    await click(link!)

    expect(bodyText()).toContain('このまま移動すると、入力した紹介文は保存されません')
    expect(navigation.push).not.toHaveBeenCalled()

    await click(bodyButton('保存せずに移動'))
    expect(navigation.push).toHaveBeenCalledWith('/nen-campaigns/columns/new')
  })

  it('ブラウザを閉じる操作は書きかけの間だけ止める', async () => {
    await mount()
    await openColumn()

    // 書きかけが無い間は止めない。
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await typeIntro('書きかけの紹介文')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
