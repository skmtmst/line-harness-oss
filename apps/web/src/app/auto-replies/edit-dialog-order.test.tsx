// @vitest-environment happy-dom
/**
 * 監査 R28（優先順位の説明が逆）の窓の中の表示の契約。
 *
 * 実際の判定順（小さいほど先・Worker の並び）に合わせ、窓の中では
 * 数字を打たせない。「一覧の上から順に1つだけ動きます。このルールは
 * 上から ◯ 番目」と「このルールより先に当たるかもしれないルール」を出す。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from '../../components/auto-replies/edit-dialog'

vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    autoReplies: { create: vi.fn(), update: vi.fn(), saveDraft: vi.fn() },
  },
}))
vi.mock('../../components/auto-replies/inline-action-list', () => ({
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

const draft: AutoReplyDraft = {
  id: 'reply-2',
  keyword: '変更',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: true,
  priority: 20,
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

describe('R28 窓の中では数字を打たせず順番で見せる', () => {
  it('「上から ◯ 番目」と先に当たるかもしれないルールを出す', async () => {
    act(() => {
      root.render(
        <EditDialog
          draft={draft}
          templates={[]}
          onClose={() => {}}
          onSaved={() => {}}
          orderHint={{
            position: 2,
            total: 5,
            earlier: [
              { id: 'reply-1', name: '予約の受付' },
              { id: 'reply-9', name: '営業時間外の案内' },
            ],
          }}
        />,
      )
    })
    await flush()
    expect(host.textContent).toContain('一覧の上から順に1つだけ動きます')
    expect(host.textContent).toContain('このルールは上から 2 番目')
    expect(host.textContent).toContain('このルールより先に当たるかもしれないルール')
    expect(host.textContent).toContain('予約の受付')
  })

  it('優先順位の数字入力・選択欄を出さない', async () => {
    act(() => {
      root.render(
        <EditDialog
          draft={draft}
          templates={[]}
          onClose={() => {}}
          onSaved={() => {}}
          orderHint={{ position: 2, total: 5, earlier: [] }}
        />,
      )
    })
    await flush()
    expect(host.querySelector('#ar-priority')).toBeNull()
    expect(host.textContent).not.toContain('高いほど先に判定')
    expect(host.textContent).not.toContain('小さいほど先に見ます')
  })
})
