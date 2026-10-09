/*
 * 試験のためだけの、最小の DOM。
 *
 * Required gate が動かす `pnpm --filter web test` は Node 環境で、DOM は
 * ありません。jsdom を足すには `apps/web/package.json` と `pnpm-lock.yaml`
 * を触ることになり、この Issue の所有パスの外です。**画面本体を実際に
 * mount して確かめるために、React DOM が使う分だけをここに置きます。**
 *
 * 揃えているのは React DOM が触る範囲だけです。汎用の DOM ではありません。
 *   - 節の組み立て（`createElement` / `appendChild` / `insertBefore` …）
 *   - 属性と文字（`setAttribute` / `textContent`）
 *   - 出来事の配り方（捕捉 → 対象 → 浮上）。React は根に1つ聞き耳を
 *     立てて配るので、浮上が無いと `onClick` が呼ばれません。
 *
 * ここに無いものを画面が使い始めたら、その場で落ちます。黙って通り過ぎて
 * 「試験は通るのに画面は壊れている」より、落ちるほうが分かります。
 */

type Listener = (event: DomEvent) => void

export class DomNode {
  readonly nodeType: number
  ownerDocument: DomDocument | null
  parentNode: DomNode | null = null
  childNodes: DomNode[] = []
  nodeValue: string | null = null
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(ownerDocument: DomDocument | null, nodeType: number) {
    this.ownerDocument = ownerDocument
    this.nodeType = nodeType
  }

  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null
  }

  appendChild(child: DomNode): DomNode {
    return this.insertBefore(child, null)
  }

  insertBefore(child: DomNode, reference: DomNode | null): DomNode {
    child.parentNode?.removeChild(child)
    const at = reference ? this.childNodes.indexOf(reference) : -1
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child)
    child.parentNode = this
    return child
  }

  removeChild(child: DomNode): DomNode {
    const at = this.childNodes.indexOf(child)
    if (at >= 0) this.childNodes.splice(at, 1)
    child.parentNode = null
    return child
  }

  contains(other: DomNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true
    return false
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ''
    if (this.nodeType === 8) return ''
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.nodeValue = String(value)
      return
    }
    for (const child of [...this.childNodes]) this.removeChild(child)
    if (value !== '' && value != null) {
      this.appendChild(new DomNode(this.ownerDocument, 3)).nodeValue = String(value)
    }
  }

  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    const key = `${type}:${phaseOf(options)}`
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key)!.add(listener)
  }

  removeEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    this.listeners.get(`${type}:${phaseOf(options)}`)?.delete(listener)
  }

  /** 捕捉 → 対象 → 浮上。React は根で受けるので、浮上まで配る。 */
  dispatchEvent(event: DomEvent): boolean {
    event.target = this
    const path: DomNode[] = []
    for (let node = this as DomNode | null; node; node = node.parentNode) path.push(node)

    const run = (node: DomNode, phase: 'capture' | 'bubble') => {
      event.currentTarget = node
      for (const listener of node.listeners.get(`${event.type}:${phase}`) ?? []) {
        listener.call(node, event)
        if (event.immediatelyStopped) return
      }
    }

    for (let i = path.length - 1; i >= 1; i -= 1) {
      run(path[i], 'capture')
      if (event.stopped) return !event.defaultPrevented
    }
    run(path[0], 'capture')
    run(path[0], 'bubble')
    if (!event.stopped) {
      for (let i = 1; i < path.length; i += 1) {
        run(path[i], 'bubble')
        if (event.stopped) break
      }
    }
    return !event.defaultPrevented
  }
}

function phaseOf(options?: boolean | { capture?: boolean }): 'capture' | 'bubble' {
  const capture = options === true || (typeof options === 'object' && options?.capture === true)
  return capture ? 'capture' : 'bubble'
}

export class DomElement extends DomNode {
  readonly tagName: string
  readonly namespaceURI: string
  readonly attributes = new Map<string, string>()
  /* 画面が本文へ差し込むときに触る。値は React が持つので、器だけ用意する。 */
  style: Record<string, unknown> = {}
  value = ''
  defaultValue = ''
  /* 選び口の状態。React は option を1つずつ見て付け替える。 */
  selected = false
  defaultSelected = false
  checked = false
  defaultChecked = false
  selectionStart: number | null = null
  selectionEnd: number | null = null

