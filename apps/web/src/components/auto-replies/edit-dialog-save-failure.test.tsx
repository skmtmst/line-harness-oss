// @vitest-environment happy-dom
/**
 * R570 新規保存の実GUI残差：合成 POST /api/auto-replies が 500 のとき、
 * 画面に素の `API error: 500` を出さない。既存 WRITE-01 の
 * `describeSaveFailure` で運用者の言葉にし、入力は保持、
 * onSaved は呼ばない。409（R551）の先行比較・入力保持は変えない。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'
import { ApiError } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  saveDraft: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  // describeSaveFailure は実物を使う。案内文の検証がこの試験の要点。
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: {
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    autoReplies: {
      create: mocks.create,
      update: mocks.update,
      saveDraft: mocks.saveDraft,
    },
  },
}))
vi.mock('./inline-action-list', () => ({
  default: () => <div data-testid="inline-action-list" />,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/components/shared/button', () => ({
  default: (allProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: string
    variant?: string
    size?: string
  }) => {
    const { children, onClick, disabled, type = 'button', href, ...rest } = allProps
    const { variant: _v, size: _s, ...props } = rest
    void _v
    void _s
    return href ? (
      <a href={href} {...props}>{children}</a>
    ) : (
      <button type={type} onClick={onClick} disabled={disabled} {...props}>{children}</button>
    )
  },
}))

const templates = [
  {
    id: 'tpl-text',
    name: '予約確認テンプレート',
    messageType: 'text',
    messageContent: 'ご予約を確認します。',
  },
]

// R570: 新規作成（id なし）。保存は止まった状態で作る。
const newDraft: AutoReplyDraft = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '合成保存再試行。実送信なし。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: true,
  priority: 1,
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.create.mockResolvedValue({ success: true })
  mocks.update.mockResolvedValue({ success: true })
  mocks.saveDraft.mockResolvedValue({ success: true })
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

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  )
  if (!found) throw new Error(`ボタンが見つかりません: ${text}`)
  return found
}

const click = (el: HTMLElement) => act(async () => { el.click() })

describe('R570: 新規保存の500は運用者の言葉で案内する', () => {
  it('日本語の保存失敗案内を出し、入力を保持し、onSavedを呼ばない', async () => {
    mocks.create.mockRejectedValue(new ApiError(500, 'API error: 500'))
    const onSaved = vi.fn()
    act(() => {
      root.render(
        <EditDialog
          page
          step="trigger"
          draft={newDraft}
          templates={templates}
          onClose={() => {}}
          onSaved={onSaved}
          onStepChange={() => {}}
        />,
      )
    })
    await flush()
    await click(buttonByText('下書きを保存する'))
    await flush()
    // 素の内部文は出さない。
    expect(host.textContent).not.toContain('API error: 500')
    // 運用者の言葉で案内する。
    expect(host.textContent).toContain('サーバー側で保存できませんでした')
    // 入力は保持する。
    const keyword = host.querySelector<HTMLInputElement>('[aria-label="キーワード1"]')
    expect(keyword?.value).toBe('予約')
    // 成功扱いにしない。
    expect(onSaved).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
