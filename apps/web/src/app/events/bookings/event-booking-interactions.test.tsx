import React, { act, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  getEvent: vi.fn(),
  getBookingSummary: vi.fn(),
  updateBooking: vi.fn(),
  decideBooking: vi.fn(),
  adminCancelBooking: vi.fn(),
  listEvents: vi.fn(),
}))

const accountMock = vi.hoisted(() => ({ selectedAccountId: 'account-a' }))

vi.mock('@/lib/api', () => ({ eventsApi: apiMocks }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=event-1'),
}))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: accountMock.selectedAccountId,
    accounts: [
      { id: 'account-a', name: 'A店' },
      { id: 'account-b', name: 'B店' },
    ],
  }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/confirm-dialog', () => ({
  default: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (
    open ? <div>{children}</div> : null
  ),
}))
vi.mock('@/components/shared/button', () => ({
  default: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/components/shared/list-state', () => ({
  default: ({ kind }: { kind: string }) => <div>{kind}</div>,
}))
vi.mock('@/components/shared/pagination', () => ({ default: () => <div>ページ送り</div> }))
vi.mock('@/components/shared/select-field', () => ({
  default: ({ options, ...props }: React.ComponentProps<'select'> & { options: Array<{ value: string; label: string }> }) => (
    <select {...props}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

import EventBookingsPage from './page'
import EventsListPage from '../page'

type Listener = (event: unknown) => void

class FakeNode {
  nodeType: number
  nodeName: string
  ownerDocument: FakeDocument
  parentNode: FakeNode | null = null
  childNodes: FakeNode[] = []

  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
  }

  appendChild<T extends FakeNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    if (before === null) return this.appendChild(child)
    const index = this.childNodes.indexOf(before)
    if (index < 0) throw new Error('insert target not found')
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.splice(index, 0, child)
    return child
  }

  removeChild<T extends FakeNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index < 0) throw new Error('child not found')
    this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null }
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join('') }
  set textContent(value: string) {
    this.childNodes = []
    if (value) this.appendChild(this.ownerDocument.createTextNode(value))
  }
}

class FakeText extends FakeNode {
  nodeValue: string
  constructor(value: string, ownerDocument: FakeDocument) {
    super(3, '#text', ownerDocument)
    this.nodeValue = value
  }
  override get textContent(): string { return this.nodeValue }
  override set textContent(value: string) { this.nodeValue = value }
}

class FakeElement extends FakeNode {
  tagName: string
  namespaceURI = 'http://www.w3.org/1999/xhtml'
  style: Record<string, string> & { setProperty: (name: string, value: string) => void }
  attributes = new Map<string, string>()
  listeners = new Map<string, Set<Listener>>()
  disabled = false
  value = ''
  checked = false
  selected = false
  defaultSelected = false
  multiple = false

  constructor(tagName: string, ownerDocument: FakeDocument) {
    super(1, tagName.toUpperCase(), ownerDocument)
    this.tagName = tagName.toUpperCase()
    const style = {} as FakeElement['style']
    style.setProperty = (name, value) => { style[name] = value }
    this.style = style
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
  focus(): void { this.ownerDocument.activeElement = this }
  get options(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => (
      child instanceof FakeElement && child.tagName === 'OPTION'
    ))
  }
}

class FakeDocument extends FakeNode {
  defaultView: Record<string, unknown>
  documentElement: FakeElement
  body: FakeElement
  activeElement: FakeElement | null = null
  listeners = new Map<string, Set<Listener>>()

  constructor() {
    const placeholder = {} as FakeDocument
    super(9, '#document', placeholder)
    this.ownerDocument = this
    this.documentElement = new FakeElement('html', this)
    this.body = new FakeElement('body', this)
    this.documentElement.appendChild(this.body)
    this.defaultView = {}
  }

  createElement(tagName: string): FakeElement { return new FakeElement(tagName, this) }
  createElementNS(_namespace: string, tagName: string): FakeElement { return this.createElement(tagName) }
  createTextNode(value: string): FakeText { return new FakeText(value, this) }
  createComment(value: string): FakeText { return new FakeText(value, this) }
  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener) }
}

