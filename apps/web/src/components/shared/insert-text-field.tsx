'use client'

/*
 * 差し込みを「札」で見せる本文の欄（絵 OVCot ①・オーナー 2026-10-08）。
 *
 * 本文の中の {{name}} などを、緑の札（名前・配信日…）として文の中に並べる。
 * **保存する値は今までどおりの文字**（{{name}} など）。onValueChange へ渡すのも、
 * 文字数を数えるのも、その文字のまま（API・保存の形・文字数の上限は変えない）。
 *
 * 作り方：contenteditable の箱。札は contenteditable="false" の塊にする。
 * textarea の上に札を重ねる方式は、札（印＋「名前」）と {{name}} の幅が違うので
 * カーソルと文字の位置がずれる。contenteditable なら
 *  - 日本語の変換（IME）・選択・元に戻す（Cmd+Z）はブラウザのものをそのまま使える
 *  - 札は1つの塊（中にカーソルが入らない・Backspace 1回で消える）にできる
 * 文字を入れる・消すのは document.execCommand（元に戻すの履歴に積まれる）で行い、
 * 使えない環境（試験の DOM）では Range で直接書き換える。
 *
 * - 改行は <br>。Enter は改行（変換中の Enter は変換の確定なので触らない）
 * - 貼り付けは文字だけ。貼った {{name}} は札になる。コピーは {{name}} の文字で出る
 * - 外から値が変わったとき（差し込むボタン・見本の読み込み）は、1か所の差し替えなら
 *   その所だけ書き換える（元に戻すの履歴を消さない）。そうでなければ作り直す
 * - 差し込むボタンが使う selectionStart / selectionEnd / setSelectionRange / focus を
 *   textarea と同じ形で ref に出す（今の差し込みの処理をそのまま使える）
 * - 試験・自動操作のため、箱の要素にも value（読み書き）を持たせ、change / input で拾う
 *
 * v7 の見た目は変えない：data-theme が v8 でないときは、今までどおりの textarea を描く。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { Ellipsis, Plus } from 'lucide-react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import {
  splitInsertTokens,
  type InsertPiece,
  type InsertTokenIcon,
  type InsertTokenNames,
  type InsertTokenSpec,
} from './insert-tokens'
import styles from './insert-text-field.module.css'

/** 差し込むボタンが読む・動かすカーソルの形（textarea と同じ名前）。 */
export interface InsertTextTarget {
  readonly selectionStart: number | null
  readonly selectionEnd: number | null
  setSelectionRange(start: number, end: number): void
  focus(): void
}

export interface InsertTextFieldHandle extends InsertTextTarget {
  readonly value: string
}

export interface InsertTextFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'onChange'> {
  value: string
  onValueChange: (next: string) => void
  /** 画面ごとに意味が違う差し込み（リマインダの {{date}}＝予約日時、統括の {店名} など）。 */
  extraTokens?: readonly InsertTokenSpec[]
  /** 友だち情報・共通情報のキー → 名前。札の文字に使う。 */
  tokenNames?: InsertTokenNames
}

/* lucide の形（24 の枠・線 2）。札は DOM へ直接書くので、React の印は使えない。 */
const ICON_PATHS: Record<InsertTokenIcon, string> = {
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  idcard: '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function chipHtml(spec: InsertTokenSpec): string {
  return `<span class="${styles.chip}" contenteditable="false" data-token="${escapeHtml(spec.token)}" title="${escapeHtml(spec.hint)}">`
    + `<svg class="${styles.chipIcon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[spec.icon]}</svg>`
    + `<span class="${styles.chipLabel}">${escapeHtml(spec.label)}</span></span>`
}

function piecesHtml(pieces: InsertPiece[]): string {
  return pieces.map((piece) => (piece.kind === 'chip'
    ? chipHtml(piece.spec)
    : escapeHtml(piece.text).replace(/\n/g, '<br>'))).join('')
}

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1
const isText = (node: Node): node is Text => node.nodeType === 3
const tokenOf = (node: Node) => (isElement(node) ? node.getAttribute('data-token') : null)
const isBlock = (node: Node) => isElement(node) && (node.tagName === 'DIV' || node.tagName === 'P')

