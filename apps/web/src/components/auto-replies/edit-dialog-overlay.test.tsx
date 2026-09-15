// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    autoReplies: { create: mocks.create, update: vi.fn(), saveDraft: vi.fn() },
  },
}))
vi.mock('./inline-action-list', () => ({
  default: () => null,
  useActionOptions: () => ({}),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({ default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div> }))
vi.mock('@/components/shared/button', () => ({
  default: ({ children, onClick, disabled, type = 'button', href, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) => href
    ? <a href={href}>{children}</a>
    : <button type={type} onClick={onClick} disabled={disabled} {...props}>{children}</button>,
}))

const draft: AutoReplyDraft = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: true,
  priority: 1,
}

let host: HTMLDivElement
let root: Root
let opener: HTMLButtonElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.create.mockResolvedValue({ success: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  opener = document.createElement('button')
  opener.textContent = '自動応答を編集'
  document.body.appendChild(opener)
  opener.focus()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  opener.remove()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
})

const flush = () => act(async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const keydown = (key: string, shiftKey = false) => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
})

const dialog = () => {
  const node = host.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('dialog not found')
  return node
}

const focusables = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
))

function mount(onClose = vi.fn()) {
  act(() => {
    root.render(<EditDialog draft={draft} templates={[]} onClose={onClose} onSaved={() => {}} />)
  })
  return onClose
}

describe('E-02 自動応答編集ダイアログのoverlay制御', () => {
  it('開いている間は背景スクロールを止め、閉じると元に戻す', async () => {
    mount()
    await flush()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { root.render(<div />) })
    expect(document.body.style.overflow).toBe('')
  })

  it('Escapeで閉じる', async () => {
    const onClose = mount()
    await flush()
    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tabはダイアログ内を循環し、閉じると開いた起点へ戻る', async () => {
    mount()
    await flush()
    const panel = dialog()
    const items = focusables(panel)
    expect(items.length).toBeGreaterThan(2)
    act(() => { items[items.length - 1].focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(items[0])
    act(() => { items[0].focus() })
    keydown('Tab', true)
    expect(document.activeElement).toBe(items[items.length - 1])
    await act(async () => { root.render(<div />) })
    expect(document.activeElement).toBe(opener)
  })

  it('保存中はEscapeと背景クリックで閉じない', async () => {
    let finishSave: (() => void) | undefined
    mocks.create.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve }))
    const onClose = mount()
    await flush()
    const save = Array.from(dialog().querySelectorAll('button')).find((button) => button.textContent === '保存')
    if (!save) throw new Error('save button not found')
    act(() => { save.click() })
    await flush()
    keydown('Escape')
    act(() => { host.firstElementChild?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { finishSave?.() })
  })
})
