// @vitest-environment happy-dom
/*
 * #678 N-337/N-338/N-340/N-341 の実挙動。
 *
 * ここでは React の hook を差し替えない。実物の React で描き、
 * 実物の Promise を遅らせて逆順に返す。画面の中の呼び出し口を
 * そのまま呼ぶので、実APIと同じ非同期境界で保存・公開・
 * アカウント切替が確かめられる。
 *
 * 追加受入条件（0件・担当者0人・403/500取得失敗と再試行・長文入力）は、
 * 静的HTMLやhelper関数の直接呼び出しでは固定できない。実物のDOM
 * （happy-dom）へ実物のReactを `@testing-library/react` でマウントし、
 * 実物のクリック・入力・再読込ボタンを操作して確かめる
 * （下の「#678 実DOMへマウントした画面全体」）。
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { act } from 'react'
import { flushSync } from 'react-dom'

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

/*
 * account切替を「実物のReact再レンダー」として起こすための、購読可能な口。
 * `commitAccountSwitch` は React のイベント・act() を経由しない生の
 * setState呼び出しで、レンダー（layout境界）と受動effect（load()の発火）を
 * 別のタスクへ切り離す——本番のブラウザで account切替の描画コミットと
 * load() の useEffect 発火が別々に起きるのと同じ非同期境界を保つ。
 */
const accountSetters = new Set<(id: string | null) => void>()
function useControllableAccount(): string | null {
  const [id, setId] = React.useState(fixture.selectedAccountId)
  React.useEffect(() => {
    accountSetters.add(setId)
    return () => { accountSetters.delete(setId) }
  }, [])
  return id
}
function commitAccountSwitch(id: string | null): void {
  fixture.selectedAccountId = id
  accountSetters.forEach((setId) => setId(id))
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: useControllableAccount() }),
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

import { ApiError, type EcNotificationSetting, type LineNotificationDefinition } from '@/lib/api'
import LineNotificationsPage from './page'

const {
  CustomerNotificationEditor,
  canSettleDraft,
  clearCustomerDraft,
  customerDraftFingerprint,
  customerDraftKey,
  isSameCustomerDraft,
  operatorTabCountLabel,
  pickCustomerDraft,
  publishCustomerNotification,
  readCustomerDraft,
  saveCustomerNotification,
  sendCustomerTestNotification,
  sortCustomerSettingsBySentCount,
  writeCustomerDraft,
} = LineNotificationsPage.__testing

type MutationApi = Parameters<typeof saveCustomerNotification>[0]['api']
type MutationGuard = Parameters<typeof saveCustomerNotification>[0]['guard']

/**
 * 画面が持つ「いまのアカウント世代」「いま向いているアカウント」「いまの文面の
 * 指紋」を、試験から動かせる形にする。保存を投げたあとに `type()` すれば、
 * 保存中の追加入力をそのまま再現できる。
 */
function editorState(initial: EcNotificationSetting, accountId = 'account-a') {
  const state = {
    generation: 1,
    accountId,
    fingerprint: customerDraftFingerprint(pickCustomerDraft(initial)),
  }
  return {
    state,
    /** 保存中の追加入力。1打ごとに指紋が進む。 */
    type(next: EcNotificationSetting) { state.fingerprint = customerDraftFingerprint(pickCustomerDraft(next)) },
    /** アカウントの切替が済み、読み直し（load）も走った後。 */
    switchAccount(nextAccountId?: string) {
      state.generation += 1
      state.accountId = nextAccountId ?? (state.accountId === 'account-a' ? 'account-b' : 'account-a')
    },
    /**
     * 描画の境界だけを先に進める。「Bを選んだ直後・BのuseEffect（読み直し）は
     * まだ発火していない」——loadGeneration は動かないが、選択中accountは
     * もう新しいアカウントを指している——という、指摘された隙間そのものを模す。
     */
    moveRenderToAccountBeforeReload(nextAccountId: string) {
      state.accountId = nextAccountId
    },
    guard(sent: EcNotificationSetting): MutationGuard {
      return {
        generation: state.generation,
        currentGeneration: () => state.generation,
        forAccountId: state.accountId,
        currentAccountId: () => state.accountId,
        sentFingerprint: customerDraftFingerprint(pickCustomerDraft(sent)),
        currentFingerprint: () => state.fingerprint,
      }
    },
  }
}

/** 世代もアカウントも文面も動かない、いちばん素直な見張り。 */
function steadyGuard(sent: EcNotificationSetting): MutationGuard {
  return editorState(sent).guard(sent)
}

