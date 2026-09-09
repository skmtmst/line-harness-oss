/*
 * #678 N-337/N-338/N-340/N-341 の実挙動。
 *
 * ここでは React の hook を差し替えない。実物の React で描き、
 * 実物の Promise を遅らせて逆順に返す。画面の中の呼び出し口を
 * そのまま呼ぶので、実APIと同じ非同期境界で保存・公開・
 * アカウント切替が確かめられる。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  selectedAccountId: 'account-a' as string | null,
  activeTab: 'customer',
  routerReplace: vi.fn(),
  operatorList: vi.fn(),
  settings: vi.fn(),
  overview: vi.fn(),
  updateSetting: vi.fn(),
  testSend: vi.fn(),
  definitions: vi.fn(),
  metrics: vi.fn(),
  updateDraft: vi.fn(),
  publishDefinition: vi.fn(),
  stopDefinition: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: fixture.routerReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.selectedAccountId }),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: ({ tabs }: { tabs: Array<{ key: string; label: string }> }) =>
    <nav aria-label="LINE通知のタブ">{tabs.map((tab) => <span key={tab.key}>{tab.label}</span>)}</nav>,
  useMergedTab: () => fixture.activeTab,
}))

vi.mock('@/components/line-notifications/notification-run-list', () => ({
  default: () => <section>送信記録</section>,
}))

vi.mock('./operator-notification-rules', () => ({
  default: () => <section>運用者へのお知らせ設定</section>,
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`API error ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      notifications: { operatorRules: { list: fixture.operatorList } },
      ecCommerce: {
        settings: fixture.settings,
        overview: fixture.overview,
        updateSetting: fixture.updateSetting,
        testSend: fixture.testSend,
      },
      lineNotifications: {
        definitions: fixture.definitions,
        metrics: fixture.metrics,
        updateDraft: fixture.updateDraft,
        publishDefinition: fixture.publishDefinition,
        stopDefinition: fixture.stopDefinition,
      },
    },
  }
})

import { type EcNotificationSetting, type LineNotificationDefinition } from '@/lib/api'
import LineNotificationsPage from './page'

const {
  CustomerNotificationEditor,
  clearCustomerDraft,
  customerDraftKey,
  isSameCustomerDraft,
  operatorTabCountLabel,
  pickCustomerDraft,
  publishCustomerNotification,
  readCustomerDraft,
  saveCustomerNotification,
  sortCustomerSettingsBySentCount,
  writeCustomerDraft,
} = LineNotificationsPage.__testing

type MutationApi = Parameters<typeof saveCustomerNotification>[0]['api']

/** 呼び出し側が握る Promise。実APIと同じく、返る順番を試験で決める。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const setting = (overrides: Partial<EcNotificationSetting> = {}): EcNotificationSetting => ({
  eventType: 'order.confirmed',
  label: '注文受付',
  isEnabled: true,
  title: '注文を受け付けました',
  introText: 'ご注文ありがとうございます。',
  outroText: 'ご不明な点はお問い合わせください。',
  category: 'order',
  buttonLabel: '注文を見る',
  buttonUrl: '',
  imageUrl: '',
  displayOrder: 0,
  fixedFields: ['注文番号', '商品名'],
  fixedPreview: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const definition = (overrides: Partial<LineNotificationDefinition> = {}): LineNotificationDefinition => ({
  id: 'definition-a',
  lineAccountId: 'account-a',
  name: '注文受付',
  category: 'order',
  sourceEventType: 'order.confirmed',
  status: 'published',
  version: 4,
  currentVersionNumber: 3,
  draft: { title: '古い見出し', introText: '古い本文' },
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
} as LineNotificationDefinition)

function mutationApi(overrides: Partial<MutationApi> = {}): MutationApi {
  return {
    updateDraft: fixture.updateDraft,
    publishDefinition: fixture.publishDefinition,
    stopDefinition: fixture.stopDefinition,
    updateSetting: fixture.updateSetting,
    ...overrides,
  } as MutationApi
}

const storage = new MemoryStorage()

beforeEach(() => {
  vi.clearAllMocks()
  storage.clear()
  fixture.selectedAccountId = 'account-a'
  fixture.activeTab = 'customer'
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 7 } } })
  fixture.settings.mockResolvedValue({ success: true, data: [] })
  fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
  fixture.definitions.mockResolvedValue({ success: true, data: [] })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.updateSetting.mockResolvedValue({ success: true, data: {} })
  fixture.testSend.mockResolvedValue({ success: true, data: { sent: 1 } })
  // vitest は esbuild の既定で古い JSX 変換になる。画面側は React を import
  // しない書き方なので、実物の React を大域に置いて実描画させる。
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('#678 公開は編集中の内容を先に保存する', () => {
  it('未保存の編集を公開すると、その内容で下書きを保存し、保存が返した版番号で公開する', async () => {
    const edited = setting({ title: '新しい見出し', introText: '新しい本文' })
    const base = definition({ version: 4 })
    const savedDefinition = definition({ version: 5, draft: { title: '新しい見出し', introText: '新しい本文' } })
    fixture.updateDraft.mockResolvedValue({ success: true, data: savedDefinition })
    fixture.publishDefinition.mockResolvedValue({ success: true, data: { ...savedDefinition, status: 'published' } })

    const outcome = await publishCustomerNotification({
      api: mutationApi(),
      setting: edited,
      definition: base,
      generation: 1,
      currentGeneration: () => 1,
    })

    expect(fixture.updateDraft).toHaveBeenCalledTimes(1)
    expect(fixture.updateDraft.mock.calls[0][1]).toMatchObject({
      lineAccountId: 'account-a',
      expectedVersion: 4,
      draft: { title: '新しい見出し', introText: '新しい本文' },
    })
    // 公開は「保存が返した版」。保存前の版で公開すると古い内容が出る。
    expect(fixture.publishDefinition).toHaveBeenCalledWith('definition-a', {
      lineAccountId: 'account-a',
      expectedVersion: 5,
    })
    expect(fixture.updateDraft.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.publishDefinition.mock.invocationCallOrder[0])
    expect(outcome).toMatchObject({ kind: 'applied', tone: 'success', enabled: true, clearStoredDraft: true })
  })

  it('下書きの保存に失敗したら公開せず、端末の控えも消さない', async () => {
    const saveFailure = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(saveFailure.promise)

    const running = publishCustomerNotification({
      api: mutationApi(),
      setting: setting({ title: '消えては困る見出し' }),
      definition: definition(),
      generation: 1,
      currentGeneration: () => 1,
    })
    saveFailure.reject(new Error('network down'))
    const outcome = await running

    expect(fixture.publishDefinition).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: 'failed', clearStoredDraft: false })
    expect(outcome.kind === 'failed' ? outcome.message : '').toContain('公開していません')
  })

  it('公開だけ失敗したときは、下書きは保存済みとして扱い、内容を失わない', async () => {
    const savedDefinition = definition({ version: 5 })
    fixture.updateDraft.mockResolvedValue({ success: true, data: savedDefinition })
    fixture.publishDefinition.mockResolvedValue({ success: false })

    const outcome = await publishCustomerNotification({
      api: mutationApi(),
      setting: setting({ title: '新しい見出し' }),
      definition: definition(),
      generation: 1,
      currentGeneration: () => 1,
    })

    expect(outcome).toMatchObject({ kind: 'applied', tone: 'error', clearStoredDraft: true })
    expect(outcome.kind === 'applied' ? outcome.definition?.version : null).toBe(5)
    expect(outcome.kind === 'applied' ? outcome.message : '').toContain('下書きとして保存済み')
  })
})

describe('#678 アカウント切替をまたいだ応答を画面へ書かない', () => {
  it('アカウントAの保存が、Bへ切り替えた後に返っても stale になる', async () => {
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)
    const generation = { current: 1 }

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: setting(),
      definition: definition(),
      enabled: true,
      generation: generation.current,
      currentGeneration: () => generation.current,
    })

    // 応答が返る前に別アカウントを選ぶ。画面は読み直しへ入る。
    generation.current = 2
    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    expect(outcome).toEqual({ kind: 'stale', clearStoredDraft: true })
    expect(outcome.kind).not.toBe('applied')
  })

  it('遅いアカウントAの公開応答が、先に返ったBの結果を上書きしない', async () => {
    const slowA = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    const fastB = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    const generation = { current: 1 }
    const apiA = mutationApi({
      updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ version: 5 }) }),
      publishDefinition: vi.fn().mockReturnValue(slowA.promise),
    } as Partial<MutationApi>)
    const apiB = mutationApi({
      updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 9 }) }),
      publishDefinition: vi.fn().mockReturnValue(fastB.promise),
    } as Partial<MutationApi>)

    const runningA = publishCustomerNotification({
      api: apiA,
      setting: setting({ title: 'Aの見出し' }),
      definition: definition(),
      generation: 1,
      currentGeneration: () => generation.current,
    })
    generation.current = 2
    const runningB = publishCustomerNotification({
      api: apiB,
      setting: setting({ title: 'Bの見出し' }),
      definition: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 9 }),
      generation: 2,
      currentGeneration: () => generation.current,
    })

    fastB.resolve({ success: true, data: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 10 }) })
    const outcomeB = await runningB
    expect(outcomeB).toMatchObject({ kind: 'applied' })
    expect(outcomeB.kind === 'applied' ? outcomeB.definition?.lineAccountId : null).toBe('account-b')

    slowA.resolve({ success: true, data: definition({ version: 6 }) })
    const outcomeA = await runningA
    expect(outcomeA).toEqual({ kind: 'stale', clearStoredDraft: true })
  })

  it('保存が失敗して返っても、切替後なら別アカウントの画面へ誤りを出さない', async () => {
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)
    const generation = { current: 1 }

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: setting(),
      definition: definition(),
      enabled: true,
      generation: 1,
      currentGeneration: () => generation.current,
    })
    generation.current = 2
    slowSave.reject(new Error('network down'))

    await expect(running).resolves.toEqual({ kind: 'stale', clearStoredDraft: false })
  })

  it('保存が成功して切替後に返ったときは、そのアカウントの控えだけ消してよいと返す', async () => {
    const outcome = await saveCustomerNotification({
      api: mutationApi({ updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ version: 5 }) }) } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: setting(),
      definition: definition(),
      enabled: true,
      generation: 1,
      currentGeneration: () => 2,
    })
    expect(outcome).toEqual({ kind: 'stale', clearStoredDraft: true })
  })
})

describe('#678 出す・止めるの切替は編集中の文面を巻き込まない', () => {
  it('切替では文面を送らないので、端末に残した編集の控えを消さないと返す', async () => {
    const stopDefinition = vi.fn().mockResolvedValue({ success: true, data: definition({ status: 'stopped', version: 5 }) })
    const outcome = await saveCustomerNotification({
      api: mutationApi({ stopDefinition } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: setting({ isEnabled: true }),
      definition: definition(),
      enabled: false,
      generation: 1,
      currentGeneration: () => 1,
    })
    expect(stopDefinition).toHaveBeenCalledWith('definition-a', { lineAccountId: 'account-a', expectedVersion: 4 })
    expect(fixture.updateDraft).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: 'applied', enabled: false, clearStoredDraft: false })
  })

  it('文面の保存では控えを消してよいと返す', async () => {
    const outcome = await saveCustomerNotification({
      api: mutationApi({ updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ version: 5 }) }) } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: setting(),
      definition: definition(),
      enabled: true,
      generation: 1,
      currentGeneration: () => 1,
    })
    expect(outcome).toMatchObject({ kind: 'applied', clearStoredDraft: true })
  })
})

describe('#678 端末に残す下書きはアカウントごとに分ける', () => {
  it('鍵にアカウントが入り、別アカウントの下書きを読み込まない', () => {
    const draft = pickCustomerDraft(setting({ title: '長い見出し'.repeat(10), introText: '長い本文'.repeat(200) }))
    writeCustomerDraft('account-a', 'order.confirmed', draft)

    expect(customerDraftKey('account-a', 'order.confirmed')).not.toBe(customerDraftKey('account-b', 'order.confirmed'))
    expect(readCustomerDraft('account-a', 'order.confirmed')?.introText).toBe('長い本文'.repeat(200))
    expect(readCustomerDraft('account-b', 'order.confirmed')).toBeNull()

    clearCustomerDraft('account-a', 'order.confirmed')
    expect(readCustomerDraft('account-a', 'order.confirmed')).toBeNull()
  })

  it('保存済みと同じ内容の控えは復元扱いにしない', () => {
    const saved = setting()
    writeCustomerDraft('account-a', 'order.confirmed', pickCustomerDraft(saved))
    const stored = readCustomerDraft('account-a', 'order.confirmed')
    expect(stored).not.toBeNull()
    expect(isSameCustomerDraft(saved, stored!)).toBe(true)
    expect(isSameCustomerDraft({ ...saved, introText: '書き換えた本文' }, stored!)).toBe(false)
  })
})

describe('#678 実Reactで描いた編集画面', () => {
  const editorProps = {
    setting: setting(),
    definition: definition(),
    busy: false,
    onChange: vi.fn(),
    onClose: vi.fn(),
    onPublish: vi.fn(),
    onSave: vi.fn(),
    onTestSend: vi.fn(),
    notice: null,
    hasUnsaved: false,
  }

  /*
   * Chrome(headless, 実CSS)で測った実測値。
   *   375px 折り返しなし: 操作列 526px / 右端 550px → 175px が画面の外
   *   375px 折り返しあり: 操作列 343px / 右端 359px → はみ出しなし(2行)
   *   1440px / 1920px はどちらも 526px / 1行で変わらない
   * ここでは、その折り返しを外す変更を止める。
   */
  it('375px級でも固定フッターの主要操作を折り返し、横へはみ出す一列にしない', () => {
    const html = renderToStaticMarkup(<CustomerNotificationEditor {...editorProps} />)
    const actions = /<div data-design="editor-footer-actions" class="([^"]+)"/.exec(html)
    expect(actions).not.toBeNull()
    // ボタンの文字は共通部品側で nowrap。列が折り返さないと 375px で横に出る。
    expect(actions![1]).toContain('flex-wrap')
    expect(actions![1]).toContain('min-w-0')
    const footer = /<div data-design="editor-footer" class="([^"]+)"/.exec(html)
    expect(footer![1]).toContain('px-4')
    expect(footer![1]).toContain('sm:px-6')
    // 折り返した分だけ本文の下余白を広げ、最後の入力欄が隠れないようにする。
    expect(html).toContain('pb-48 sm:pb-24')
    expect(html).toContain('顧客へのお知らせを公開')
    expect(html).toContain('下書きを保存')
  })

  it('未保存の編集があることを画面に出す', () => {
    expect(renderToStaticMarkup(<CustomerNotificationEditor {...editorProps} hasUnsaved />))
      .toContain('未保存の変更があります')
    expect(renderToStaticMarkup(<CustomerNotificationEditor {...editorProps} />))
      .not.toContain('未保存の変更があります')
  })

  it('長文を入れても入力欄と見本が最小幅で潰れず、内容をそのまま描く', () => {
    const longIntro = 'ご注文ありがとうございます。'.repeat(50)
    const html = renderToStaticMarkup(
      <CustomerNotificationEditor {...editorProps} setting={setting({ introText: longIntro })} />,
    )
    expect(html).toContain(longIntro)
    expect(html).toContain('grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_390px]')
  })

  it('定義がないお知らせには公開ボタンを出さない', () => {
    const html = renderToStaticMarkup(<CustomerNotificationEditor {...editorProps} definition={null} />)
    expect(html).not.toContain('顧客へのお知らせを公開')
    expect(html).toContain('お知らせを保存')
  })

  it('保存中は主要操作を押せなくする', () => {
    const html = renderToStaticMarkup(<CustomerNotificationEditor {...editorProps} busy />)
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})

