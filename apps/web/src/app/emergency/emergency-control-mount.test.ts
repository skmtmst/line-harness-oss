/*
 * N-453/N-455 の実挙動試験。**画面部品ではなく `EmergencyControlPanel` 本体を
 * 実際に mount して操作する。**
 *
 * ここで検証するのは、文字列でも関数の呼び出し順でもなく「運用者が押せるか」
 * 「押した結果として口を叩くか」。そのため、この工程には本物の React 描画と
 * 本物の Promise が要る。
 *
 * この作業台（`installReactHost` 以下）が自前なのは、この置き場に DOM の実装
 * （jsdom など）が入っていないため。入れるには `apps/web/package.json` と
 * `pnpm-lock.yaml` を触ることになり、どちらもこのIssueの所有パスの外にある。
 * そこで React DOM が実際に使う口だけを、この試験の中に閉じて用意した。
 * 使う側から見える動きはブラウザに合わせてある。
 *
 *   - `disabled` の部品と `pointer-events-none` の区画は、押しても何も起きない
 *   - `click` / `input` / `change` は祖先へ伝わり、React の委譲listenerが受ける
 *   - `useEffect` も状態更新も本物。`act` で描き終わりまで待つ
 *
 * これにより「Aの遅い応答がBを上書きしない」「409のあと全部の変更操作が止まる」
 * を、実際に押して確かめられる。
 */
import { act } from 'react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LineAccount } from '@line-crm/shared'
import type { OperationControl, OperationImpactPreview } from '@/lib/api'

// ---------------------------------------------------------------------------
// 口の差し替え
// ---------------------------------------------------------------------------

type PreviewPayload = {
  control: OperationControl
  counts: Record<string, number>
  impact: OperationImpactPreview
  permissions: { canControl: boolean; reasonCode?: string | null }
  calculatedAt: string
}

type PreviewResponse = { success: true; data: PreviewPayload }

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const bench = vi.hoisted(() => {
  const previewCalls: Array<{ accountId: string | null; deferred: Deferred<unknown> }> = []
  const stopCalls: Array<{ lineAccountId: string | null; expectedVersion: number }> = []
  const restoreCalls: Array<{ incidentId: string }> = []
  const stepUpCalls: string[] = []
  return {
    previewCalls,
    stopCalls,
    restoreCalls,
    stepUpCalls,
    stopResult: null as null | (() => Promise<unknown>),
    restoreResult: null as null | (() => Promise<unknown>),
  }
})

vi.mock('next/link', async () => {
  const react = await import('react')
  return {
    default: (props: { href: string; children?: unknown; className?: string }) =>
      react.createElement('a', { href: String(props.href), className: props.className }, props.children as never),
  }
})

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      operations: {
        ...actual.api.operations,
        preview: (accountId: string | null) => {
          const call = { accountId, deferred: deferred<unknown>() }
          bench.previewCalls.push(call)
          return call.deferred.promise as Promise<never>
        },
        stepUp: (code: string) => {
          bench.stepUpCalls.push(code)
          return Promise.resolve({
            success: true as const,
            data: { token: 'step-up-token', purpose: 'operations.control' as const, expiresAt: '2026-09-09T00:05:00.000Z' },
          }) as Promise<never>
        },
        stop: (input: { lineAccountId: string | null; expectedVersion: number }) => {
          bench.stopCalls.push({ lineAccountId: input.lineAccountId, expectedVersion: input.expectedVersion })
          return (bench.stopResult?.() ?? Promise.reject(new Error('stop は用意されていません'))) as Promise<never>
        },
        restore: (incidentId: string) => {
          bench.restoreCalls.push({ incidentId })
          return (bench.restoreResult?.() ?? Promise.reject(new Error('restore は用意されていません'))) as Promise<never>
        },
      },
    },
  }
})

// ---------------------------------------------------------------------------
// React を実際に動かすための最小の作業台
// ---------------------------------------------------------------------------

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const DOCUMENT_NODE = 9

type ListenerOptions = boolean | { capture?: boolean; passive?: boolean } | undefined
type DomListener = (event: FakeEvent) => void

class FakeEventTarget {
  private handlers = new Map<string, Set<DomListener>>()