/** 実物のReactで編集画面を描くときの、操作以外のprops。 */
const editorFixture = {
  definition: null as LineNotificationDefinition | null,
  busy: false,
  onChange: vi.fn(),
  onClose: vi.fn(),
  onPublish: vi.fn(),
  onSave: vi.fn(),
  onTestSend: vi.fn(),
  notice: null as { tone: 'success' | 'error'; text: string } | null,
  hasUnsaved: false,
}

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
  // happy-dom の実物の window/document は壊さない。localStorage だけ
  // 差し替える（window ごと差し替えると、実DOM試験の screen/waitFor が壊れる）。
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true })
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
      guard: steadyGuard(edited),
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
    expect(outcome).toMatchObject({ kind: 'applied', tone: 'success', enabled: true, contentSaved: true, settleDraft: true })
  })

  it('下書きの保存に失敗したら公開せず、端末の控えも消さない', async () => {
    const saveFailure = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(saveFailure.promise)
    const edited = setting({ title: '消えては困る見出し' })

    const running = publishCustomerNotification({
      api: mutationApi(),
      setting: edited,
      definition: definition(),
      guard: steadyGuard(edited),
    })
    saveFailure.reject(new Error('network down'))
    const outcome = await running

    expect(fixture.publishDefinition).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: 'failed', contentSaved: false, settleDraft: false })
    expect(outcome.kind === 'failed' ? outcome.message : '').toContain('公開していません')
  })

  it('公開だけ失敗したときは、下書きは保存済みとして扱い、内容を失わない', async () => {
    const savedDefinition = definition({ version: 5 })
    fixture.updateDraft.mockResolvedValue({ success: true, data: savedDefinition })
    fixture.publishDefinition.mockResolvedValue({ success: false })
    const edited = setting({ title: '新しい見出し' })

    const outcome = await publishCustomerNotification({
      api: mutationApi(),
      setting: edited,
      definition: definition(),
      guard: steadyGuard(edited),
    })

    expect(outcome).toMatchObject({ kind: 'applied', tone: 'error', contentSaved: true, settleDraft: true })
    expect(outcome.kind === 'applied' ? outcome.definition?.version : null).toBe(5)
    expect(outcome.kind === 'applied' ? outcome.message : '').toContain('下書きとして保存済み')
  })
})

/*
 * 司令塔の再審査で挙がった2つの競合。
 * どちらも「古い応答が、新しい下書きを消す」形をしている。
 * 実物の Promise を握って、応答が返る前に入力・切替を起こして固定する。
 */
describe('#678 保存中の追加入力を、古い応答で消さない', () => {
  it('競合1: 保存を押したあとに入力を足すと、その保存では控えを消さず未保存のままにする', async () => {
    const sent = setting({ introText: '保存を押した時点の本文' })
    const editor = editorState(sent)
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })

    // 保存中も入力欄は動く。応答が返る前に文面を進める。
    const afterTyping = setting({ introText: '保存を押した時点の本文＋あとから足した一文' })
    editor.type(afterTyping)

    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    expect(outcome.kind).toBe('applied')
    expect(outcome.contentSaved).toBe(true)
    // ここが要点。文面が先へ進んでいるので「保存済み」にはしない。
    expect(outcome.settleDraft).toBe(false)
    expect(outcome.kind === 'applied' ? outcome.message : '').toContain('まだ保存していません')

    // 実物のReactで描くと、足した一文が残り、未保存の印も出たままになる。
    const html = renderToStaticMarkup(<CustomerNotificationEditor
      {...editorFixture}
      setting={afterTyping}
      hasUnsaved={!outcome.settleDraft}
      notice={outcome.kind === 'applied' ? { tone: outcome.tone, text: outcome.message } : null}
    />)
    expect(html).toContain('保存を押した時点の本文＋あとから足した一文')
    expect(html).toContain('未保存の変更があります')
    expect(html).toContain('まだ保存していません')
  })

  it('競合1の対照: 保存中に入力を足さなければ、その保存で控えを消してよい', async () => {
    const sent = setting({ introText: '保存を押した時点の本文' })
    const editor = editorState(sent)
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })
    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    expect(outcome).toMatchObject({ kind: 'applied', contentSaved: true, settleDraft: true })
    expect(outcome.kind === 'applied' ? outcome.message : '').not.toContain('まだ保存していません')
  })

  it('競合1: 公開でも同じく、押したあとの入力を古い応答で消さない', async () => {
    const sent = setting({ introText: '公開を押した時点の本文' })
    const editor = editorState(sent)
    const savedDefinition = definition({ version: 5 })
    fixture.updateDraft.mockResolvedValue({ success: true, data: savedDefinition })
    const slowPublish = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.publishDefinition.mockReturnValue(slowPublish.promise)

    const running = publishCustomerNotification({
      api: mutationApi(),
      setting: sent,
      definition: definition(),
      guard: editor.guard(sent),
    })
    editor.type(setting({ introText: '公開を押した時点の本文＋あとから足した一文' }))
    slowPublish.resolve({ success: true, data: definition({ version: 6, status: 'published' }) })
    const outcome = await running

    expect(outcome).toMatchObject({ kind: 'applied', contentSaved: true, settleDraft: false })
    expect(outcome.kind === 'applied' ? outcome.tone : null).toBe('error')
  })

  it('競合2: A保存中→B→A→再編集のあとに古いAの応答が返っても、控えを消さない', async () => {
    const sent = setting({ introText: 'Aで保存を押した時点の本文' })
    const editor = editorState(sent)
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })

    editor.switchAccount()                                   // A → B
    editor.switchAccount()                                   // B → A（読み直しで世代がもう1つ進む）
    editor.type(setting({ introText: 'Aへ戻って書き直した本文' }))

    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    // 世代も文面も違う。画面へは書かず、控えも消さない。
    expect(outcome).toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })

    // Aへ戻って書き直した文面と未保存の印が、実物のReact描画にも残る。
    const html = renderToStaticMarkup(<CustomerNotificationEditor
      {...editorFixture}
      setting={setting({ introText: 'Aへ戻って書き直した本文' })}
      hasUnsaved={!outcome.settleDraft}
    />)
    expect(html).toContain('Aへ戻って書き直した本文')
    expect(html).toContain('未保存の変更があります')
  })

  it('競合2: Aへ戻って文面が同じままでも、世代が違えば画面へは書かない', async () => {
    const sent = setting()
    const editor = editorState(sent)
    fixture.updateDraft.mockResolvedValue({ success: true, data: definition({ version: 5 }) })
    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })
    editor.switchAccount()
    editor.switchAccount()
    await expect(running).resolves.toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })
  })
})

