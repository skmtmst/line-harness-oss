// @vitest-environment happy-dom
/**
 * Issue #967（外部UI監査 U001/U002/U003/U049/U051/U053/U076）の契約。
 *
 * 対象は `/auto-replies/edit` のページ表示（`page` + `step`）。
 * 監査で見つかった「ページ表示だと選べない／入力できない／押せない見本」が
 * 戻らないように、完了条件をそのまま確かめる。
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  saveDraft: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
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
  // 実在する編集部品が描かれていることだけを見る。中身の振る舞いは
  // inline-action-list 側の試験が持つ。
  default: () => <div data-testid="inline-action-list" />,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({
  default: ({ value, onChange, label }: {
    value: { originalContentUrl: string; previewImageUrl: string } | null
    onChange: (
      v: { mode: 'line-image'; originalContentUrl: string; previewImageUrl: string } | null,
    ) => void
    label?: string
  }) => (
    <div data-testid="image-uploader">
      <span>{label}</span>
      <span data-testid="image-value">{value?.originalContentUrl ?? ''}</span>
      <button
        type="button"
        data-testid="pick-image"
        onClick={() =>
          onChange({
            mode: 'line-image',
            originalContentUrl: 'https://img.example.com/original.jpg',
            previewImageUrl: 'https://img.example.com/preview.jpg',
          })
        }
      >
        画像を選ぶ
      </button>
    </div>
  ),
}))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/components/shared/button', () => ({
  default: (allProps: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: string
    variant?: string
    size?: string
  }) => {
    const { children, onClick, disabled, type = 'button', href, ...rest } = allProps
    // variant / size は共通部品の見た目指定で、DOM には流さない
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
  {
    id: 'tpl-flex',
    name: 'カードテンプレート',
    messageType: 'flex',
    messageContent: '{"type":"bubble"}',
  },
]

const newDraft: AutoReplyDraft = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: true,
  priority: 1,
}

const existingDraft: AutoReplyDraft = {
  ...newDraft,
  id: 'reply-1',
  versionNumber: 3,
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

function mountPage(
  draft: AutoReplyDraft = newDraft,
  step: 'basic' | 'trigger' | 'response' = 'response',
) {
  const onSaved = vi.fn()
  act(() => {
    root.render(
      <EditDialog
        page
        step={step}
        draft={draft}
        templates={templates}
        onClose={() => {}}
        onSaved={onSaved}
        onStepChange={() => {}}
      />,
    )
  })
  return { onSaved }
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  )
  if (!found) throw new Error(`ボタンが見つかりません: ${text}`)
  return found
}

const click = (el: HTMLElement) => act(async () => { el.click() })

async function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    if (element instanceof HTMLSelectElement) {
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}

const saveButton = () => buttonByText('下書き保存')

describe('U001: ページ表示でもテンプレートを選べる', () => {
  it('新規作成で「テンプレートから」を選ぶと選択欄が出る', async () => {
    mountPage(newDraft)
    await flush()
    await click(buttonByText('テンプレートから'))
    const select = host.querySelector<HTMLSelectElement>('#auto-reply-template')
    expect(select).not.toBeNull()
    expect(select!.tagName).toBe('SELECT')
  })

  it('既存ルールの編集でもテンプレートを選べ、保存内容とプレビューが一致する', async () => {
    const { onSaved } = mountPage(existingDraft)
    await flush()
    await click(buttonByText('テンプレートから'))
    const select = host.querySelector<HTMLSelectElement>('#auto-reply-template')
    expect(select).not.toBeNull()
    await setValue(select!, 'tpl-text')

    // プレビューは選んだテンプレートの本文を指す
    expect(host.textContent).toContain('ご予約を確認します。')

    await click(saveButton())
    await flush()
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
    const [, body] = mocks.saveDraft.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.templateId).toBe('tpl-text')
    expect(body.responseType).toBe('text')
    expect(body.responseContent).toBe('ご予約を確認します。')
    expect(onSaved).toHaveBeenCalled()
  })

  it('新規作成でも保存本文に選んだテンプレートが入り、プレビューはそのテンプレートを指す', async () => {
    mountPage(newDraft)
    await flush()
    await click(buttonByText('テンプレートから'))
    await setValue(host.querySelector<HTMLSelectElement>('#auto-reply-template')!, 'tpl-flex')
    // プレビュー（aside）側が、選んだテンプレートを指す
    const aside = host.querySelector('aside')
    expect(aside?.textContent).toContain('カードテンプレート')
    await click(saveButton())
    await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const body = mocks.create.mock.calls[0][0] as Record<string, unknown>
    expect(body.templateId).toBe('tpl-flex')
    expect(body.responseType).toBe('flex')
    expect(body.responseContent).toBe('{"type":"bubble"}')
  })
})

describe('U002: 返信形式に対応する入力が出る', () => {
  it('画像形式では画像アップローダーが出て本文欄は出ない', async () => {
    mountPage()
    await flush()
    await click(buttonByText('画像を直接選ぶ'))
    expect(host.querySelector('[data-testid="image-uploader"]')).not.toBeNull()
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('選んだ画像がJSONで保存され、再表示でも画像として読める', async () => {
    mountPage()
    await flush()
    await click(buttonByText('画像を直接選ぶ'))
    await click(host.querySelector<HTMLElement>('[data-testid="pick-image"]')!)
    expect(host.querySelector('[data-testid="image-value"]')!.textContent).toBe(
      'https://img.example.com/original.jpg',
    )
    await click(saveButton())
    await flush()
    const body = mocks.create.mock.calls[0][0] as Record<string, unknown>
    expect(body.responseType).toBe('image')
    expect(JSON.parse(body.responseContent as string)).toEqual({
      originalContentUrl: 'https://img.example.com/original.jpg',
      previewImageUrl: 'https://img.example.com/preview.jpg',
    })
  })

  it('テキストのまま画像形式では保存できない', async () => {
    mountPage({ ...newDraft, responseType: 'text', responseContent: 'ただいま確認中です' })
    await flush()
    await click(buttonByText('画像を直接選ぶ'))
    await click(saveButton())
    await flush()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('返信する画像を選んでください')
  })

  it('カード形式はJSON専用の入力欄を出し、JSONでない本文は保存できない', async () => {
    mountPage()
    await flush()
    await click(buttonByText('カードを直接作る'))
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.placeholder).toContain('bubble')
    await setValue(textarea!, 'JSONではない本文')
    await click(saveButton())
    await flush()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('カードの内容をJSON形式で入力してください')
  })

  it('「返信しない」では本文欄も画像選択も出さない', async () => {
    mountPage()
    await flush()
    await click(buttonByText('返信しない'))
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('[data-testid="image-uploader"]')).toBeNull()
    expect(host.textContent).toContain('返信はしません')
  })
})

describe('U003: 処理のない返信ボタンを置かない', () => {
  it('「予約を確認」「日程を変更」「キャンセル」は操作ボタンではなく表示見本', async () => {
    mountPage()
    await flush()
    const clickables = Array.from(host.querySelectorAll('button, a'))
    for (const label of ['予約を確認', '日程を変更', 'キャンセル']) {
      expect(
        clickables.some((el) => el.textContent?.trim() === label),
        `${label} が操作要素のまま残っている`,
      ).toBe(false)
    }
    // 顧客プレビュー内の「表示見本」として残す
    expect(host.textContent).toContain('表示見本')
  })

  it('配信後のアクションは実編集部品につながっている', async () => {
    mountPage()
    await flush()
    expect(host.querySelector('[data-testid="inline-action-list"]')).not.toBeNull()
    const dead = Array.from(host.querySelectorAll('button, a')).find((el) =>
      el.textContent?.includes('アクションを追加'),
    )
    expect(dead).toBeUndefined()
    // 見本の固定文は置かない
    expect(host.textContent).not.toContain('担当者「河野」へ通知')
  })
})

describe('U049: 手順表示は共通の Stepper（edit/page.tsx 側で描画）', () => {
  it('編集窓の内側には Steps の節を持たない（一覧画面へ混入しないため）', async () => {
    mountPage(newDraft, 'basic')
    await flush()
    expect(host.querySelector('[data-design="Steps"]')).toBeNull()
  })
})

describe('U051: 先頭キーワードの余分な左余白をなくす', () => {
  it('1件目のキーワード入力に ml-12 が付かず、接続語は2件目以降だけに出る', async () => {
    mountPage(
      {
        ...newDraft,
        keywords: [
          { keyword: '予約', matchType: 'contains' },
          { keyword: 'キャンセル', matchType: 'contains' },
        ],
      },
      'trigger',
    )
    await flush()
    const first = host.querySelector<HTMLInputElement>('input[aria-label="キーワード1"]')
    const second = host.querySelector<HTMLInputElement>('input[aria-label="キーワード2"]')
    expect(first).not.toBeNull()
    expect(first!.className).not.toContain('ml-12')
    expect(second).not.toBeNull()
    // 接続語（または／かつ）は2件目の行にだけ出る
    const row = second!.closest('div')!
    expect(row.textContent).toMatch(/または|かつ/)
    expect(first!.closest('div')!.textContent).not.toMatch(/または|かつ/)
  })
})

describe('U053: 見出しが末尾1文字だけで折り返さない', () => {
  it('狭い幅では見出しを全幅に取り、操作は下段に回る', async () => {
    mountPage(newDraft, 'basic')
    await flush()
    const heading = Array.from(host.querySelectorAll('h2')).find(
      (el) => el.textContent === 'どんなときに動くか',
    )
    expect(heading).not.toBeUndefined()
    const row = heading!.closest('.flex')!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('sm:flex-row')
  })
})

describe('U076: 明るい緑に白い小文字の選択ボタンを改める', () => {
  it('選択状態は bg-accent 白文字ではなく淡い緑＋濃い文字＋aria-pressed', async () => {
    mountPage()
    await flush()
    for (const el of Array.from(host.querySelectorAll('button'))) {
      expect(el.className).not.toContain('bg-accent text-on-accent')
    }
    const selected = buttonByText('この画面に直接書く')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.className).toContain('bg-accent-soft')
    const unselected = buttonByText('テンプレートから')
    expect(unselected.getAttribute('aria-pressed')).toBe('false')
  })

  it('反応条件の選択ボタンも同じ形にそろえる', async () => {
    mountPage(newDraft, 'trigger')
    await flush()
    for (const el of Array.from(host.querySelectorAll('button'))) {
      expect(el.className).not.toContain('bg-accent text-on-accent')
    }
    expect(buttonByText('キーワードで応答').getAttribute('aria-pressed')).toBe('true')
    expect(buttonByText('部分一致').getAttribute('aria-pressed')).toBe('true')
    expect(buttonByText('完全一致').getAttribute('aria-pressed')).toBe('false')
  })
})
