// @vitest-environment happy-dom
/**
 * 監査 R257：異なるキーワードの完全一致を全て必須にする矛盾を案内しない。
 *
 * 異なる2語の完全一致allは成立しない（判定は正しい）。画面は条件を
 * 勝手に変えず、理由付きの案内を出す。保存は止めない。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'

vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    autoReplies: {
      create: vi.fn(async () => ({ success: true })),
      update: vi.fn(async () => ({ success: true })),
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
  keyword: '予約',
  matchType: 'exact',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: false,
  priority: 0,
  keywords: [
    { keyword: '予約', matchType: 'exact' },
    { keyword: 'キャンセル', matchType: 'exact' },
  ],
  keywordMatchMode: 'all',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
  act(() => {
    root.render(<EditDialog draft={draft} templates={[]} onClose={() => {}} onSaved={() => {}} />)
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  )
  if (!found) throw new Error(`ボタンが見つかりません: ${text}`)
  return found as HTMLButtonElement
}

const click = (el: HTMLElement) => act(async () => { el.click() })
const NOTICE = 'このままでは応答しません'

describe('R257 異なる語の完全一致allに理由付きの案内が出る', () => {
  it('異なる2語の完全一致allで不成立の案内が出る', async () => {
    mountDialog()
    await flush()
    expect(host.textContent).toContain(NOTICE)
  })

  it('部分一致に変えるか、どれか1つに変えると案内が消える', async () => {
    mountDialog()
    await flush()
    await click(buttonByText('部分一致'))
    expect(host.textContent).not.toContain(NOTICE)
    await click(buttonByText('完全一致'))
    expect(host.textContent).toContain(NOTICE)
    await click(buttonByText('どれか1つに当たれば返す'))
    expect(host.textContent).not.toContain(NOTICE)
  })

  it('同じ1語だけなら案内が出ない', async () => {
    mountDialog({
      ...baseDraft,
      keywords: [
        { keyword: '予約', matchType: 'exact' },
        { keyword: '予約', matchType: 'exact' },
      ],
    })
    await flush()
    expect(host.textContent).not.toContain(NOTICE)
  })
})