/*
 * 司令塔の独立再審査REJECT（2026-09-09）。
 *
 * loadGeneration は load() の useEffect の中でしか進まない。Aの保存中に
 * Bを選ぶと、選択中accountを映す描画そのものは同期的に済むが、Bの
 * load()（useEffect）が実際に発火して loadGeneration を進めるのは、
 * それより後になる——その隙間で古いAの応答が返ると、旧来の実装は
 * isStale=false のまま A の localStorage の下書きを消し、dirty も
 * 解除してしまっていた。
 *
 * ここでは、Bの load() がまだ一度も発火していない（世代は据え置き）状態を
 * `moveRenderToAccountBeforeReload` で明示的に作り、そこへ旧Aの応答を
 * 返して固定する。
 */
describe('#678 Bを選んだ直後・Bのload未発火でも、旧Aの応答からAの控えとdirtyを守る', () => {
  // この describe は実物の画面を mount する。片づけないと、次の試験へ
  // 前の画面が残ったままになり「内容を編集」等が二重に見つかる。
  afterEach(cleanup)

  it('世代はまだ古いまま（Bのloadが一度も発火していない）でも、選択中accountが変わっていればstaleになる', async () => {
    const sent = setting({ introText: 'Aで保存を押した時点の本文' })
    const editor = editorState(sent, 'account-a')
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const guard = editor.guard(sent)
    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard,
    })

    // 描画の境界だけが先に進む。loadGeneration はまだ動いていない
    // ——Bの useEffect（読み直し）が一度も発火していない状態そのもの。
    expect(guard.currentGeneration()).toBe(guard.generation)
    editor.moveRenderToAccountBeforeReload('account-b')
    expect(guard.currentGeneration()).toBe(guard.generation) // 世代は据え置きのまま

    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    // 世代だけを見ていたら見逃す。ここは account の不一致だけで stale になる。
    expect(outcome).toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })
  })

  it('公開でも同じ隙間で、旧Aの応答からAの下書きを守る', async () => {
    const sent = setting({ introText: 'Aで公開を押した時点の本文' })
    const editor = editorState(sent, 'account-a')
    fixture.updateDraft.mockResolvedValue({ success: true, data: definition({ version: 5 }) })
    const slowPublish = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.publishDefinition.mockReturnValue(slowPublish.promise)

    const guard = editor.guard(sent)
    const running = publishCustomerNotification({ api: mutationApi(), setting: sent, definition: definition(), guard })

    editor.moveRenderToAccountBeforeReload('account-b')
    slowPublish.resolve({ success: true, data: definition({ version: 6, status: 'published' }) })
    const outcome = await running

    expect(outcome).toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })
  })

  /*
   * 司令塔の独立再審査REJECT（2026-09-09、2回目）。
   *
   * 直前の版は、helper（saveCustomerNotification）の戻り値を、別の
   * CustomerNotificationEditor の静的markupへ手で渡していただけで、
   * 実物の LineNotificationsPage は一度もmountしていなかった——
   * 「回帰証拠が不足」というご指摘はそのとおりだった。
   *
   * ここでは実物の LineNotificationsPage をmountし、account context を
   * 実物のReact再レンダーとしてA→Bへ動かす。`commitAccountSwitch` は
   * act()・React由来イベントを経由しない生のsetState呼び出しで、
   * レンダー（layout境界）と load() の受動effect（useEffect）の発火を
   * 別のタスクへ切り離す。同じ木に置いた層効果（useLayoutEffect）の探針が
   * 「Bへコミットした」瞬間を検出し、そこ——load()のuseEffectがまだ
   * 一度も発火していない・loadGenerationが据え置きのままの
   * layout境界——で旧Aの保存応答を解放する。
   */
  it('実物のLineNotificationsPageをmountし、layout境界（Bへコミット直後・load()のuseEffect発火前）で旧Aの応答を返しても、Aの控え・dirtyは保持されBへ漏れない', async () => {
    fixture.settings.mockImplementation((accountId: string) => Promise.resolve({
      success: true,
      data: [setting({
        title: accountId === 'account-b' ? 'B店の注文受付' : 'A店の注文受付',
        introText: accountId === 'account-b' ? 'B店の本文' : 'A店の本文',
      })],
    }))
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })
    fixture.definitions.mockResolvedValue({ success: true, data: [] })
    fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })

    let releaseA: (value: { success: boolean }) => void = () => {
      throw new Error('releaseA が呼ばれる前に保存応答を解放しようとした')
    }
    const heldA = new Promise<{ success: boolean }>((resolve) => { releaseA = resolve })
    fixture.updateSetting.mockReturnValue(heldA)

    let committedToB = false
    let releaseLayoutCommitted: () => void = () => {}
    const layoutCommitted = new Promise<void>((resolve) => { releaseLayoutCommitted = resolve })

    function LayoutBoundaryProbe() {
      const account = useControllableAccount()
      const seen = React.useRef<string | null>(null)
      React.useLayoutEffect(() => {
        if (seen.current === account || account !== 'account-b') return
        seen.current = account
        committedToB = true
        // ここが本題。layout effect は「同じコミット内の受動effect（load()の
        // useEffect）より必ず先に」実行される——React が保証する順序であり、
        // タイミングの偶然に頼っていない。
        releaseA({ success: true })
        releaseLayoutCommitted()
      }, [account])
      return null
    }

    render(<>
      <LayoutBoundaryProbe />
      <LineNotificationsPage />
    </>)
    await waitFor(() => expect(screen.getByText('A店の注文受付')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '内容を編集' }))
    const introBox = await screen.findByLabelText('ご案内文') as HTMLTextAreaElement
    fireEvent.change(introBox, { target: { value: 'Aで保存を押した時点の本文' } })
    await waitFor(() => expect(screen.getByText('未保存の変更があります')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'お知らせを保存' }))
    expect(committedToB).toBe(false)

    // act() を経由しない生の setState。レンダーと load() の受動effectが
    // 別タスクへ分かれることを、この境界試験そのものが要求している。
    commitAccountSwitch('account-b')

    await layoutCommitted
    expect(committedToB).toBe(true)

    // load()（受動effect）はこの時点でまだ一度も発火していない。
    // レイアウトeffectは同じコミット内の受動effectより必ず先に走るという
    // Reactの保証により、ここでは待ち合わせではなく確定した事実として言える。
    expect(fixture.operatorList).not.toHaveBeenCalledWith('account-b')
    expect(fixture.settings).not.toHaveBeenCalledWith('account-b')

    // まさにこの窓――load()のuseEffectがまだ発火していない――のうちに
    // 解放された旧Aの応答では、Aの控えは消えていない。
    const stored = window.localStorage.getItem(customerDraftKey('account-a', 'order.confirmed'))
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!).introText).toBe('Aで保存を押した時点の本文')

    // 残りは普通に進める。Bが正しく読み込まれ、Aの内容がBへ漏れていないことも確かめる。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await waitFor(() => {
      const box = screen.getByLabelText('ご案内文') as HTMLTextAreaElement
      expect(box.value).toBe('B店の本文')
    })
    expect((screen.getByLabelText('ご案内文') as HTMLTextAreaElement).value).not.toBe('Aで保存を押した時点の本文')

    // Aへ戻ると、消されなかった控えが復元され、未保存の印も戻る。
    commitAccountSwitch('account-a')
    await waitFor(() => {
      const box = screen.getByLabelText('ご案内文') as HTMLTextAreaElement
      expect(box.value).toBe('Aで保存を押した時点の本文')
    })
    expect(
      screen.queryByText('未保存の変更があります') !== null
        || screen.queryByText(/未保存の編集を.*件復元しました/) !== null,
    ).toBe(true)
  })

  /*
   * 司令塔の独立審査REJECT（2026-09-09、3回目）。
   *
   * テスト送信の完了判定（testSend）は loadGeneration だけを見ており、
   * selectedAccountRef の照合が無かった。保存・公開と同じ見張り
   * （isStale＝世代とアカウントの両方）を通すよう直した。
   *
   * 【この2本の役割分担】
   * 逆変異（isStale から account 照合だけを外す）で赤になる証拠は、
   * すぐ下の「アカウントが替わっていれば…」——実物の Promise を握って
   * 解放順を作る関数境界の試験——が担う。account 照合の有無で
   * `stale` / `applied` がはっきり分かれる。
   *
   * 一方こちらの実mount試験は、逆変異でも赤にならない。理由は実測で
   * 確かめた: load() は先頭で必ず setNotice(null) を含む状態リセットを
   * するため、アカウント切替の直後に旧Aの結果が notice へ入っても、
   * 同じ画面更新の中で load() に消され、画面には一度も出ない
   * （マイクロタスクを32回進めてから flushSync しても出ない）。
   * つまり notice 経由の「漏れ」は現状の実装では観測できない。
   * それでもこの試験は、A→B切替をまたいだ一連の流れでBの画面が
   * Bの内容だけになることを実物の画面で固定する回帰試験として残す。
   */
  it('実物のLineNotificationsPageをmountし、A送信→B切替→Aの遅延応答の順でも、Bの画面にAの送信結果が出ない', async () => {
    fixture.settings.mockImplementation((accountId: string) => Promise.resolve({
      success: true,
      data: [setting({
        title: accountId === 'account-b' ? 'B店の注文受付' : 'A店の注文受付',
        introText: accountId === 'account-b' ? 'B店の本文' : 'A店の本文',
      })],
    }))
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })
    fixture.definitions.mockResolvedValue({ success: true, data: [] })
    fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })

    let releaseTestSend: (value: { success: boolean; data: { sent: number } }) => void = () => {
      throw new Error('releaseTestSend が呼ばれる前にテスト送信応答を解放しようとした')
    }
    const heldTestSend = new Promise<{ success: boolean; data: { sent: number } }>((resolve) => { releaseTestSend = resolve })
    fixture.testSend.mockReturnValue(heldTestSend)

    let committedToB = false
    let releaseLayoutCommitted: () => void = () => {}
    const layoutCommitted = new Promise<void>((resolve) => { releaseLayoutCommitted = resolve })

    function LayoutBoundaryProbe() {
      const account = useControllableAccount()
      const seen = React.useRef<string | null>(null)
      React.useLayoutEffect(() => {
        if (seen.current === account || account !== 'account-b') return
        seen.current = account
        committedToB = true
        // ここが本題。同じコミット内の受動effect（load()のuseEffect）より必ず先に走る。
        releaseTestSend({ success: true, data: { sent: 3 } })
        releaseLayoutCommitted()
      }, [account])
      return null
    }

    render(<>
      <LayoutBoundaryProbe />
      <LineNotificationsPage />
    </>)
    await waitFor(() => expect(screen.getByText('A店の注文受付')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '内容を編集' }))
    await screen.findByLabelText('ご案内文')

    fireEvent.click(screen.getAllByRole('button', { name: '自分にテスト送信' })[0])
    expect(fixture.testSend).toHaveBeenCalledTimes(1)
    expect(committedToB).toBe(false)

    // act() を経由しない生の setState。保存・公開の境界試験と同じ技法。
    commitAccountSwitch('account-b')

    await layoutCommitted
    expect(committedToB).toBe(true)

    // load()（受動effect）はこの時点でまだ一度も発火していない。
    expect(fixture.operatorList).not.toHaveBeenCalledWith('account-b')
    expect(fixture.settings).not.toHaveBeenCalledWith('account-b')

    // Aの応答（testSendの継続）を最後まで走らせる。act() は抜けるときに
    // 保留中のeffectまで流してしまうので、ここでは生のPromiseで
    // マイクロタスクだけを進める。
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve()
    expect(fixture.operatorList).not.toHaveBeenCalledWith('account-b')
    flushSync(() => {})
    expect(screen.queryByText(/テスト受信者 3名へ送信しました/)).toBeNull()

    // Bの読み直しまで進めても、画面はBの内容だけになりAの結果は出ない。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await waitFor(() => {
      const box = screen.getByLabelText('ご案内文') as HTMLTextAreaElement
      expect(box.value).toBe('B店の本文')
    })
    expect(screen.queryByText(/テスト受信者 3名へ送信しました/)).toBeNull()
  })

  /*
   * 逆変異で赤になる証拠はここ。isStale から account 照合だけを外すと、
   * 世代が動いていない（Bのload()未発火）この状況で `applied` が返り、
   * 旧Aのテスト送信結果が画面へ入る側に回る。
   */
  it('テスト送信: アカウントが替わっていれば、世代が据え置き（Bのload未発火）でも結果を画面へ入れない', async () => {
    const held = deferred<{ success: boolean; data: { sent: number } }>()
    let currentAccount = 'account-a'
    const sent = setting()

    const running = sendCustomerTestNotification({
      api: { testSend: () => held.promise as never },
      setting: sent,
      accountId: 'account-a',
      guard: {
        // Bのload()はまだ発火していない。世代は据え置きのまま。
        generation: 1,
        currentGeneration: () => 1,
        forAccountId: 'account-a',
        currentAccountId: () => currentAccount,
        sentFingerprint: customerDraftFingerprint(pickCustomerDraft(sent)),
        currentFingerprint: () => customerDraftFingerprint(pickCustomerDraft(sent)),
      },
    })

    // 応答が返る前に、描画の境界だけがBへ進む。
    currentAccount = 'account-b'
    held.resolve({ success: true, data: { sent: 3 } })

    await expect(running).resolves.toEqual({ kind: 'stale' })
  })

  it('テスト送信: 同じアカウント・同じ世代のままなら、結果を画面へ入れる', async () => {
    const held = deferred<{ success: boolean; data: { sent: number } }>()
    const sent = setting()
    const running = sendCustomerTestNotification({
      api: { testSend: () => held.promise as never },
      setting: sent,
      accountId: 'account-a',
      guard: {
        generation: 1,
        currentGeneration: () => 1,
        forAccountId: 'account-a',
        currentAccountId: () => 'account-a',
        sentFingerprint: customerDraftFingerprint(pickCustomerDraft(sent)),
        currentFingerprint: () => customerDraftFingerprint(pickCustomerDraft(sent)),
      },
    })
    held.resolve({ success: true, data: { sent: 3 } })
    await expect(running).resolves.toEqual({
      kind: 'applied', tone: 'success', message: 'テスト受信者 3名へ送信しました。',
    })
  })
})