  private key(type: string, options: ListenerOptions) {
    const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture)
    return `${type} ${capture ? 'capture' : 'bubble'}`
  }

  addEventListener(type: string, listener: DomListener, options?: ListenerOptions) {
    const key = this.key(type, options)
    let set = this.handlers.get(key)
    if (!set) {
      set = new Set()
      this.handlers.set(key, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: DomListener, options?: ListenerOptions) {
    this.handlers.get(this.key(type, options))?.delete(listener)
  }

  listenersFor(type: string, capture: boolean): DomListener[] {
    return [...(this.handlers.get(`${type} ${capture ? 'capture' : 'bubble'}`) ?? [])]
  }
}

/** ブラウザのイベントに合わせた最小の形。React はこの上に合成イベントを作る。 */
class FakeEvent {
  type: string
  target: FakeElement | null = null
  currentTarget: FakeEventTarget | null = null
  bubbles = true
  cancelable = true
  defaultPrevented = false
  isTrusted = true
  eventPhase = 0
  timeStamp = 0
  detail = 0
  button = 0
  buttons = 0
  clientX = 0
  clientY = 0
  screenX = 0
  screenY = 0
  pageX = 0
  pageY = 0
  altKey = false
  ctrlKey = false
  metaKey = false
  shiftKey = false
  relatedTarget: FakeElement | null = null
  view: unknown = null
  propagationStopped = false

  constructor(type: string) {
    this.type = type
  }

  preventDefault() {
    this.defaultPrevented = true
  }

  stopPropagation() {
    this.propagationStopped = true
  }

  stopImmediatePropagation() {
    this.propagationStopped = true
  }

  getModifierState() {
    return false
  }
}

class FakeNode extends FakeEventTarget {
  nodeType = ELEMENT_NODE
  childNodes: FakeNode[] = []
  parentNode: FakeNode | null = null
  ownerDocument: FakeDocument | null = null

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null
  }

  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode?.removeChild(child)
    this.childNodes.push(child)
    child.parentNode = this
    return child
  }

  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    if (!before) return this.appendChild(child)
    child.parentNode?.removeChild(child)
    const index = this.childNodes.indexOf(before)
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child)
    child.parentNode = this
    return child
  }

  removeChild<T extends FakeNode>(child: T): T {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  contains(node: FakeNode | null): boolean {
    for (let current = node; current; current = current.parentNode) if (current === this) return true
    return false
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    for (const child of [...this.childNodes]) this.removeChild(child)
    if (value !== '' && value !== null && value !== undefined) {
      this.appendChild(this.ownerDocument!.createTextNode(String(value)))
    }
  }
}

class FakeText extends FakeNode {
  nodeType = TEXT_NODE
  nodeValue: string

  constructor(value: string, ownerDocument: FakeDocument) {
    super()
    this.nodeValue = value
    this.ownerDocument = ownerDocument
  }

  get data() {
    return this.nodeValue
  }

  set data(value: string) {
    this.nodeValue = value
  }

  override get textContent(): string {
    return this.nodeValue
  }

  override set textContent(value: string) {
    this.nodeValue = value
  }
}

class FakeStyle {
  [property: string]: unknown

  setProperty(name: string, value: string) {
    this[name] = value
  }

  removeProperty(name: string) {
    delete this[name]
  }

  getPropertyValue(name: string) {
    return (this[name] as string | undefined) ?? ''
  }
}

class FakeElement extends FakeNode {
  tagName: string
  namespaceURI: string
  attributes = new Map<string, string>()
  style = new FakeStyle()

  constructor(tagName: string, ownerDocument: FakeDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super()
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
  }

