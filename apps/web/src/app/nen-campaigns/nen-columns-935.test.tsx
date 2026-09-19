// @vitest-environment happy-dom
/*
 * #935: コラム一覧の打切り・過去の予約日時・確認文の実態一致を、
 * 本物の React で描画して確かめる。
 *
 * 見る筋書き:
 *   N-300: 口が200件で打ち切った分を「全部で◯本」と画面に出す。
 *   N-303: 「今すぐ」と「予約」で確認の見出しを分ける（実害は無いが文言がずれていた）。
 *   N-304: 過去の予約日時は画面で止め、送る操作を呼ばない。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenCampaignSetting, NenColumn } from '../../lib/api'
import { NenOverview, type ColumnDeliveryPlan, type NenTab } from './nen-overview'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const noop = () => {}

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

function renderColumns(input: {
  columns?: NenColumn[]
  columnsTotal?: number | null
  selectedColumnId?: string | null
  plan?: ColumnDeliveryPlan
  onDeliverColumn?: (column: NenColumn, scheduledAt?: string) => void
  onSelectColumn?: (id: string | null) => void
  introDraft?: string
}) {
  act(() => {
    root.render(
      <NenOverview
        tab={'columns' as NenTab}
        topAction={null}
        onTabChange={noop}
        settings={[columnSetting()]}
        columns={input.columns ?? []}
        columnsTotal={input.columnsTotal ?? null}
        kpis={null}
        flowMetrics={null}
        columnMetrics={null}
        deliveryList={null}
        deliveryDetail={null}
        friends={[]}
        testFriendId=""
        onTestFriendChange={noop}
        accountId={null}
        loading={false}
        notice={null}
        saving={null}
        testing={null}
        previewCampaignKey={null}
        onPreviewCampaign={noop}
        onToggleSetting={noop}
        onTestSend={noop}
        coupon={{ isEnabled: false, codePrefix: '', benefitLabel: '', discountAmount: 0, validityDays: 0, leapYearPolicy: 'feb28' }}
        couponOpen={false}
        onCouponOpenChange={noop}
        onCouponChange={noop}
        onSaveCoupon={noop}
        savingCoupon={false}
        selectedColumnId={input.selectedColumnId ?? null}
        onSelectColumn={input.onSelectColumn ?? noop}
        audienceCount={12}
        plan={input.plan ?? { when: 'now', scheduledAt: '' }}
        onPlanChange={noop}
        introDraft={input.introDraft ?? '紹介文c1'}
        onIntroChange={noop}
        onSaveIntro={noop}
        savingColumnId={null}
        onDeliverColumn={input.onDeliverColumn ?? noop}
        onDuplicateColumn={noop}
        onTestColumn={noop}
        onShowDelivery={noop}
        onRetryDelivery={noop}
        onChangeDeliveryView={noop}
      />,
    )
  })
}

const primaryButton = (label: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!found) throw new Error(`ボタン「${label}」が見つかりません`)
  return found as HTMLButtonElement
}

const click = (element: HTMLElement) => act(() => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('コラム一覧の打切りの可視化（#935 N-300）', () => {
  it('口の上限で打ち切られたとき、全体件数と「新しい◯本まで」を出す', () => {
    renderColumns({ columns: [column('c1'), column('c2')], columnsTotal: 250 })
    expect(container.textContent).toContain('コラムは全部で250本あります')
    expect(container.textContent).toContain('新しい2本までを表示しています')
    expect(container.textContent).toContain('2本（全体 250本）')
  })

  it('打ち切りが無ければ全体件数の注意を出さない', () => {
    renderColumns({ columns: [column('c1'), column('c2')], columnsTotal: 2 })
    expect(container.textContent).not.toContain('全部で')
    expect(container.textContent).toContain('2本')
  })
})

/* ConfirmDialog は document.body へ portal される。確認文は body 側で読む。 */
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (label: string): HTMLButtonElement => {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === label)
  if (!found) throw new Error(`ボタン「${label}」が見つかりません`)
  return found as HTMLButtonElement
}

describe('配信確認の文言と実態の一致（#935 N-303）', () => {
  it('「今すぐ」は「今すぐ配信しますか」と確認する', () => {
    renderColumns({ columns: [column('c1')], selectedColumnId: 'c1', plan: { when: 'now', scheduledAt: '' } })
    click(primaryButton('この内容で送る'))
    expect(bodyText()).toContain('「題名c1」を今すぐ配信しますか？')
    expect(bodyText()).not.toContain('配信予約しますか？')
  })

  it('「日時を予約」は「配信予約しますか」と確認し、確定で日本時間の予約日時を渡す', () => {
    const onDeliver = vi.fn()
    renderColumns({
      columns: [column('c1')],
      selectedColumnId: 'c1',
      plan: { when: 'schedule', scheduledAt: '2099-05-01T10:30' },
      onDeliverColumn: onDeliver,
    })
    click(primaryButton('この内容で予約する'))
    expect(bodyText()).toContain('「題名c1」を配信予約しますか？')
    click(bodyButton('予約する'))
    expect(onDeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), '2099-05-01T10:30:00+09:00')
  })
})

describe('過去の予約日時を画面で止める（#935 N-304）', () => {
  it('過去の日時は「いまより先を選ぶ」と出し、予約ボタンを押せない', () => {
    const onDeliver = vi.fn()
    renderColumns({
      columns: [column('c1')],
      selectedColumnId: 'c1',
      plan: { when: 'schedule', scheduledAt: '2000-01-01T00:00' },
      onDeliverColumn: onDeliver,
    })
    expect(container.textContent).toContain('予約日時が過去になっています。いまより先の日時を選んでください。')
    expect(container.textContent).toContain('の予約日時はいまより先を選んでください')
    const button = primaryButton('この内容で予約する')
    expect(button.disabled).toBe(true)
    click(button)
    expect(onDeliver).not.toHaveBeenCalled()
  })

  it('日時が未入力なら「入れてください」のまま', () => {
    renderColumns({
      columns: [column('c1')],
      selectedColumnId: 'c1',
      plan: { when: 'schedule', scheduledAt: '' },
    })
    expect(container.textContent).toContain('の予約日時を入れてください')
    expect(container.textContent).not.toContain('いまより先の日時')
  })
})