describe('#678 アカウント切替をまたいだ応答を画面へ書かない', () => {
  it('アカウントAの保存が、Bへ切り替えた後に返っても stale になる', async () => {
    const sent = setting()
    const editor = editorState(sent)
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })

    // 応答が返る前に別アカウントを選ぶ。画面は読み直しへ入る。
    editor.switchAccount()
    slowSave.resolve({ success: true, data: definition({ version: 5 }) })
    const outcome = await running

    expect(outcome).toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })
  })

  it('遅いアカウントAの公開応答が、先に返ったBの結果を上書きしない', async () => {
    const slowA = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    const fastB = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    const settingA = setting({ title: 'Aの見出し' })
    const settingB = setting({ title: 'Bの見出し' })
    const editor = editorState(settingA)
    const apiA = mutationApi({
      updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ version: 5 }) }),
      publishDefinition: vi.fn().mockReturnValue(slowA.promise),
    } as Partial<MutationApi>)
    const apiB = mutationApi({
      updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 9 }) }),
      publishDefinition: vi.fn().mockReturnValue(fastB.promise),
    } as Partial<MutationApi>)

    const guardA = editor.guard(settingA)
    const runningA = publishCustomerNotification({
      api: apiA, setting: settingA, definition: definition(), guard: guardA,
    })
    editor.switchAccount()
    editor.type(settingB)
    const runningB = publishCustomerNotification({
      api: apiB,
      setting: settingB,
      definition: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 9 }),
      guard: editor.guard(settingB),
    })

    fastB.resolve({ success: true, data: definition({ id: 'definition-b', lineAccountId: 'account-b', version: 10 }) })
    const outcomeB = await runningB
    expect(outcomeB).toMatchObject({ kind: 'applied', settleDraft: true })
    expect(outcomeB.kind === 'applied' ? outcomeB.definition?.lineAccountId : null).toBe('account-b')

    slowA.resolve({ success: true, data: definition({ version: 6 }) })
    const outcomeA = await runningA
    expect(outcomeA).toEqual({ kind: 'stale', contentSaved: true, settleDraft: false })
  })

  it('保存が失敗して返っても、切替後なら別アカウントの画面へ誤りを出さない', async () => {
    const sent = setting()
    const editor = editorState(sent)
    const slowSave = deferred<{ success: boolean; data: LineNotificationDefinition }>()
    fixture.updateDraft.mockReturnValue(slowSave.promise)

    const running = saveCustomerNotification({
      api: mutationApi(),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: editor.guard(sent),
    })
    editor.switchAccount()
    slowSave.reject(new Error('network down'))

    await expect(running).resolves.toEqual({ kind: 'stale', contentSaved: false, settleDraft: false })
  })
})