describe('#678 実Reactで描いた画面全体', () => {
  it('読み込み前のタブ件数は数を作らず「—」にする', () => {
    const html = renderToStaticMarkup(<LineNotificationsPage />)
    expect(html).toContain('運用者へのお知らせ —')
    expect(html).toContain('顧客へのお知らせ —')
  })

  it('運用者件数は0件・読み込み中・取得失敗を書き分ける', () => {
    expect(operatorTabCountLabel('ready', 0)).toBe('0')
    expect(operatorTabCountLabel('ready', 7)).toBe('7')
    expect(operatorTabCountLabel('loading', null)).toBe('—')
    expect(operatorTabCountLabel('error', null)).toBe('取得失敗')
    expect(operatorTabCountLabel('forbidden', null)).toBe('取得失敗')
  })
})

describe('#678 一覧の並び順', () => {
  it('「今日」の件数で多い順に並べ、集計の無い行を末尾へ寄せる', () => {
    const counts = new Map([['order.confirmed', 2], ['order.shipped', 8]])
    const sorted = sortCustomerSettingsBySentCount(
      [
        setting({ eventType: 'order.confirmed', label: '注文受付' }),
        setting({ eventType: 'order.canceled', label: 'キャンセル' }),
        setting({ eventType: 'order.shipped', label: '発送完了' }),
      ],
      (eventType) => counts.get(eventType) ?? null,
    )
    expect(sorted.map((item) => item.eventType)).toEqual(['order.shipped', 'order.confirmed', 'order.canceled'])
  })
})