let documentStub: FakeDocument
let createRoot: typeof import('react-dom/client').createRoot
const mountedRoots: Root[] = []

beforeAll(async () => {
  documentStub = new FakeDocument()
  const windowStub = documentStub.defaultView
  Object.assign(windowStub, {
    document: documentStub,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLIFrameElement: class extends FakeElement {},
    getSelection: () => null,
  })
  Object.assign(globalThis, {
    React,
    window: windowStub,
    document: documentStub,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  ;({ createRoot } = await import('react-dom/client'))
})

beforeEach(() => {
  vi.clearAllMocks()
  accountMock.selectedAccountId = 'account-a'
  apiMocks.getEvent.mockResolvedValue({ id: 'event-1', name: '相談会', waitlist_enabled: 1 })
  apiMocks.getBookingSummary.mockResolvedValue({
    requested: 0,
    confirmed: 2,
    rejected: 0,
    cancelled: 0,
    expired: 0,
    attended: 0,
    no_show: 0,
    waitlist: 0,
    totalCapacity: 10,
  })
  apiMocks.decideBooking.mockResolvedValue({ ok: true })
  apiMocks.adminCancelBooking.mockResolvedValue({ ok: true })
  apiMocks.listEvents.mockResolvedValue({ items: [], total: 0 })
})

afterEach(async () => {
  await act(async () => {
    while (mountedRoots.length > 0) mountedRoots.pop()?.unmount()
  })
  documentStub.body.textContent = ''
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

async function mount(element: ReactElement) {
  const container = documentStub.createElement('div')
  documentStub.body.appendChild(container)
  const root = createRoot(container as unknown as HTMLElement)
  mountedRoots.push(root)
  await act(async () => { root.render(element) })
  await flush()
  return {
    container,
    root,
    rerender: async (next: ReactElement) => {
      await act(async () => { root.render(next) })
      await flush()
    },
    /*
     * **commit と effect の隙間で応答を返す。** `flushSync` で新しい
     * アカウントの描画だけを確定させ、後片付けの effect がまだ動いて
     * いないところで `duringGap` を呼ぶ。切替の失効が effect 任せだと、
     * この隙間で旧アカウントの応答が「今の宛先」と判断されてしまう。
     */
    commitThen: async (next: ReactElement, duringGap: () => void) => {
      /*
        **`act` や `flushSync` では隙間が作れない。** どちらも描画の
        確定に続けて後片付け(useEffect)まで同じ塊で流してしまう。
        そこで act を外して普通に描画させ、**確定の最中に動く
        `useLayoutEffect`** で合図を取る。合図はマイクロタスクなので、
        後片付け（Reactが次の巡回＝マクロタスクへ積む）より先に戻って
        くる。そこが「Bを描き終えたが後片付けはまだ」の隙間。
      */
      const actEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false)
      try {
        const committed = deferred<void>()
        function CommitProbe(): null {
          React.useLayoutEffect(() => { committed.resolve() }, [])
          return null
        }
        root.render(<>{next}<CommitProbe /></>)
        await committed.promise
        duringGap()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      } finally {
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actEnvironment)
      }
      await flush()
    },
  }
}

function elements(root: FakeNode): FakeElement[] {
  return root.childNodes.flatMap((child) => [
    ...(child instanceof FakeElement ? [child] : []),
    ...elements(child),
  ])
}

function propsOf(element: FakeElement): Record<string, unknown> {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))
  const props = key ? (element as unknown as Record<string, Record<string, unknown>>)[key] : undefined
  if (!props) throw new Error(`React props not found: ${element.tagName}`)
  return props
}

function actionButton(container: FakeElement, bookingId: string, action: string): FakeElement {
  const found = elements(container).find((element) => (
    element.tagName === 'BUTTON'
    && element.getAttribute('data-booking-id') === bookingId
    && element.getAttribute('data-booking-action') === action
  ))
  if (!found) throw new Error(`button not found: ${bookingId}/${action}`)
  return found
}