describe('#678 出す・止めるの切替は編集中の文面を巻き込まない', () => {
  it('切替では文面を送らないので、編集中の文面と未保存の印に触れない', async () => {
    const stopDefinition = vi.fn().mockResolvedValue({ success: true, data: definition({ status: 'stopped', version: 5 }) })
    const sent = setting({ isEnabled: true })
    const outcome = await saveCustomerNotification({
      api: mutationApi({ stopDefinition } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: false,
      guard: steadyGuard(sent),
    })
    expect(stopDefinition).toHaveBeenCalledWith('definition-a', { lineAccountId: 'account-a', expectedVersion: 4 })
    expect(fixture.updateDraft).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ kind: 'applied', enabled: false, contentSaved: false, settleDraft: false })
  })

  it('文面の保存では控えを消してよい', async () => {
    const sent = setting()
    const outcome = await saveCustomerNotification({
      api: mutationApi({ updateDraft: vi.fn().mockResolvedValue({ success: true, data: definition({ version: 5 }) }) } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: sent,
      definition: definition(),
      enabled: true,
      guard: steadyGuard(sent),
    })
    expect(outcome).toMatchObject({ kind: 'applied', contentSaved: true, settleDraft: true })
  })

  it('定義がないお知らせ（EC既定設定）の保存も、押したあとの入力は消さない', async () => {
    const sent = setting()
    const editor = editorState(sent)
    const slowUpdate = deferred<{ success: boolean }>()
    const updateSetting = vi.fn().mockReturnValue(slowUpdate.promise)
    const running = saveCustomerNotification({
      api: mutationApi({ updateSetting } as Partial<MutationApi>),
      accountId: 'account-a',
      setting: sent,
      definition: null,
      enabled: true,
      guard: editor.guard(sent),
    })
    editor.type(setting({ introText: 'あとから足した一文' }))
    slowUpdate.resolve({ success: true })
    await expect(running).resolves.toMatchObject({ kind: 'applied', contentSaved: true, settleDraft: false })
    expect(updateSetting).toHaveBeenCalledWith('account-a', 'order.confirmed', expect.objectContaining({ isEnabled: true }))
  })
})