  get nodeName() {
    return this.tagName
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node.nodeType === ELEMENT_NODE)
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value))
    /*
     * React はイベントを使えるかどうかを `oninput` などの属性で試す。
     * ブラウザは `on*` 属性を関数に変えて持つので、そこだけ合わせる。
     * これが無いと React は `input` を使えないと判断し、入力欄の
     * `onChange` が古い代替経路へ落ちて動かない。
     */
    if (name.startsWith('on')) (this as unknown as Record<string, unknown>)[name] = () => {}
  }

  setAttributeNS(_namespace: string | null, name: string, value: string) {
    this.setAttribute(name.split(':').pop()!, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  removeAttributeNS(_namespace: string | null, name: string) {
    this.removeAttribute(name.split(':').pop()!)
  }

  hasAttribute(name: string) {
    return this.attributes.has(name)
  }

  get className() {
    return this.getAttribute('class') ?? ''
  }

  set className(value: string) {
    this.setAttribute('class', value)
  }

  get id() {
    return this.getAttribute('id') ?? ''
  }

  set id(value: string) {
    this.setAttribute('id', value)
  }

  focus() {
    this.ownerDocument!.activeElement = this
  }

  blur() {
    if (this.ownerDocument!.activeElement === this) this.ownerDocument!.activeElement = this.ownerDocument!.body
  }
}

class FakeFormElement extends FakeElement {
  private currentValue = ''
  private currentChecked = false
  defaultValue = ''
  defaultChecked = false
  selectionStart: number | null = 0
  selectionEnd: number | null = 0

  get value(): string {
    return this.currentValue
  }

  set value(next: string) {
    this.currentValue = next === null || next === undefined ? '' : String(next)
  }

  get checked(): boolean {
    return this.currentChecked
  }

  set checked(next: boolean) {
    this.currentChecked = Boolean(next)
  }

  get type(): string {
    return this.getAttribute('type') ?? (this.tagName === 'INPUT' ? 'text' : '')
  }

  set type(next: string) {
    this.setAttribute('type', next)
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled')
  }

  set disabled(next: boolean) {
    if (next) this.setAttribute('disabled', '')
    else this.removeAttribute('disabled')
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start
    this.selectionEnd = end
  }
}

class FakeOptionElement extends FakeElement {
  selected = false
  defaultSelected = false
  private explicitValue: string | null = null

  get value(): string {
    return this.explicitValue ?? this.textContent
  }

  set value(next: string) {
    this.explicitValue = next === null || next === undefined ? '' : String(next)
  }
}

class FakeSelectElement extends FakeElement {
  multiple = false
  size = 0
  private explicitValue: string | null = null

  get options(): FakeOptionElement[] {
    const found: FakeOptionElement[] = []
    const walk = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child instanceof FakeOptionElement) found.push(child)
        else walk(child)
      }
    }
    walk(this)
    return found
  }

  get value(): string {
    const selected = this.options.find((option) => option.selected)
    if (selected) return selected.value
    if (this.explicitValue !== null) return this.explicitValue
    return this.options[0]?.value ?? ''
  }

  set value(next: string) {
    this.explicitValue = next === null || next === undefined ? '' : String(next)
    for (const option of this.options) option.selected = option.value === this.explicitValue
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled')
  }

  set disabled(next: boolean) {
    if (next) this.setAttribute('disabled', '')
    else this.removeAttribute('disabled')
  }
}

class FakeDocument extends FakeEventTarget {
  nodeType = DOCUMENT_NODE
  ownerDocument: FakeDocument | null = null
  defaultView: FakeWindow | null = null
  documentElement: FakeElement
  body: FakeElement
  head: FakeElement
  activeElement: FakeElement | null = null

  constructor() {
    super()
    this.documentElement = this.createElement('html')
    this.head = this.createElement('head')
    this.body = this.createElement('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.activeElement = this.body
  }

  createElement(tagName: string): FakeElement {
    const lower = tagName.toLowerCase()
    if (lower === 'input' || lower === 'textarea') return new FakeFormElement(lower, this)
    if (lower === 'select') return new FakeSelectElement(lower, this)
    if (lower === 'option') return new FakeOptionElement(lower, this)
    return new FakeElement(lower, this)
  }

  createElementNS(namespaceURI: string, tagName: string): FakeElement {
    const element = this.createElement(tagName)
    element.namespaceURI = namespaceURI
    return element
  }

  createTextNode(value: string): FakeText {
    return new FakeText(String(value), this)
  }

  createComment(value: string): FakeText {
    return new FakeText(String(value), this)
  }
}

class FakeWindow extends FakeEventTarget {
  document: FakeDocument
  HTMLIFrameElement = class HTMLIFrameElement {}
  location = { href: 'http://localhost/emergency' }

  constructor(document: FakeDocument) {
    super()
    this.document = document
  }