/**
 * 箱の中身を保存の文字に戻す。札は data-token、<br> は改行。
 * 箱（と段落）の最後の <br> は、空の行を見せるための置き物なので数えない。
 */
function serialize(parent: Node, dropTrailingBreak: boolean): string {
  let out = ''
  /* 最後の葉が改行の文字か（pre-wrap の箱で Enter を押すと、ブラウザは "\n\n" を入れ、2つ目は置き物）。 */
  let endsWithNewlineText = false
  const walk = (node: Node, block: boolean) => {
    const kids = Array.from(node.childNodes)
    kids.forEach((child, index) => {
      if (isText(child)) {
        if (child.data) {
          out += child.data.replace(/\u00a0/g, ' ')
          endsWithNewlineText = child.data.endsWith('\n')
        }
        return
      }
      if (!isElement(child)) return
      const token = tokenOf(child)
      if (token !== null) { out += token; endsWithNewlineText = false; return }
      if (child.tagName === 'BR') {
        endsWithNewlineText = false
        if (dropTrailingBreak && block && index === kids.length - 1) return
        out += '\n'
        return
      }
      if (isBlock(child)) {
        if (out && !out.endsWith('\n')) out += '\n'
        walk(child, true)
        return
      }
      walk(child, false)
    })
  }
  walk(parent, true)
  return dropTrailingBreak && endsWithNewlineText ? out.slice(0, -1) : out
}

/** 札の中を指していたら、札の後ろへ出す。 */
function clampOutOfChip(root: HTMLElement, node: Node, offset: number): [Node, number] {
  let current: Node | null = node
  while (current && current !== root) {
    if (tokenOf(current) !== null) {
      const parent = current.parentNode as Node
      return [parent, Array.prototype.indexOf.call(parent.childNodes, current) + 1]
    }
    current = current.parentNode
  }
  return [node, offset]
}

/** DOM の位置 → 保存の文字の何文字目か。 */
function rawOffsetAt(root: HTMLElement, node: Node, offset: number): number {
  if (!root.contains(node)) return serialize(root, true).length
  const [n, o] = clampOutOfChip(root, node, offset)
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(n, o)
  return serialize(range.cloneContents(), false).length
}

/** 保存の文字の何文字目 → DOM の位置。 */
function domPointAt(root: HTMLElement, target: number): [Node, number] {
  let pos = 0
  let last = ''
  let found: [Node, number] | null = null
  const walk = (node: Node, block: boolean): boolean => {
    const kids = Array.from(node.childNodes)
    for (let index = 0; index < kids.length; index += 1) {
      const child = kids[index]
      if (isText(child)) {
        const length = child.data.length
        if (target <= pos + length) { found = [child, target - pos]; return true }
        pos += length
        if (length) last = child.data[length - 1]
        continue
      }
      if (!isElement(child)) continue
      const token = tokenOf(child)
      if (token !== null) {
        if (target <= pos) { found = [node, index]; return true }
        pos += token.length
        last = token[token.length - 1] ?? last
        if (target < pos) { found = [node, index + 1]; return true }
        continue
      }
      if (child.tagName === 'BR') {
        if (block && index === kids.length - 1) continue
        if (target <= pos) { found = [node, index]; return true }
        pos += 1
        last = '\n'
        continue
      }
      if (isBlock(child)) {
        if (pos > 0 && last !== '\n') {
          if (target <= pos) { found = [node, index]; return true }
          pos += 1
          last = '\n'
        }
        if (walk(child, true)) return true
        continue
      }
      if (walk(child, false)) return true
    }
    return false
  }
  if (walk(root, true) && found) return found
  const lastChild = root.lastChild
  const end = lastChild && isElement(lastChild) && lastChild.tagName === 'BR' ? root.childNodes.length - 1 : root.childNodes.length
  return [root, Math.max(0, end)]
}

