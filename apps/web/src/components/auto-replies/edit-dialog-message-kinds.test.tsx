// @vitest-environment happy-dom
/**
 * 監査 R254：対象メッセージの選択状態が読み上げ用の情報に含まれない。
 *
 * 8種のボタンに aria-pressed がなく、選ばれているか外れているかを
 * 読み上げで区別できない。押した状態を付けて、見た目と意味を一致させる。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'
import { MESSAGE_KIND_WORDS } from '@/app/auto-replies/auto-reply-words'

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
  keyword: '営業時間',
  matchType: 'exact',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: false,
  priority: 0,
  // 画像・ファイルを外した状態（監査の再現と同じ）
  messageKinds: ['text', 'video', 'audio', 'location', 'sticker', 'postback'],
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

function kindButton(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label,
  )
  if (!found) throw new Error(`対象種別のボタンが見つかりません: ${label}`)
  return found as HTMLButtonElement
}

const click = (el: HTMLElement) => act(async () => { el.click() })

describe('R254 対象メッセージ8種の選択が読み上げで分かる', () => {
  it('8種すべてに押した状態が付き、選・不選と一致する', async () => {
    act(() => {
      root.render(<EditDialog draft={baseDraft} templates={[]} onClose={() => {}} onSaved={() => {}} />)
    })
    await flush()
    expect(MESSAGE_KIND_WORDS).toHaveLength(8)
    for (const { label } of MESSAGE_KIND_WORDS) {
      const button = kindButton(label)
      const pressed = button.getAttribute('aria-pressed')
      if (label === '画像' || label === 'ファイル') {
        expect(pressed, label).toBe('false')
      } else {
        expect(pressed, label).toBe('true')
      }
    }
  })

  it('外した種別を押すと押した状態に戻り、見た目と意味が一致する', async () => {
    act(() => {
      root.render(<EditDialog draft={baseDraft} templates={[]} onClose={() => {}} onSaved={() => {}} />)
    })
    await flush()
    await click(kindButton('画像'))
    expect(kindButton('画像').getAttribute('aria-pressed')).toBe('true')
    await click(kindButton('テキスト'))
    expect(kindButton('テキスト').getAttribute('aria-pressed')).toBe('false')
  })
})
