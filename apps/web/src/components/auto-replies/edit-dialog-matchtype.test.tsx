// @vitest-environment happy-dom
/**
 * 監査 R29（部分一致が保存に反映されない）の画面からの保存形の契約。
 *
 * 「一致のしかた」で選んだ当て方が、送る `matchType` と
 * `keywords` の各行の両方に載る。新規作成・編集・複数キーワードの
 * すべての経路で、選んだとおりに判定される形で送る。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    autoReplies: {
      create: mocks.create,
      update: mocks.update,
      saveDraft: vi.fn(),
    },
  },
}))
vi.mock('./inline-action-list', () => ({
  default: () => null,
  useActionOptions: () => ({}),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/components/shared/button', () => ({
  default: ({ children, onClick, disabled, type = 'button', href, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) => href
    ? <a href={href}>{children}</a>
    : <button type={type} onClick={onClick} disabled={disabled} {...props}>{children}</button>,
}))

const baseDraft: AutoReplyDraft = {
  keyword: '',
  matchType: 'exact',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: false,
  priority: 0,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.create.mockResolvedValue({ success: true })
  mocks.update.mockResolvedValue({ success: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

function mountDialog(draft: AutoReplyDraft = baseDraft) {
  const onSaved = vi.fn()
  act(() => {
    root.render(<EditDialog draft={draft} templates={[]} onClose={() => {}} onSaved={onSaved} />)
  })
  return { onSaved }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  )
  if (!found) throw new Error(`ボタンが見つかりません: ${text}`)
  return found as HTMLButtonElement
}

function keywordInput(index: number): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="キーワード${index}"]`)
  if (!el) throw new Error(`キーワード${index}の入力が見つかりません`)
  return el
}

const click = (el: HTMLElement) => act(async () => { el.click() })

async function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

type SavedBody = Record<string, unknown> & {
  matchType: 'exact' | 'contains'
  keywords: Array<Record<string, unknown>> | null
}

describe('R29 新規作成：部分一致を選んだら行も部分一致で送る', () => {
  it('「予約」＋部分一致→保存で keywords の行も contains', async () => {
    mountDialog()
    await flush()
    await setInputValue(keywordInput(1), '予約')
    await click(buttonByText('部分一致'))
    await click(buttonByText('保存する'))
    await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const body = mocks.create.mock.calls[0][0] as SavedBody
    expect(body.matchType).toBe('contains')
    expect(body.keywords).toHaveLength(1)
    expect(body.keywords![0]).toMatchObject({ keyword: '予約', matchType: 'contains' })
  })
})

describe('R29 編集：完全一致の保存済みを行ごと部分一致へ変えられる', () => {
  const staleDraft: AutoReplyDraft = {
    ...baseDraft,
    id: 'reply-1',
    keyword: '予約',
    matchType: 'exact',
    isActive: true,
    keywords: [{ keyword: '予約', matchType: 'exact' }],
  }

  it('部分一致を選ぶと送る行も contains になる', async () => {
    mountDialog(staleDraft)
    await flush()
    await click(buttonByText('部分一致'))
    await click(buttonByText('保存する'))
    await flush()
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const body = mocks.update.mock.calls[0][1] as SavedBody
    expect(body.matchType).toBe('contains')
    expect(body.keywords![0]).toMatchObject({ keyword: '予約', matchType: 'contains' })
  })
})

describe('R29 複数キーワード：足した行もいまの選択を引き継ぐ', () => {
  it('部分一致のまま行を足すと2行とも contains で送る', async () => {
    mountDialog()
    await flush()
    await setInputValue(keywordInput(1), '予約')
    await click(buttonByText('部分一致'))
    await click(buttonByText('＋ キーワードを追加する'))
    await flush()
    await setInputValue(keywordInput(2), '変更')
    await click(buttonByText('保存する'))
    await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const body = mocks.create.mock.calls[0][0] as SavedBody
    expect(body.keywords).toHaveLength(2)
    for (const row of body.keywords!) {
      expect(row).toMatchObject({ matchType: 'contains' })
    }
  })
})