  /** `<select>` の中の `<option>`。React が選択状態を付け替えるのに使う。 */
  get options(): DomElement[] {
    return elements(this).filter((element) => element.tagName === 'OPTION')
  }

  constructor(ownerDocument: DomDocument, tagName: string, namespaceURI?: string) {
    super(ownerDocument, 1)
    this.tagName = tagName.toUpperCase()
    this.namespaceURI = namespaceURI ?? 'http://www.w3.org/1999/xhtml'
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? this.attributes.get(name)! : null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  /* React が同じ節を作り直さずに描き直すとき、余った属性を外すのに使う。 */
  getAttributeNames(): string[] {
    return [...this.attributes.keys()]
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {}
  blur(): void {}
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start
    this.selectionEnd = end
  }
}

export class DomDocument extends DomNode {
  readonly documentElement: DomElement
  readonly body: DomElement
  activeElement: DomElement
  defaultView: unknown = null

  constructor() {
    super(null, 9)
    this.ownerDocument = this
    this.documentElement = new DomElement(this, 'html')
    this.appendChild(this.documentElement)
    this.body = new DomElement(this, 'body')
    this.documentElement.appendChild(this.body)
    this.activeElement = this.body
  }

  createElement(tagName: string): DomElement {
    return new DomElement(this, tagName)
  }

  createElementNS(namespaceURI: string, tagName: string): DomElement {
    return new DomElement(this, tagName, namespaceURI)
  }

  createTextNode(text: string): DomNode {
    const node = new DomNode(this, 3)
    node.nodeValue = String(text)
    return node
  }

  createComment(text: string): DomNode {
    const node = new DomNode(this, 8)
    node.nodeValue = String(text)
    return node
  }

  createDocumentFragment(): DomNode {
    return new DomNode(this, 11)
  }
}

export class DomEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  defaultPrevented = false
  isTrusted = false
  timeStamp = 0
  detail = 0
  target: DomNode | null = null
  currentTarget: DomNode | null = null
  stopped = false
  immediatelyStopped = false

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type
    this.bubbles = init.bubbles ?? false
    this.cancelable = init.cancelable ?? false
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }

  stopPropagation(): void {
    this.stopped = true
  }

  stopImmediatePropagation(): void {
    this.stopped = true
    this.immediatelyStopped = true
  }
}

/**
 * DOM を全体へ置く。**`react-dom/client` を読み込む前に呼ぶ。**
 * React DOM は読み込み時に `window.document` の有無を見るため、
 * あとから置くと出来事の配り方が変わる。
 */
export function installTestDom(): DomDocument {
  const document = new DomDocument()
  const view = globalThis as unknown as Record<string, unknown>
  document.defaultView = view
  view.document = document
  view.window = view
  view.Node = DomNode
  view.Element = DomElement
  view.HTMLElement = DomElement
  // React は焦点の節が iframe かどうかを見る。この試験には iframe が無い。
  view.HTMLIFrameElement = class HTMLIFrameElement {}
  view.Event = DomEvent
  view.MouseEvent = DomEvent
  view.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(0), 0)
  view.cancelAnimationFrame = (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout)
  return document
}

/* ---------------------------------------------------------------- 探す道具 */

export function descendants(root: DomNode): DomNode[] {
  const found: DomNode[] = []
  const walk = (node: DomNode) => {
    for (const child of node.childNodes) {
      found.push(child)
      walk(child)
    }
  }
  walk(root)
  return found
}

export function elements(root: DomNode): DomElement[] {
  return descendants(root).filter((node): node is DomElement => node.nodeType === 1)
}

/** 見出しや札の文字で1つ選ぶ。運用の人が画面で読む言葉で探す。 */
export function findByText(root: DomNode, tagName: string, text: string): DomElement | null {
  return elements(root).find(
    (element) => element.tagName === tagName.toUpperCase() && element.textContent.trim() === text,
  ) ?? null
}

export function findByLabel(root: DomNode, label: string): DomElement | null {
  return elements(root).find((element) => element.getAttribute('aria-label') === label) ?? null
}

export function findById(root: DomNode, id: string): DomElement | null {
  return elements(root).find((element) => element.getAttribute('id') === id) ?? null
}

export function isDisabled(element: DomElement | null): boolean {
  return element !== null && element.getAttribute('disabled') !== null
}

export function click(element: DomElement): void {
  element.dispatchEvent(new DomEvent('click', { bubbles: true, cancelable: true }))
}
