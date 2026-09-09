import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hookHarness = vi.hoisted(() => {
  type Cleanup = void | (() => void)
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }
  const slots: Slot[] = []
  let cursor = 0
  let pending: Array<() => void> = []

  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]) =>
    Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))

  return {
    begin() { cursor = 0 },
    reset() {
      for (const slot of slots) slot.cleanup?.()
      slots.length = 0
      cursor = 0
      pending = []
    },
    flushEffects() {
      const effects = pending
      pending = []
      for (const run of effects) run()
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? (initial as () => T)() : initial }
      const setValue = (next: T | ((current: T) => T)) => {
        const current = slots[index].value as T
        slots[index].value = typeof next === 'function' ? (next as (value: T) => T)(current) : next
      }
      return [slots[index].value as T, setValue] as const
    },
    useRef<T>(initial: T) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initial } }
      return slots[index].value as { current: T }
    },
    useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
      const index = cursor++
      const slot = slots[index]
      if (!slot || !sameDeps(slot.deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value as T
    },
    useCallback<T>(callback: T, deps?: readonly unknown[]) {
      const index = cursor++
      const slot = slots[index]
      if (!slot || !sameDeps(slot.deps, deps)) slots[index] = { value: callback, deps }
      return slots[index].value as T
    },
    useEffect(effect: () => Cleanup, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index]
      if (previous && sameDeps(previous.deps, deps)) return
      const slot: Slot = { deps, cleanup: previous?.cleanup }
      slots[index] = slot
      pending.push(() => {
        slot.cleanup?.()
        const cleanup = effect()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      })
    },
  }
})

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

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: hookHarness.useState,
    useRef: hookHarness.useRef,
    useMemo: hookHarness.useMemo,
    useCallback: hookHarness.useCallback,
    useEffect: hookHarness.useEffect,
  }
})

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

vi.mock('@/components/shared/confirm-dialog', () => ({
  default: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    onConfirm: () => void
    onCancel: () => void
  }) => open ? <section role="dialog">
    <h2>{title}</h2><p>{description}</p>
    <button type="button" onClick={onCancel}>{cancelLabel}</button>
    <button type="button" onClick={onConfirm}>{confirmLabel}</button>
  </section> : null,
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

import { ApiError, type EcNotificationSetting } from '@/lib/api'
import LineNotificationsPage from './page'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const setting = (eventType: string, label: string, title: string): EcNotificationSetting => ({
  eventType,
  label,
  isEnabled: true,
  title,
  introText: `${label}の本文`,
  outroText: `${label}の結び`,
  category: 'order',
  buttonLabel: '注文を見る',
  buttonUrl: '',
  imageUrl: '',
  displayOrder: 0,
  fixedFields: [],
  fixedPreview: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
})

const ACCOUNT_A_SETTINGS = [
  setting('order.confirmed', '注文受付', '通知A'),
  setting('order.shipped', '発送完了', '通知B'),
]

type HostElement = ReactElement<Record<string, unknown>, string>

function walk(node: ReactNode, visit: (element: HostElement) => void): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isValidElement(node)) return
  if (typeof node.type === 'function') {
    walk(node.type(node.props), visit)
    return
  }
  if (typeof node.type === 'symbol') {
    Children.forEach((node.props as { children?: ReactNode }).children, (child) => walk(child, visit))
    return
  }
  const host = node as HostElement
  visit(host)
  Children.forEach((host.props as { children?: ReactNode }).children, (child) => walk(child, visit))
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement(node)) return Array.isArray(node) ? node.map(textOf).join('') : ''
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return Children.toArray((node.props as { children?: ReactNode }).children).map(textOf).join('')
}

function findHost(root: ReactNode, type: string, label?: string): HostElement {
  let found: HostElement | undefined
  walk(root, (element) => {
    if (!found && element.type === type && (label === undefined || textOf(element) === label)) found = element
  })
  if (!found) throw new Error(`${type}「${label ?? ''}」が描画されていません`)
  return found
}

function findControlInLabel(root: ReactNode, label: string, controlType: 'input' | 'textarea'): HostElement {
  const field = findHost(root, 'label', label)
  return findHost(field, controlType)
}

function renderPage(): ReactNode {
  hookHarness.begin()
  return LineNotificationsPage()
}

async function settle(): Promise<ReactNode> {
  hookHarness.flushEffects()
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  renderPage()
  hookHarness.flushEffects()
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
  return renderPage()
}

async function click(root: ReactNode, label: string): Promise<ReactNode> {
  const button = findHost(root, 'button', label)
  const handler = button.props.onClick as (() => void) | undefined
  if (!handler) throw new Error(`button「${label}」に操作がありません`)
  handler()
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
  return renderPage()
}

function change(root: ReactNode, label: string, value: string, type: 'input' | 'textarea' = 'input'): ReactNode {
  const control = findControlInLabel(root, label, type)
  const handler = control.props.onChange as ((event: { target: { value: string } }) => void) | undefined
  if (!handler) throw new Error(`${type}「${label}」に入力操作がありません`)
  handler({ target: { value } })
  return renderPage()
}

function markup(tree: ReactNode): string {
  return renderToStaticMarkup(<>{tree}</>)
}

const localStorage = new MemoryStorage()
const listeners = new Map<string, EventListener>()
const browser = {
  localStorage,
  addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
  removeEventListener: vi.fn((name: string) => listeners.delete(name)),
}