  getSelection() {
    return null
  }
}

// ---------------------------------------------------------------------------
// 探す・押す
// ---------------------------------------------------------------------------

function allElements(root: FakeNode): FakeElement[] {
  const found: FakeElement[] = []
  const walk = (node: FakeNode) => {
    for (const child of node.childNodes) {
      if (child.nodeType === ELEMENT_NODE) {
        found.push(child as FakeElement)
        walk(child)
      }
    }
  }
  walk(root)
  return found
}

function button(root: FakeNode, label: string): FakeElement {
  const found = allElements(root).find((element) => element.tagName === 'BUTTON' && element.textContent.trim() === label)
  if (!found) throw new Error(`ボタンが見つかりません: ${label}`)
  return found
}

function optionalButton(root: FakeNode, label: string): FakeElement | null {
  return allElements(root).find((element) => element.tagName === 'BUTTON' && element.textContent.trim() === label) ?? null
}

function byId(root: FakeNode, id: string): FakeElement {
  const found = allElements(root).find((element) => element.getAttribute('id') === id)
  if (!found) throw new Error(`要素が見つかりません: #${id}`)
  return found
}

function dialogs(root: FakeNode): FakeElement[] {
  return allElements(root).filter((element) => element.getAttribute('role') === 'dialog')
}

/*
 * 画面を覆う層。`fixed inset-0` は viewport 全面を覆うので、その外側は
 * 運用者から見えないし押せない。DOM全体の textContent は「裏に文字がある」
 * ことしか言わないため、見えているかどうかはこの覆いで判定する。
 */
function overlay(root: FakeNode): FakeElement | null {
  return allElements(root).find((element) => {
    const classes = element.className.split(/\s+/)
    return classes.includes('fixed') && classes.includes('inset-0')
  }) ?? null
}

/** 運用者に実際に見えている文字だけ。覆いがあれば覆いの中だけ。 */
function visibleText(root: FakeElement): string {
  const covering = overlay(root)
  return covering ? covering.textContent : root.textContent
}

/**
 * 画面のいちばん上に出る知らせの帯。停止不可の欄（`role="status"`）とは別物で、
 * 押した直後に目に入るのはこちら。ここに理由が載っているかを別に確かめる。
 */
function noticeBanner(root: FakeNode): FakeElement | null {
  return allElements(root).find((element) =>
    element.tagName === 'DIV'
    && element.className.split(/\s+/).includes('rounded-control')
    && (element.firstChild as FakeElement | null)?.tagName === 'P') ?? null
}

function checkboxes(root: FakeNode): FakeElement[] {
  return allElements(root).filter((element) => element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox')
}

/** `disabled` と `pointer-events-none` はブラウザと同じく操作を飲み込む。 */
function isBlocked(node: FakeElement): boolean {
  for (let current: FakeNode | null = node; current; current = current.parentNode) {
    if (current.nodeType !== ELEMENT_NODE) continue
    const element = current as FakeElement
    if (element.hasAttribute('disabled')) return true
    if (element.className.split(/\s+/).includes('pointer-events-none')) return true
  }
  return false
}

function dispatch(node: FakeElement, event: FakeEvent) {
  event.target = node
  const path: FakeEventTarget[] = []
  for (let current: FakeNode | null = node; current; current = current.parentNode) path.push(current)
  path.push(node.ownerDocument!)
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (event.propagationStopped) return
    event.currentTarget = path[index]
    for (const listener of path[index].listenersFor(event.type, true)) listener(event)
  }
  if (!event.bubbles) return
  for (const target of path) {
    if (event.propagationStopped) return
    event.currentTarget = target
    for (const listener of target.listenersFor(event.type, false)) listener(event)
  }
}

/** 描き終わりと、待っている Promise の続きまで進める。 */
async function settle(work?: () => void) {
  await act(async () => {
    work?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 押せたら true。押せない（disabled / pointer-events-none）なら false。 */
async function click(node: FakeElement): Promise<boolean> {
  if (isBlocked(node)) return false
  await settle(() => dispatch(node, new FakeEvent('click')))
  return true
}

/*
 * React は入力欄の `value` を自前の見張りで包み、値が変わったときだけ
 * `onChange` を通す。試験から `node.value = ...` と書くとその見張りごと
 * 更新してしまい「変わっていない」と見なされる。ブラウザの入力と同じく、
 * 見張りの下（プロトタイプの setter）へ直接書き込む。
 */
function setNativeValue(node: FakeElement, value: string) {
  for (let proto = Object.getPrototypeOf(node); proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) {
      descriptor.set.call(node, value)
      return
    }
  }
  throw new Error('value を書き込めません')
}

async function type(node: FakeElement, value: string): Promise<boolean> {
  if (isBlocked(node)) return false
  setNativeValue(node, value)
  await settle(() => dispatch(node, new FakeEvent('input')))
  return true
}

async function choose(node: FakeElement, value: string): Promise<boolean> {
  if (isBlocked(node)) return false
  setNativeValue(node, value)
  await settle(() => dispatch(node, new FakeEvent('change')))
  return true
}

type Host = {
  container: FakeElement
  text: () => string
  visibleText: () => string
  unmount: () => void
}

async function installReactHost(accounts: LineAccount[]): Promise<Host> {
  const document = new FakeDocument()
  const window = new FakeWindow(document)
  document.defaultView = window
  const container = document.createElement('div')
  document.body.appendChild(container)

  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = window
  globals.document = document
  globals.Element = FakeElement
  globals.Node = FakeNode
  globals.HTMLElement = FakeElement
  globals.IS_REACT_ACT_ENVIRONMENT = true

  /*
   * この置き場の tsconfig は `jsx: preserve` なので、試験の変換だけ古い形
   * （`React.createElement`）になる。Next の本番変換は新しい形で React を
   * 取り込むが、ここでは取り込まれない。部品側を触らずに動かすため、
   * React を大域に置く。画面の作りには影響しない。
   */
  globals.React = await import('react')

  const { createRoot } = await import('react-dom/client')
  const EmergencyPage = (await import('./page')).default
  const { EmergencyControlPanel } = EmergencyPage.__test

  const root = createRoot(container as unknown as Element)
  await settle(() => {
    root.render(createElement(EmergencyControlPanel, { accounts }))
  })

  return {
    container,
    text: () => container.textContent,
    visibleText: () => visibleText(container),
    unmount: () => {
      act(() => {
        root.unmount()
      })
    },
  }
}

// ---------------------------------------------------------------------------
// 口が返す形
// ---------------------------------------------------------------------------

const ACCOUNTS = [
  { id: 'acc-a', name: 'Aアカウント' },
  { id: 'acc-b', name: 'Bアカウント' },
] as unknown as LineAccount[]

function previewPayload(options: {
  mark: number
  accountId?: string | null
  canControl?: boolean
  reasonCode?: string | null
  version?: number
  activeIncidentId?: string | null
}): PreviewPayload {
  const { mark, accountId = null, canControl = true, reasonCode = null, version = 3, activeIncidentId = null } = options
  const metric = (itemCount: number) => ({ itemCount, friendCount: itemCount * 2, pendingCount: 0 })
  return {
    control: {
      scopeKey: accountId ?? 'all',
      lineAccountId: accountId,
      version,
      states: {
        broadcast_dispatch: 'running',
        scenario_dispatch: 'running',
        reminder_dispatch: 'running',
        automation_actions: 'running',
        auto_reply_dispatch: 'running',
        webhook_outgoing: 'running',
        ad_postback: 'running',
      },
      activeIncidentId,
      reason: null,
      actorId: null,
      stoppedAt: null,
      updatedAt: '2026-09-09T00:00:00.000Z',
    },
    counts: {},
    impact: {
      broadcast_dispatch: metric(mark),
      scenario_dispatch: metric(mark + 1),
      reminder_dispatch: metric(mark + 2),
      automation_actions: metric(mark + 3),
      auto_reply_dispatch: metric(mark + 4),
    },
    permissions: { canControl, reasonCode },
    calculatedAt: '2026-09-09T00:00:00.000Z',
  }
}

async function answerPreview(index: number, payload: PreviewPayload) {
  const call = bench.previewCalls[index]
  if (!call) throw new Error(`preview の ${index} 回目が呼ばれていません`)
  await settle(() => call.deferred.resolve({ success: true, data: payload } satisfies PreviewResponse))
}

async function failPreview(index: number, error: unknown) {
  const call = bench.previewCalls[index]
  if (!call) throw new Error(`preview の ${index} 回目が呼ばれていません`)
  await settle(() => call.deferred.reject(error))
}

/** 最終確認と本人確認を通して停止まで進める。 */
async function runStopFlow(host: Host) {
  expect(await click(button(host.container, '緊急停止する'))).toBe(true)
  await type(byId(host.container, 'emergency-confirm-word'), '停止')
  expect(await click(button(host.container, '配信を緊急停止する'))).toBe(true)
  await type(byId(host.container, 'emergency-step-up-code'), '123456')
  expect(await click(button(host.container, '本人確認して停止'))).toBe(true)
}

beforeEach(() => {
  bench.previewCalls.length = 0
  bench.stopCalls.length = 0
  bench.restoreCalls.length = 0
  bench.stepUpCalls.length = 0
  bench.stopResult = null
  bench.restoreResult = null
})

// ---------------------------------------------------------------------------

describe('EmergencyControlPanel を実際に mount して操作する', () => {
  it('Aの遅い応答は、Bへ切り替えたあとの画面を上書きしない（account境界と権限）', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 900 }))

    const accountSelect = byId(host.container, 'emergency-account')
    expect(await choose(accountSelect, 'acc-a')).toBe(true)
    expect(await choose(byId(host.container, 'emergency-account'), 'acc-b')).toBe(true)

    const forA = bench.previewCalls.findIndex((call) => call.accountId === 'acc-a')
    const forB = bench.previewCalls.findIndex((call) => call.accountId === 'acc-b')
    expect(forA).toBeGreaterThanOrEqual(0)
    expect(forB).toBeGreaterThan(forA)

    // Bが先に返り、Aがあとから返る（逆順応答）。
    await answerPreview(forB, previewPayload({ mark: 222, accountId: 'acc-b', canControl: false, reasonCode: 'EMERGENCY_SCOPE_FORBIDDEN' }))
    await answerPreview(forA, previewPayload({ mark: 111, accountId: 'acc-a', canControl: true }))

    const text = host.text()
    expect(text).toContain('222件')
    expect(text).not.toContain('111件')
    expect(text).toContain('Bアカウント')
    // Bの権限がそのまま効く。Aの canControl:true で上書きされない。
    expect(text).toContain('この範囲を操作する権限がありません')
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(true)
    expect(await click(button(host.container, '緊急停止する'))).toBe(false)
    expect(dialogs(host.container)).toHaveLength(0)

    host.unmount()
  })