/** 札の中で切れない位置か（文字の並びの境目か）。 */
function isPieceBoundary(value: string, at: number, extra: readonly InsertTokenSpec[], names: InsertTokenNames): boolean {
  let pos = 0
  for (const piece of splitInsertTokens(value, extra, names)) {
    const length = piece.kind === 'chip' ? piece.spec.token.length : piece.text.length
    if (piece.kind === 'chip' && at > pos && at < pos + length) return false
    pos += length
  }
  return true
}

/** 元に戻すの履歴に積む書き換え。使えなければ false。 */
function exec(command: string, arg?: string): boolean {
  try {
    return typeof document.execCommand === 'function' && document.execCommand(command, false, arg)
  } catch {
    return false
  }
}

function fragmentOf(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

const InsertTextField = forwardRef<InsertTextFieldHandle | HTMLTextAreaElement, InsertTextFieldProps>(function InsertTextField(
  { value, onValueChange, extraTokens, tokenNames, ...rest },
  ref,
) {
  const theme = useAdminTheme()
  if (theme !== 'v8') {
    return <textarea ref={ref as React.Ref<HTMLTextAreaElement>} {...rest} value={value} onChange={(event) => onValueChange(event.target.value)} />
  }
  return <ChipEditor ref={ref as React.Ref<InsertTextFieldHandle>} value={value} onValueChange={onValueChange} extraTokens={extraTokens} tokenNames={tokenNames} {...rest} />
})

export default InsertTextField

const EMPTY_TOKENS: readonly InsertTokenSpec[] = []
const EMPTY_NAMES: InsertTokenNames = {}

const ChipEditor = forwardRef<InsertTextFieldHandle, InsertTextFieldProps>(function ChipEditor(
  {
    value,
    onValueChange,
    extraTokens = EMPTY_TOKENS,
    tokenNames = EMPTY_NAMES,
    className,
    style,
    placeholder,
    maxLength,
    rows,
    disabled,
    readOnly,
    id,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  /** 箱が今見せている値（最後に親へ渡した・親から受けた値）。 */
  const shown = useRef<string | null>(null)
  const composing = useRef(false)
  const touched = useRef(false)
  const applying = useRef(false)
  const savedSelection = useRef<[number, number] | null>(null)
  const latest = useRef({ onValueChange, maxLength, extraTokens, tokenNames })
  latest.current = { onValueChange, maxLength, extraTokens, tokenNames }

  const html = useCallback((text: string) => piecesHtml(splitInsertTokens(text, latest.current.extraTokens, latest.current.tokenNames)), [])

  const rebuild = useCallback((text: string) => {
    const root = rootRef.current
    if (!root) return
    root.replaceChildren(fragmentOf(html(text) + (text.endsWith('\n') ? '<br>' : '')))
  }, [html])

  const readSelection = useCallback((): [number, number] | null => {
    const root = rootRef.current
    const selection = typeof window === 'undefined' ? null : window.getSelection()
    if (!root || !selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
    const start = rawOffsetAt(root, range.startContainer, range.startOffset)
    const end = rawOffsetAt(root, range.endContainer, range.endOffset)
    return start <= end ? [start, end] : [end, start]
  }, [])

  const select = useCallback((start: number, end: number) => {
    const root = rootRef.current
    const selection = window.getSelection()
    if (!root || !selection) return
    const range = document.createRange()
    const [startNode, startOffset] = domPointAt(root, start)
    const [endNode, endOffset] = domPointAt(root, end)
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    selection.removeAllRanges()
    selection.addRange(range)
    savedSelection.current = [start, end]
  }, [])

  /** 箱の中身を読み、親へ渡す（上限を超えた分は切る）。 */
  const emit = useCallback(() => {
    const root = rootRef.current
    if (!root || applying.current) return
    let next = serialize(root, true)
    const limit = latest.current.maxLength
    if (typeof limit === 'number' && limit >= 0 && next.length > limit) {
      const at = readSelection()?.[0] ?? limit
      next = next.slice(0, limit)
      rebuild(next)
      select(Math.min(at, next.length), Math.min(at, next.length))
    }
    root.toggleAttribute('data-empty', next.length === 0)
    if (next === shown.current) return
    shown.current = next
    latest.current.onValueChange(next)
  }, [readSelection, rebuild, select])

  /** 札にできる {{…}} が文字のまま箱に残っているか。 */
  const hasLooseToken = useCallback((root: HTMLElement) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (splitInsertTokens((node as Text).data, latest.current.extraTokens, latest.current.tokenNames).some((piece) => piece.kind === 'chip')) return true
    }
    return false
  }, [])

  /** 今の選択を、文字（札になるものは札）で置き換える。 */
  const replaceSelection = useCallback((text: string) => {
    const root = rootRef.current
    const selection = window.getSelection()
    if (!root || !selection) return
    if (selection.rangeCount === 0 || !root.contains(selection.getRangeAt(0).startContainer)) {
      const [start, end] = savedSelection.current ?? [serialize(root, true).length, serialize(root, true).length]
      select(start, end)
    }
    const [start] = readSelection() ?? [0, 0]
    const markup = html(text)
    const done = text === '' ? exec('delete') : exec('insertHTML', markup)
    if (!done) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const fragment = fragmentOf(markup)
      const lastNode = fragment.lastChild
      range.insertNode(fragment)
      if (lastNode) {
        range.setStartAfter(lastNode)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    /* ブラウザが札の印を落として文字で入れたときは、札に作り直す（値は同じ）。 */
    if (hasLooseToken(root)) {
      rebuild(serialize(root, true))
      const caret = start + text.length
      select(caret, caret)
    }
  }, [html, readSelection, rebuild, select, hasLooseToken])

  /* 外から値が変わった：1か所の差し替えならそこだけ。違えば作り直す。 */
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const previous = shown.current
    if (previous === value) return
    shown.current = value
    root.toggleAttribute('data-empty', value.length === 0)
    if (previous === null || !touched.current) {
      rebuild(value)
      return
    }
    let prefix = 0
    const limit = Math.min(previous.length, value.length)
    while (prefix < limit && previous[prefix] === value[prefix]) prefix += 1
    let suffix = 0
    while (suffix < limit - prefix && previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix += 1
    const { extraTokens: extra, tokenNames: names } = latest.current
    const clean = [prefix, previous.length - suffix].every((at) => isPieceBoundary(previous, at, extra, names))
      && [prefix, value.length - suffix].every((at) => isPieceBoundary(value, at, extra, names))
      && serialize(root, true) === previous
    if (!clean) {
      rebuild(value)
      return
    }
    applying.current = true
    try {
      if (document.activeElement !== root) root.focus({ preventScroll: true })
      select(prefix, previous.length - suffix)
      const inserted = value.slice(prefix, value.length - suffix)
      const done = inserted === '' ? exec('delete') : exec('insertHTML', html(inserted))
      if (!done) {
        const range = window.getSelection()?.getRangeAt(0)
        if (range) {
          range.deleteContents()
          range.insertNode(fragmentOf(html(inserted)))
        }
      }
      if (serialize(root, true) !== value) rebuild(value)
      const caret = value.length - suffix
      select(caret, caret)
    } finally {
      applying.current = false
    }
  }, [value, rebuild, select, html])

  /* 友だち情報・共通情報の名前が読めたら、札の文字を付け直す（カーソルは保つ）。 */
  const namesKey = useMemo(() => JSON.stringify([
    extraTokens.map((spec) => [spec.token, spec.label, spec.hint, spec.icon]),
    tokenNames.fields instanceof Map ? [...tokenNames.fields] : tokenNames.fields ?? null,
    tokenNames.vars instanceof Map ? [...tokenNames.vars] : tokenNames.vars ?? null,
  ]), [extraTokens, tokenNames])
  const firstNames = useRef(true)
  useLayoutEffect(() => {
    if (firstNames.current) { firstNames.current = false; return }
    const root = rootRef.current
    if (!root || shown.current === null) return
    const selection = document.activeElement === root ? readSelection() : null
    rebuild(shown.current)
    if (selection) select(selection[0], selection[1])
  }, [namesKey, readSelection, rebuild, select])

  /* カーソルの位置を覚えておく（差し込むボタンを押すと箱から焦点が外れるため）。 */
  useEffect(() => {
    const onSelectionChange = () => {
      const current = readSelection()
      if (current) savedSelection.current = current
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [readSelection])

  /*
   * <label for={id}> は div を指せない（押しても焦点が来ず、名前も付かない）。
   * 同じ id の題を見つけたら aria-labelledby でつなぎ、押したら箱へ焦点を移す。
   */
  useEffect(() => {
    const root = rootRef.current
    if (!root || !id || root.hasAttribute('aria-label')) return
    const label = Array.from(document.querySelectorAll('label')).find((element) => element.htmlFor === id)
    if (!label) return
    if (!label.id) label.id = `${id}-label`
    root.setAttribute('aria-labelledby', label.id)
    const onClick = () => root.focus()
    label.addEventListener('click', onClick)
    return () => label.removeEventListener('click', onClick)
  }, [id])

  /* 箱の要素にも value を持たせる（試験・自動操作が textarea と同じに書ける）。 */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    Object.defineProperty(root, 'value', {
      configurable: true,
      get: () => shown.current ?? '',
      set: (next: string) => { rebuild(String(next)) },
    })
    const onChange = () => emit()
    root.addEventListener('change', onChange)
    return () => {
      root.removeEventListener('change', onChange)
      delete (root as unknown as { value?: string }).value
    }
  }, [emit, rebuild])

  useImperativeHandle(ref, () => ({
    get value() { return shown.current ?? '' },
    get selectionStart() {
      return (readSelection() ?? savedSelection.current ?? [(shown.current ?? '').length])[0]
    },
    get selectionEnd() {
      const current = readSelection() ?? savedSelection.current
      return current ? current[1] : (shown.current ?? '').length
    },
    setSelectionRange(start: number, end: number) {
      const length = (shown.current ?? '').length
      select(Math.max(0, Math.min(start, length)), Math.max(0, Math.min(end, length)))
    },
    focus() {
      const root = rootRef.current
      if (!root) return
      const keep = savedSelection.current
      root.focus({ preventScroll: false })
      if (keep) select(keep[0], keep[1])
    },
  }), [readSelection, select])

  const editable = !disabled && !readOnly

  /** 札の隣で Backspace / Delete：札を1回で消す。 */
  const removeChipBeside = (backward: boolean): boolean => {
    const root = rootRef.current
    const selection = window.getSelection()
    if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
    const range = selection.getRangeAt(0)
    let node: Node | null = range.startContainer
    let offset = range.startOffset
    if (!root.contains(node)) return false
    let neighbor: Node | null = null
    if (isText(node)) {
      if (backward ? offset > 0 : offset < node.data.length) return false
    } else {
      neighbor = backward ? node.childNodes[offset - 1] ?? null : node.childNodes[offset] ?? null
    }
    if (!neighbor) {
      while (node && node !== root && !(backward ? node.previousSibling : node.nextSibling)) node = node.parentNode
      if (!node || node === root) return false
      neighbor = backward ? node.previousSibling : node.nextSibling
    }
    while (neighbor && isText(neighbor) && neighbor.data === '') {
      neighbor = backward ? neighbor.previousSibling : neighbor.nextSibling
    }
    if (!neighbor || tokenOf(neighbor) === null) return false
    const parentOfChip = neighbor.parentNode as Node
    const at = rawOffsetAt(root, parentOfChip, Array.prototype.indexOf.call(parentOfChip.childNodes, neighbor))
    const before = serialize(root, true)
    const expected = before.slice(0, at) + before.slice(at + (tokenOf(neighbor) ?? '').length)
    const chipRange = document.createRange()
    chipRange.selectNode(neighbor)
    selection.removeAllRanges()
    selection.addRange(chipRange)
    if (!exec('delete')) {
      const parent = neighbor.parentNode as Node
      offset = Array.prototype.indexOf.call(parent.childNodes, neighbor)
      parent.removeChild(neighbor)
      const caret = document.createRange()
      caret.setStart(parent, offset)
      caret.collapse(true)
      selection.removeAllRanges()
      selection.addRange(caret)
    }
    /*
     * 行に札だけがあるとき、ブラウザは札と一緒にその行の改行まで消す（Chrome）。
     * textarea と同じく「札だけが消える」ように、消えた空の行を戻す。
     */
    if (serialize(root, true) !== expected) {
      if (serialize(root, true) + '\n' === expected) root.appendChild(document.createElement('br'))
      if (serialize(root, true) !== expected) rebuild(expected)
      select(at, at)
    }
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    rest.onKeyDown?.(event as unknown as KeyboardEvent<HTMLTextAreaElement>)
    if (event.defaultPrevented || !editable) return
    /* 変換中（IME）の Enter・Backspace は変換のもの。触らない。 */
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      if (!exec('insertLineBreak')) replaceSelection('\n')
      emit()
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (removeChipBeside(event.key === 'Backspace')) {
        event.preventDefault()
        emit()
      }
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!editable) return
    event.preventDefault()
    let text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    const limit = latest.current.maxLength
    if (typeof limit === 'number') {
      const [start, end] = readSelection() ?? [0, 0]
      const room = limit - ((shown.current ?? '').length - (end - start))
      text = text.slice(0, Math.max(0, room))
    }
    if (!text) return
    replaceSelection(text)
    emit()
  }

  const onCopy = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const selection = readSelection()
    if (!selection || selection[0] === selection[1]) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', (shown.current ?? '').slice(selection[0], selection[1]))
    if (cut && editable) {
      replaceSelection('')
      emit()
    }
  }

  const minHeight: CSSProperties | undefined = rows ? { minHeight: `calc(${rows}lh + 1.5rem + 2px)` } : undefined
  const passThrough = Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-') || key === 'title'))

  return (
    <div
      {...passThrough}
      ref={rootRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      aria-readonly={readOnly || undefined}
      aria-placeholder={placeholder}
      {...({ placeholder } as Record<string, string | undefined>)}
      data-insert-field=""
      className={`${styles.editor} ${className ?? ''}`}
      style={{ ...minHeight, ...style }}
      contentEditable={editable}
      suppressContentEditableWarning
      tabIndex={disabled ? -1 : 0}
      spellCheck={false}
      onFocus={(event) => {
        touched.current = true
        onFocus?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)
      }}
      onBlur={(event) => {
        /* 手で打った {{name}} も、外へ出たら札にする（値は変わらない）。 */
        const root = rootRef.current
        if (root && shown.current !== null && hasLooseToken(root)) rebuild(shown.current)
        onBlur?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)
      }}
      onInput={() => { if (!composing.current) emit() }}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false; emit() }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCopy={(event) => onCopy(event, false)}
      onCut={(event) => onCopy(event, true)}
      onDrop={(event) => event.preventDefault()}
    />
  )
})

/**
 * 本文の欄の下に並べる「差し込む」の丸い枠のボタン（絵 OVCot：［＋名前］［＋配信日］［…その他］）。
 * 押すとすぐ入るものは＋、一覧が開くものは渡した印（既定は＋、その他は…）。
 */
export const InsertButton = forwardRef<HTMLButtonElement, {
  label: ReactNode
  onClick: () => void
  icon?: 'plus' | 'more'
  disabled?: boolean
  title?: string
  expanded?: boolean
  className?: string
}>(function InsertButton({ label, onClick, icon = 'plus', disabled, title, expanded, className }, ref: Ref<HTMLButtonElement>) {
  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.insertButton} ${className ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-haspopup={expanded === undefined ? undefined : 'menu'}
      aria-expanded={expanded}
    >
      {icon === 'more' ? <Ellipsis aria-hidden="true" /> : <Plus aria-hidden="true" />}
      {label}
    </button>
  )
})