beforeEach(() => {
  hookHarness.reset()
  vi.clearAllMocks()
  localStorage.clear()
  listeners.clear()
  fixture.selectedAccountId = 'account-a'
  fixture.activeTab = 'customer'
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 7 } } })
  fixture.settings.mockResolvedValue({ success: true, data: ACCOUNT_A_SETTINGS })
  fixture.overview.mockResolvedValue({
    success: true,
    data: {
      last24h: 10,
      failed: 0,
      byType: [
        { eventType: 'order.confirmed', label: '注文受付', count: 2 },
        { eventType: 'order.shipped', label: '発送完了', count: 8 },
      ],
    },
  })
  fixture.definitions.mockResolvedValue({ success: true, data: [] })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.updateSetting.mockResolvedValue({ success: true, data: {} })
  fixture.testSend.mockResolvedValue({ success: true, data: { sent: 1 } })
  vi.stubGlobal('React', React)
  vi.stubGlobal('window', browser)
})

afterEach(() => {
  hookHarness.reset()
  vi.unstubAllGlobals()
})

describe('#678 LINE通知画面の実挙動', () => {
  it('APIの「今日」の件数で多い順に描画し、運用者件数の実数と0件を区別する', async () => {
    renderPage()
    const tree = await settle()
    const html = markup(tree)

    expect(fixture.settings).toHaveBeenCalledWith('account-a')
    expect(fixture.overview).toHaveBeenCalledWith('account-a')
    expect(fixture.operatorList).toHaveBeenCalledWith('account-a')
    expect(html.indexOf('通知B')).toBeLessThan(html.indexOf('通知A'))
    expect(html).toMatch(/運用者へのお知らせ\s*7/)
    expect(html).toMatch(/送れなかったもの\s*0/)
  })

  it('APIが返した0件は空表示にし、運用者件数が取れないアカウントへ切り替えると旧件数を残さない', async () => {
    fixture.operatorList.mockResolvedValueOnce({ success: true, data: { summary: { total: 0 } } })
    fixture.settings.mockResolvedValueOnce({ success: true, data: [] })
    renderPage()
    let tree = await settle()
    expect(markup(tree)).toMatch(/顧客へのお知らせ\s*0/)
    expect(markup(tree)).toMatch(/運用者へのお知らせ\s*0/)
    expect(markup(tree)).toMatch(/顧客へのお知らせはまだありません/)

    fixture.selectedAccountId = 'account-b'
    fixture.operatorList.mockRejectedValueOnce(new ApiError(403))
    fixture.settings.mockResolvedValueOnce({ success: true, data: [] })
    tree = renderPage()
    tree = await settle()
    const switched = markup(tree)

    expect(fixture.operatorList).toHaveBeenLastCalledWith('account-b')
    expect(switched).toMatch(/運用者へのお知らせ\s*取得失敗/)
    expect(switched).not.toMatch(/運用者へのお知らせ\s*7/)
  })

  it('長文を編集すると未保存を示し、離脱を警告し、再読込後に同じアカウントの下書きを復元して保存する', async () => {
    renderPage()
    let tree = await settle()
    tree = await click(tree, '内容を編集')

    const editorHtml = markup(tree)
    expect(editorHtml).toMatch(/class="[^"]*grid-cols-1[^"]*lg:grid-cols-\[minmax\(0,1fr\)_390px\]/)

    const longText = '長いご案内です。'.repeat(80)
    tree = change(tree, 'ご案内文', longText, 'textarea')
    const edited = markup(tree)
    expect(edited).toMatch(/未保存の変更があります/)
    expect(edited).toMatch(new RegExp(longText.slice(0, 40)))
    expect(localStorage.length).toBe(1)

    hookHarness.flushEffects()
    const beforeUnload = listeners.get('beforeunload')
    expect(beforeUnload).toBeTypeOf('function')
    const preventDefault = vi.fn()
    beforeUnload?.({ preventDefault, returnValue: undefined } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledOnce()

    tree = await click(tree, 'キャンセル')
    expect(markup(tree)).toMatch(/保存していない編集を破棄しますか？/)
    tree = await click(tree, '編集を続ける')
    expect(markup(tree)).toMatch(/未保存の変更があります/)

    fixture.selectedAccountId = 'account-b'
    tree = renderPage()
    tree = await settle()
    expect(fixture.settings).toHaveBeenLastCalledWith('account-b')
    expect(markup(tree)).not.toMatch(new RegExp(longText.slice(0, 40)))
    expect(markup(tree)).not.toMatch(/未保存の編集を1件復元しました/)

    fixture.selectedAccountId = 'account-a'
    tree = renderPage()
    tree = await settle()
    expect(markup(tree)).toMatch(/未保存の編集を1件復元しました/)
    expect(markup(tree)).toMatch(new RegExp(longText.slice(0, 40)))

    // 同じアカウントの画面を開き直しても、端末内の下書きが残る。
    hookHarness.reset()
    renderPage()
    tree = await settle()
    expect(markup(tree)).toMatch(/未保存の編集を1件復元しました/)
    tree = await click(tree, '内容を編集')
    expect(markup(tree)).toMatch(new RegExp(longText.slice(0, 40)))

    tree = await click(tree, 'お知らせを保存')
    expect(fixture.updateSetting).toHaveBeenCalledWith(
      'account-a',
      'order.shipped',
      expect.objectContaining({ introText: longText }),
    )
    expect(localStorage.length).toBe(0)
    expect(markup(tree)).toMatch(/発送完了を保存しました/)
    expect(markup(tree)).not.toMatch(/未保存の変更があります/)
  })
})