  it('停止の403は、本人確認の窓を閉じて理由を前面に出し、送り直せなくする', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 400 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(403, 'forbidden', 'EMERGENCY_CONTROL_FORBIDDEN'))

    // 送る直前は本人確認の窓が前面にあり、後ろは見えていない。
    await click(button(host.container, '緊急停止する'))
    await type(byId(host.container, 'emergency-confirm-word'), '停止')
    await click(button(host.container, '配信を緊急停止する'))
    await type(byId(host.container, 'emergency-step-up-code'), '123456')
    expect(host.visibleText()).toContain('認証アプリで本人確認')
    expect(host.visibleText()).not.toContain('止めるとどうなるか')

    expect(await click(button(host.container, '本人確認して停止'))).toBe(true)
    expect(bench.stopCalls).toHaveLength(1)

    // 窓が閉じ、理由と次の行動が覆いの裏ではなく前面に出る。
    expect(dialogs(host.container)).toHaveLength(0)
    expect(overlay(host.container)).toBeNull()
    const visible = host.visibleText()
    expect(visible).toContain('緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。')
    expect(visible).toContain('いまは緊急停止できません')
    // 帯にも、停止不可の欄にも、口の機械コードから引いた理由が載る。
    expect(noticeBanner(host.container)?.textContent).toContain('緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。')
    // 403は競合ではないので、読み直しは求めない。
    expect(optionalButton(host.container, '最新の状態を読み直す')).toBeNull()