describe('#678 「保存済み」にしてよい条件', () => {
  const guard = (overrides: Partial<MutationGuard> = {}): MutationGuard => ({
    generation: 1,
    currentGeneration: () => 1,
    forAccountId: 'account-a',
    currentAccountId: () => 'account-a',
    sentFingerprint: 'sent',
    currentFingerprint: () => 'sent',
    ...overrides,
  })

  it('文面がサーバへ入っていないなら、控えは消さない', () => {
    expect(canSettleDraft(guard(), false)).toBe(false)
  })

  it('読み直し（世代）が進んでいるなら、控えは消さない', () => {
    expect(canSettleDraft(guard({ currentGeneration: () => 2 }), true)).toBe(false)
  })

  /*
   * 司令塔の再審査（独立審査REJECT）で指摘された、まさにその隙間。
   * loadGeneration は load() の useEffect の中でしか進まない。Bを選んだ
   * 直後・Bの useEffect がまだ発火していない（＝世代はまだ古いまま）状態でも、
   * 選択中accountはもう新しいアカウントを指している。世代だけを見る guard
   * では、この状態は「stale ではない」と誤判定する。account を独立して
   * 照合することで、useEffect の発火を待たずに正しく stale と判定する。
   */
  it('アカウントが替わっているなら、世代がまだ古いまま（Bのload未発火）でも控えは消さない', () => {
    expect(canSettleDraft(guard({ currentAccountId: () => 'account-b' }), true)).toBe(false)
  })

  it('画面の文面が先へ進んでいるなら、控えは消さない', () => {
    expect(canSettleDraft(guard({ currentFingerprint: () => 'typed-more' }), true)).toBe(false)
  })

  it('編集していた行が画面から消えているなら、控えは消さない', () => {
    expect(canSettleDraft(guard({ currentFingerprint: () => undefined }), true)).toBe(false)
  })

  it('同じアカウントの同じ文面のままなら、控えを消してよい', () => {
    expect(canSettleDraft(guard(), true)).toBe(true)
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
   * 実寸は line-notifications-browser-behavior.mjs が実物のChromeで測る。
   *   pnpm --filter web build
   *   node apps/web/src/app/line-notifications/line-notifications-browser-behavior.mjs
   * そこで測った値（折り返しなしだと 375px で右端 550px = 175px が画面の外、
   * 折り返しありで 359px）を踏まえ、ここでは折り返しを外す変更を止める。
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

/*
 * #678 追加受入条件。0件・担当者0人・403/500取得失敗と再試行・長文入力を、
 * helperの直接呼び出しや静的HTMLではなく、実DOM（happy-dom）へ実物のReactを
 * マウントして固定する。fetchは `@/lib/api` の境界だけを差し替え、
 * クリック・入力・再読込は実物のイベントで起こす。
 */
describe('#678 実DOMへマウントした画面全体', () => {
  afterEach(cleanup)

  it('0件: 顧客のお知らせも運用者件数も「0」であり、「—」でも「取得失敗」でもない', async () => {
    fixture.settings.mockResolvedValue({ success: true, data: [] })
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })

    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText('顧客へのお知らせはまだありません')).toBeTruthy())
    // タブの数字は「まだ読めていない」でも「取れなかった」でもなく、実際に0件だと分かる形。
    expect(screen.getByText('顧客へのお知らせ 0')).toBeTruthy()
    expect(screen.getByText('運用者へのお知らせ 0')).toBeTruthy()
    expect(screen.queryByText('顧客へのお知らせ —')).toBeNull()
    expect(screen.queryByText('運用者へのお知らせ 取得失敗')).toBeNull()
  })

  it('担当者0人: 顧客のお知らせ自体はあっても、運用者タブの実数は0のまま出す', async () => {
    fixture.settings.mockResolvedValue({ success: true, data: [setting()] })
    fixture.overview.mockResolvedValue({
      success: true,
      data: { last24h: 3, failed: 0, byType: [{ eventType: 'order.confirmed', label: '注文受付', count: 3 }] },
    })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })

    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText('注文を受け付けました')).toBeTruthy())
    expect(screen.getByText('運用者へのお知らせ 0')).toBeTruthy()
  })

  it('403: 顧客のお知らせは「表示する権限がありません」を出し、再読み込みは出さない', async () => {
    fixture.settings.mockRejectedValue(new ApiError(403))
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })

    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText('表示する権限がありません')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
  })

  it('500: 「表示できませんでした」を出し、実物の再読み込みボタンを押すと実物のfetchをやり直して復旧する', async () => {
    fixture.settings.mockRejectedValueOnce(new Error('internal error'))
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })

    render(<LineNotificationsPage />)

    await waitFor(() => expect(screen.getByText('顧客へのお知らせを表示できませんでした')).toBeTruthy())
    expect(fixture.settings).toHaveBeenCalledTimes(1)

    // 2回目からは成功する応答へ差し替えてから、実物のボタンを押す。
    fixture.settings.mockResolvedValueOnce({ success: true, data: [setting()] })
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))

    await waitFor(() => expect(screen.getByText('注文を受け付けました')).toBeTruthy())
    expect(fixture.settings).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('顧客へのお知らせを表示できませんでした')).toBeNull()
  })

  it('運用者だけ403/500になっても、顧客のお知らせは表示を続け、タブの数字だけ「取得失敗」にする', async () => {
    fixture.settings.mockResolvedValue({ success: true, data: [setting()] })
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockRejectedValueOnce(new ApiError(403))

    const { unmount } = render(<LineNotificationsPage />)
    await waitFor(() => expect(screen.getByText('注文を受け付けました')).toBeTruthy())
    expect(screen.getByText('運用者へのお知らせ 取得失敗')).toBeTruthy()
    unmount()

    fixture.operatorList.mockRejectedValueOnce(new Error('internal error'))
    render(<LineNotificationsPage />)
    await waitFor(() => expect(screen.getByText('運用者へのお知らせ 取得失敗')).toBeTruthy())
    expect(screen.getByText('注文を受け付けました')).toBeTruthy()
  })

  it('長文入力: 実物のtextareaへ実物のonChangeで打ち込み、未保存表示・端末控え・保存APIへ渡す中身まで実物のまま追う', async () => {
    const longIntro = 'ご注文ありがとうございます。'.repeat(40)
    fixture.settings.mockResolvedValue({ success: true, data: [setting()] })
    fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
    fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 } } })
    fixture.updateSetting.mockResolvedValue({ success: true, data: {} })

    render(<LineNotificationsPage />)
    await waitFor(() => expect(screen.getByText('注文を受け付けました')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '内容を編集' }))
    const introBox = await screen.findByLabelText('ご案内文') as HTMLTextAreaElement

    fireEvent.change(introBox, { target: { value: longIntro } })

    // 打ち込んだ全文が、実物のcontrolled inputへそのまま反映される。
    expect(introBox.value).toBe(longIntro)
    expect(introBox.value.length).toBe(longIntro.length)
    await waitFor(() => expect(screen.getByText('未保存の変更があります')).toBeTruthy())

    const stored = window.localStorage.getItem(customerDraftKey('account-a', 'order.confirmed'))
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!).introText).toBe(longIntro)

    fireEvent.click(screen.getByRole('button', { name: 'お知らせを保存' }))
    await waitFor(() => expect(fixture.updateSetting).toHaveBeenCalledTimes(1))
    // 保存APIへ渡した中身も、打ち込んだ長文のまま欠けたり切れたりしない。
    expect(fixture.updateSetting).toHaveBeenCalledWith(
      'account-a', 'order.confirmed', expect.objectContaining({ introText: longIntro }),
    )
    await waitFor(() => expect(screen.queryByText('未保存の変更があります')).toBeNull())
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