async function click(button: FakeElement): Promise<void> {
  const onClick = propsOf(button).onClick
  if (typeof onClick !== 'function') throw new Error('button has no onClick')
  await act(async () => {
    onClick({ currentTarget: button, target: button, preventDefault: () => undefined })
  })
  await flush()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function booking(id: string, name: string) {
  return {
    id,
    status: 'confirmed',
    friend_display_name: name,
    friend_name: name,
    line_account_id: accountMock.selectedAccountId,
    requested_at: '2026-09-09T01:00:00Z',
    created_at: '2026-09-09T01:00:00Z',
    slot_starts_at: '2026-09-10T01:00:00Z',
    companion_note: null,
    is_first_time: 1,
  }
}

describe('Issue #684 イベント予約の実操作', () => {
  it('同じ行を連打しても更新は1回だけ送る', async () => {
    const pending = deferred<{ ok: true }>()
    apiMocks.listBookings.mockResolvedValue({ items: [booking('booking-a', '青木さん')], total: 1 })
    apiMocks.updateBooking.mockReturnValue(pending.promise)
    const view = await mount(<EventBookingsPage />)
    const button = actionButton(view.container, 'booking-a', 'attended')
    const onClick = propsOf(button).onClick as (event: unknown) => void

    await act(async () => {
      onClick({})
      onClick({})
    })
    await flush()

    expect(apiMocks.updateBooking).toHaveBeenCalledTimes(1)
    expect(propsOf(actionButton(view.container, 'booking-a', 'attended')).disabled).toBe(true)
    pending.resolve({ ok: true })
    await flush()
  })

  it('別行は並行更新でき、一方の成功で他方の失敗を消さない', async () => {
    const first = deferred<{ ok: true }>()
    const second = deferred<{ ok: true }>()
    apiMocks.listBookings.mockResolvedValue({
      items: [booking('booking-a', '青木さん'), booking('booking-b', '井上さん')],
      total: 2,
    })
    apiMocks.updateBooking.mockImplementation((_accountId: string, _eventId: string, id: string) => (
      id === 'booking-a' ? first.promise : second.promise
    ))
    const view = await mount(<EventBookingsPage />)

    await click(actionButton(view.container, 'booking-a', 'attended'))
    await click(actionButton(view.container, 'booking-b', 'no_show'))
    expect(apiMocks.updateBooking).toHaveBeenCalledTimes(2)

    first.reject(new Error('late failure'))
    await flush()
    expect(view.container.textContent).toContain('来場・不参加の記録を変えられませんでした。')

    second.resolve({ ok: true })
    await flush()
    expect(view.container.textContent).toContain('来場・不参加の記録を変えられませんでした。')
  })

  it('切替前の遅延失敗は、切替後の同じ行の成功表示を上書きしない', async () => {
    const oldFailure = deferred<{ ok: true }>()
    const newSuccess = deferred<{ ok: true }>()
    apiMocks.listBookings.mockImplementation(() => Promise.resolve({
      items: [booking('booking-a', accountMock.selectedAccountId === 'account-a' ? '青木さん' : '井上さん')],
      total: 1,
    }))
    apiMocks.updateBooking.mockImplementation((accountId: string) => (
      accountId === 'account-a' ? oldFailure.promise : newSuccess.promise
    ))
    const view = await mount(<EventBookingsPage />)
    await click(actionButton(view.container, 'booking-a', 'attended'))

    accountMock.selectedAccountId = 'account-b'
    await view.rerender(<EventBookingsPage />)
    await click(actionButton(view.container, 'booking-a', 'attended'))
    newSuccess.resolve({ ok: true })
    await flush()
    oldFailure.reject(new Error('old delayed failure'))
    await flush()

    expect(apiMocks.updateBooking).toHaveBeenCalledTimes(2)
    expect(view.container.textContent).not.toContain('来場・不参加の記録を変えられませんでした。')
  })

  it('切替前に押した成功が後から返っても、切替後の画面へ前のアカウントの予約・件数を入れない', async () => {
    const oldSuccess = deferred<{ ok: true }>()
    // 同じ予約IDを両方に置き、行の書き換えが混ざるかどうかまで見る。
    apiMocks.listBookings.mockImplementation((accountId: string) => Promise.resolve({
      items: [booking('booking-a', accountId === 'account-a' ? '青木さん' : '井上さん')],
      total: 1,
    }))
    apiMocks.getEvent.mockImplementation((accountId: string) => Promise.resolve({
      id: 'event-1',
      name: accountId === 'account-a' ? '相談会A' : '相談会B',
      waitlist_enabled: 1,
    }))
    apiMocks.getBookingSummary.mockImplementation((accountId: string) => Promise.resolve({
      requested: accountId === 'account-a' ? 7 : 0,
      confirmed: 2,
      rejected: 0,
      cancelled: 0,
      expired: 0,
      attended: 0,
      no_show: 0,
      waitlist: 0,
      totalCapacity: 10,
    }))
    apiMocks.updateBooking.mockReturnValue(oldSuccess.promise)

    const view = await mount(<EventBookingsPage />)
    await click(actionButton(view.container, 'booking-a', 'attended'))
    expect(apiMocks.updateBooking).toHaveBeenCalledTimes(1)
    expect(apiMocks.updateBooking.mock.calls[0][0]).toBe('account-a')

    accountMock.selectedAccountId = 'account-b'
    await view.rerender(<EventBookingsPage />)
    expect(view.container.textContent).toContain('井上さん')
    expect(view.container.textContent).toContain('相談会B')

    const callsFor = (mock: { mock: { calls: unknown[][] } }, accountId: string) => (
      mock.mock.calls.filter((call) => call[0] === accountId).length
    )
    const before = {
      list: callsFor(apiMocks.listBookings, 'account-a'),
      event: callsFor(apiMocks.getEvent, 'account-a'),
      summary: callsFor(apiMocks.getBookingSummary, 'account-a'),
    }

    // ここでようやく旧アカウントの更新が成功で返る。
    oldSuccess.resolve({ ok: true })
    await flush()

    // 前のアカウントの取り直しも集計も走らせない。
    expect(callsFor(apiMocks.listBookings, 'account-a')).toBe(before.list)
    expect(callsFor(apiMocks.getEvent, 'account-a')).toBe(before.event)
    expect(callsFor(apiMocks.getBookingSummary, 'account-a')).toBe(before.summary)
    // 画面はBのまま。Aの予約者・イベント名・承認待ち件数を出さない。
    expect(view.container.textContent).toContain('井上さん')
    expect(view.container.textContent).not.toContain('青木さん')
    expect(view.container.textContent).toContain('相談会B')
    expect(view.container.textContent).not.toContain('相談会A')
    expect(view.container.textContent).toContain('確認待ちはありません')
    expect(view.container.textContent).not.toContain('対応が必要：7件を確認してください')
    // Bの行を勝手に参加済へ書き換えない（書き換わると操作ボタンが消える）。
    expect(() => actionButton(view.container, 'booking-a', 'attended')).not.toThrow()
    expect(propsOf(actionButton(view.container, 'booking-a', 'attended')).disabled).toBe(false)
    expect(view.container.textContent).not.toContain('来場・不参加の記録を変えられませんでした。')
  })

  it('切替の描画が確定した直後、後片付けが走る前にAの成功が返っても混ざらない', async () => {
    const oldSuccess = deferred<{ ok: true }>()
    apiMocks.listBookings.mockImplementation((accountId: string) => Promise.resolve({
      items: [booking('booking-a', accountId === 'account-a' ? '青木さん' : '井上さん')],
      total: 1,
    }))
    apiMocks.getEvent.mockImplementation((accountId: string) => Promise.resolve({
      id: 'event-1',
      name: accountId === 'account-a' ? '相談会A' : '相談会B',
      waitlist_enabled: 1,
    }))
    apiMocks.getBookingSummary.mockImplementation((accountId: string) => Promise.resolve({
      requested: accountId === 'account-a' ? 7 : 0,
      confirmed: 2,
      rejected: 0,
      cancelled: 0,
      expired: 0,
      attended: 0,
      no_show: 0,
      waitlist: 0,
      totalCapacity: 10,
    }))
    apiMocks.updateBooking.mockReturnValue(oldSuccess.promise)

    const view = await mount(<EventBookingsPage />)
    await click(actionButton(view.container, 'booking-a', 'attended'))
    expect(apiMocks.updateBooking).toHaveBeenCalledTimes(1)

    const callsFor = (mock: { mock: { calls: unknown[][] } }, accountId: string) => (
      mock.mock.calls.filter((call) => call[0] === accountId).length
    )
    const before = {
      list: callsFor(apiMocks.listBookings, 'account-a'),
      event: callsFor(apiMocks.getEvent, 'account-a'),
      summary: callsFor(apiMocks.getBookingSummary, 'account-a'),
    }

    /*
      Bの描画を確定させたその場で、まだ後片付けが動いていないうちに
      旧Aの更新が成功で返る。失効が描画の時点で効いていないと、
      ここで旧Aの宛先が「今の宛先」と読まれる。
    */
    accountMock.selectedAccountId = 'account-b'
    await view.commitThen(<EventBookingsPage />, () => {
      oldSuccess.resolve({ ok: true })
    })

    expect(callsFor(apiMocks.listBookings, 'account-a')).toBe(before.list)
    expect(callsFor(apiMocks.getEvent, 'account-a')).toBe(before.event)
    expect(callsFor(apiMocks.getBookingSummary, 'account-a')).toBe(before.summary)
    expect(view.container.textContent).toContain('井上さん')
    expect(view.container.textContent).not.toContain('青木さん')
    expect(view.container.textContent).toContain('相談会B')
    expect(view.container.textContent).not.toContain('相談会A')
    expect(view.container.textContent).toContain('確認待ちはありません')
    expect(view.container.textContent).not.toContain('対応が必要：7件を確認してください')
    expect(() => actionButton(view.container, 'booking-a', 'attended')).not.toThrow()
    expect(propsOf(actionButton(view.container, 'booking-a', 'attended')).disabled).toBe(false)
    expect(view.container.textContent).not.toContain('来場・不参加の記録を変えられませんでした。')
  })

  it('切り替えて戻ったあとの押し直しを、前の応答が終わらせない', async () => {
    const stale = deferred<{ ok: true }>()
    const fresh = deferred<{ ok: true }>()
    let updateCalls = 0
    apiMocks.listBookings.mockImplementation((accountId: string) => Promise.resolve({
      items: [booking('booking-a', accountId === 'account-a' ? '青木さん' : '井上さん')],
      total: 1,
    }))
    apiMocks.updateBooking.mockImplementation(() => {
      updateCalls += 1
      return updateCalls === 1 ? stale.promise : fresh.promise
    })

    const view = await mount(<EventBookingsPage />)
    await click(actionButton(view.container, 'booking-a', 'attended'))

    accountMock.selectedAccountId = 'account-b'
    await view.rerender(<EventBookingsPage />)
    accountMock.selectedAccountId = 'account-a'
    await view.rerender(<EventBookingsPage />)

    // 切替で世代が変わったので、同じ行をもう一度押せる。
    expect(propsOf(actionButton(view.container, 'booking-a', 'attended')).disabled).toBe(false)
    await click(actionButton(view.container, 'booking-a', 'attended'))
    expect(updateCalls).toBe(2)

    // 前の世代の応答は、今の「記録中…」を解かない。
    stale.resolve({ ok: true })
    await flush()
    expect(propsOf(actionButton(view.container, 'booking-a', 'attended')).disabled).toBe(true)

    fresh.resolve({ ok: true })
    await flush()
    expect(view.container.textContent).not.toContain('来場・不参加の記録を変えられませんでした。')
  })

  it('一覧上部の件数は「表示のみ」で、タブやボタンとして扱わない', async () => {
    const view = await mount(<EventsListPage />)
    const summary = elements(view.container).find((element) => (
      element.getAttribute('data-event-count-summary') !== null
    ))
    expect(summary).toBeDefined()
    expect(summary?.getAttribute('aria-label')).toBe('一覧の集計（表示のみ）')
    expect(summary?.textContent).toContain('一覧の集計（表示のみ）')
    expect(summary && elements(summary).some((element) => ['BUTTON', 'A'].includes(element.tagName))).toBe(false)
  })
})