    // 送り直せない。入力も要求鍵も残っていない。
    expect(optionalButton(host.container, '本人確認して停止')).toBeNull()
    expect(allElements(host.container).some((element) => element.getAttribute('id') === 'emergency-step-up-code')).toBe(false)
    expect(allElements(host.container).some((element) => element.getAttribute('id') === 'emergency-confirm-word')).toBe(false)
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(true)
    expect(await click(button(host.container, '緊急停止する'))).toBe(false)
    expect(dialogs(host.container)).toHaveLength(0)
    expect(bench.stopCalls).toHaveLength(1)
    expect(bench.stepUpCalls).toHaveLength(1)

    host.unmount()
  })

  it('復旧の403も同じく窓を閉じ、範囲の理由を前面に出して送り直せなくする', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 700, activeIncidentId: 'incident-9' }))
    const { ApiError } = await import('@/lib/api')
    bench.restoreResult = () => Promise.reject(new ApiError(403, 'forbidden', 'EMERGENCY_SCOPE_FORBIDDEN'))

    expect(await click(button(host.container, '復旧する'))).toBe(true)
    await type(byId(host.container, 'emergency-confirm-word'), '復旧')
    expect(await click(button(host.container, '復旧を実行する'))).toBe(true)
    await type(byId(host.container, 'emergency-step-up-code'), '123456')
    expect(host.visibleText()).toContain('認証アプリで本人確認')
    expect(await click(button(host.container, '本人確認して復旧'))).toBe(true)

    expect(bench.restoreCalls).toHaveLength(1)
    expect(dialogs(host.container)).toHaveLength(0)
    expect(overlay(host.container)).toBeNull()
    expect(host.visibleText()).toContain('この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。')
    expect(noticeBanner(host.container)?.textContent).toContain('この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。')
    expect(optionalButton(host.container, '本人確認して復旧')).toBeNull()
    expect(button(host.container, '復旧する').hasAttribute('disabled')).toBe(true)
    expect(await click(button(host.container, '復旧する'))).toBe(false)
    expect(bench.restoreCalls).toHaveLength(1)

    host.unmount()
  })

  it('409はモーダルを閉じ、古い確認内容を捨て、すべての変更操作を止める', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    expect(host.text()).toContain('111件')
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(409, '別の管理者が先に変更しました。最新の状態を読み直してください。', 'VERSION_CONFLICT'))

    await runStopFlow(host)

    expect(bench.stopCalls).toHaveLength(1)
    expect(dialogs(host.container)).toHaveLength(0)
    expect(overlay(host.container)).toBeNull()
    expect(host.visibleText()).toContain('別の管理者が先に変更しました')
    expect(host.text()).not.toContain('111件')
    expect(optionalButton(host.container, '最新の状態を読み直す')).not.toBeNull()

    // 全変更操作のlock。押しても口を叩かない。
    const previewCallsBefore = bench.previewCalls.length
    for (const box of checkboxes(host.container)) expect(await click(box)).toBe(false)
    expect(await choose(byId(host.container, 'emergency-account'), 'acc-a')).toBe(false)
    expect(await type(byId(host.container, 'emergency-detail'), '書き換え')).toBe(false)
    expect(await choose(byId(host.container, 'emergency-reason'), 'メンテナンス')).toBe(false)
    expect(await click(button(host.container, '緊急停止する'))).toBe(false)
    expect(await click(button(host.container, 'キャンセル'))).toBe(false)
    expect(bench.stopCalls).toHaveLength(1)
    expect(bench.stepUpCalls).toHaveLength(1)
    expect(bench.restoreCalls).toHaveLength(0)
    expect(bench.previewCalls).toHaveLength(previewCallsBefore)
    expect(dialogs(host.container)).toHaveLength(0)

    host.unmount()
  })

  it('再読込が成功すればlockを解き、最新の内容で確認をやり直せる', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(409, '別の管理者が先に変更しました。最新の状態を読み直してください。', 'VERSION_CONFLICT'))
    await runStopFlow(host)

    const reloadIndex = bench.previewCalls.length
    expect(await click(button(host.container, '最新の状態を読み直す'))).toBe(true)
    expect(bench.previewCalls).toHaveLength(reloadIndex + 1)
    await answerPreview(reloadIndex, previewPayload({ mark: 333, version: 9 }))

    expect(host.text()).toContain('最新の状態を読み直しました')
    expect(host.text()).toContain('333件')
    expect(host.text()).not.toContain('111件')
    expect(optionalButton(host.container, '最新の状態を読み直す')).toBeNull()
    expect(byId(host.container, 'emergency-account').hasAttribute('disabled')).toBe(false)
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(false)

    // 再試行。最終確認には読み直したあとの内容だけが出る。
    expect(await click(button(host.container, '緊急停止する'))).toBe(true)
    expect(dialogs(host.container)).toHaveLength(1)
    const dialogText = dialogs(host.container)[0].textContent
    expect(dialogText).toContain('333件')
    expect(dialogText).not.toContain('111件')

    bench.stopResult = () =>
      Promise.resolve({
        success: true as const,
        data: {
          status: 'changed' as const,
          control: previewPayload({ mark: 333, version: 10, activeIncidentId: 'incident-1' }).control,
          incident: { id: 'incident-1' },
        },
      })
    await type(byId(host.container, 'emergency-confirm-word'), '停止')
    expect(await click(button(host.container, '配信を緊急停止する'))).toBe(true)
    await type(byId(host.container, 'emergency-step-up-code'), '123456')
    expect(await click(button(host.container, '本人確認して停止'))).toBe(true)

    expect(bench.stopCalls).toHaveLength(2)
    // やり直しは読み直した後の版で送る。古い版のままではない。
    expect(bench.stopCalls[1].expectedVersion).toBe(9)
    expect(host.text()).toContain('サーバー共通の停止状態を更新しました')

    host.unmount()
  })

  it('再読込に失敗しても古い確認内容は戻さず、読み直しの導線を残す', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(409, '別の管理者が先に変更しました。最新の状態を読み直してください。', 'VERSION_CONFLICT'))
    await runStopFlow(host)

    const reloadIndex = bench.previewCalls.length
    expect(await click(button(host.container, '最新の状態を読み直す'))).toBe(true)
    await failPreview(reloadIndex, new Error('network down'))

    const text = host.text()
    expect(text).toContain('最新の状態を読み直せませんでした')
    expect(text).not.toContain('111件')
    expect(text).toContain('停止状態を確認できないため、停止・復旧を実行できません')
    expect(optionalButton(host.container, '最新の状態を読み直す')).not.toBeNull()
    expect(dialogs(host.container)).toHaveLength(0)
    // 失敗のあとも変更操作は止めたまま。
    for (const box of checkboxes(host.container)) expect(await click(box)).toBe(false)
    expect(await click(button(host.container, '緊急停止する'))).toBe(false)
    expect(bench.stopCalls).toHaveLength(1)

    host.unmount()
  })

  it('失敗のあとに読み直せば、最新の内容だけを出してlockを解く', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(409, '別の管理者が先に変更しました。最新の状態を読み直してください。', 'VERSION_CONFLICT'))
    await runStopFlow(host)

    const firstReload = bench.previewCalls.length
    expect(await click(button(host.container, '最新の状態を読み直す'))).toBe(true)
    await failPreview(firstReload, new Error('network down'))

    const secondReload = bench.previewCalls.length
    expect(await click(button(host.container, '最新の状態を読み直す'))).toBe(true)
    await answerPreview(secondReload, previewPayload({ mark: 555 }))

    const text = host.text()
    expect(text).toContain('最新の状態を読み直しました')
    expect(text).toContain('555件')
    expect(text).not.toContain('111件')
    expect(text).not.toContain('停止状態を確認できないため')
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(false)
    expect(await click(button(host.container, '緊急停止する'))).toBe(true)
    expect(dialogs(host.container)).toHaveLength(1)

    host.unmount()
  })

  it('403・409(版競合)以外の失敗(400)は、窓の裏に隠れず理由が見え、押し直せる', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(400, '認証コードが正しくありません'))

    await click(button(host.container, '緊急停止する'))
    await type(byId(host.container, 'emergency-confirm-word'), '停止')
    await click(button(host.container, '配信を緊急停止する'))
    await type(byId(host.container, 'emergency-step-up-code'), '123456')
    // 送る直前は本人確認の窓が前面にあり、後ろの帯は見えていない。
    expect(host.visibleText()).not.toContain('認証コードが正しくありません')

    expect(await click(button(host.container, '本人確認して停止'))).toBe(true)
    expect(bench.stopCalls).toHaveLength(1)

    // 窓が閉じ、覆いも無くなり、理由が前面(帯)に実際に見える。
    expect(dialogs(host.container)).toHaveLength(0)
    expect(overlay(host.container)).toBeNull()
    expect(host.visibleText()).toContain('認証コードが正しくありません')
    expect(noticeBanner(host.container)?.textContent).toContain('認証コードが正しくありません')

    // 版競合ではないのでpreviewは保持され、読み直しは求めない。全操作もロックしない。
    expect(host.text()).toContain('111件')
    expect(optionalButton(host.container, '最新の状態を読み直す')).toBeNull()
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(false)

    // 押し直せる(403のような恒久ブロックではない)。
    expect(await click(button(host.container, '緊急停止する'))).toBe(true)
    expect(dialogs(host.container)).toHaveLength(1)

    host.unmount()
  })

  it('409でもVERSION_CONFLICT以外(IDEMPOTENCY_CONFLICT)は、別の管理者が変更したと偽らない', async () => {
    const host = await installReactHost(ACCOUNTS)
    await answerPreview(0, previewPayload({ mark: 111 }))
    const { ApiError } = await import('@/lib/api')
    bench.stopResult = () => Promise.reject(new ApiError(409, '同じ再実行キーが別の内容で使われています', 'IDEMPOTENCY_CONFLICT'))

    await runStopFlow(host)

    expect(dialogs(host.container)).toHaveLength(0)
    expect(overlay(host.container)).toBeNull()
    const visible = host.visibleText()
    expect(visible).toContain('同じ再実行キーが別の内容で使われています')
    expect(visible).not.toContain('別の管理者が先に変更しました')

    // 版競合ではないのでpreviewを捨てず、読み直しも求めず、全操作をロックしない。
    expect(host.text()).toContain('111件')
    expect(optionalButton(host.container, '最新の状態を読み直す')).toBeNull()
    expect(button(host.container, '緊急停止する').hasAttribute('disabled')).toBe(false)

    host.unmount()
  })
})
