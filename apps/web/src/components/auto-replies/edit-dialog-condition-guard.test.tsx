// @vitest-environment happy-dom
/**
 * R243 残差：AutoReplyの条件編集で、空の「いずれか」のかたまり・
 * 未完成の行があるまま保存すると「絞り込みなし」へ黙って落ちる。
 *
 * page（下書き保存）とlist（更新）のどちらの保存口も、既存の
 * `findConditionDraftIssue` で止め、不足の案内だけ出してAPI要求は
 * 0にする。編集中の表示は消さない。素の空（null）は「絞り込みなし」
 * として有効なので通す。既存のU001〜U003等の契約は変えない。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditDialog, { type AutoReplyDraft } from './edit-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  saveDraft: vi.fn(),
  conditionBuilder: vi.fn(),
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
  default: () => <div data-testid="inline-action-list" />,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({
  // 値の受け渡しだけ見る。描画の中身は部品自身の試験が持つ。
  default: (props: { value: unknown }) => {
    mocks.conditionBuilder(props)
    return null
  },
}))
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

const baseDraft: AutoReplyDraft = {
  keyword: '予約',
  matchType: 'contains',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: true,
  priority: 1,
}

const pageDraft: AutoReplyDraft = {
  ...baseDraft,
  id: 'batch7-reply',
  versionNumber: 3,
}

// 空の「いずれか」のかたまり1個。編集中は描画に残す。
const emptyOr = {
  operator: 'AND',
  rules: [],
  groups: [{ operator: 'OR', rules: [], groups: [] }],
}

// 名前行の書きかけ。
const incomplete = {
  operator: 'AND',
  rules: [{ type: 'name', value: {} }],
  groups: [],
}

// 書き上がった条件。
const complete = {
  operator: 'AND',
  rules: [{ type: 'tag_exists', value: 'tag-1' }],
  groups: [],
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.create.mockResolvedValue({ success: true })
  mocks.update.mockResolvedValue({ success: true })
  mocks.saveDraft.mockResolvedValue({ success: true })
  mocks.conditionBuilder.mockClear()
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

function mountPage(draft: AutoReplyDraft = pageDraft) {
  const onSaved = vi.fn()
  act(() => {
    root.render(
      <EditDialog
        page
        step="trigger"
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

function mountList(draft: AutoReplyDraft) {
  const onSaved = vi.fn()
  act(() => {
    root.render(
      <EditDialog
        draft={draft}
        templates={templates}
        onClose={() => {}}
        onSaved={onSaved}
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

const lastBuilderValueFixed = (): unknown => {
  const calls = mocks.conditionBuilder.mock.calls as { value: unknown }[][]
  const props = calls[calls.length - 1]?.[0]
  return props?.value
}

describe('R243: 空のOR・未完成の条件は保存しない（page）', () => {
  it('空の「いずれか」のかたまりは不足を案内し、下書き保存の要求は0', async () => {
    const { onSaved } = mountPage({ ...pageDraft, friendConditions: emptyOr })
    await flush()
    await click(buttonByText('条件を編集'))
    await flush()
    await click(buttonByText('下書きを保存する'))
    await flush()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(host.textContent).toContain('空の「いずれか」の条件のかたまりがあります')
    // 編集中の表示は消さない。部品へ渡る値は空ORのまま。
    expect(lastBuilderValueFixed()).toEqual(emptyOr)
  })

  it('未完成の行は不足を案内し、下書き保存の要求は0', async () => {
    mountPage({ ...pageDraft, friendConditions: incomplete })
    await flush()
    await click(buttonByText('条件を編集'))
    await flush()
    await click(buttonByText('下書きを保存する'))
    await flush()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(host.textContent).toContain('入力が未完成の条件があります')
    expect(lastBuilderValueFixed()).toEqual(incomplete)
  })

  it('素の空は「絞り込みなし」として保存できる', async () => {
    const { onSaved } = mountPage({ ...pageDraft, friendConditions: null })
    await flush()
    await click(buttonByText('下書きを保存する'))
    await flush()
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalled()
  })

  it('書き上がった条件はそのまま保存できる', async () => {
    mountPage({ ...pageDraft, friendConditions: complete })
    await flush()
    await click(buttonByText('下書きを保存する'))
    await flush()
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
    const [, body] = mocks.saveDraft.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.friendConditions).toEqual(complete)
  })
})

describe('R243: 空のOR・未完成の条件は保存しない（list）', () => {
  it('空の「いずれか」のかたまりは不足を案内し、更新の要求は0', async () => {
    const { onSaved } = mountList({ ...pageDraft, friendConditions: emptyOr })
    await flush()
    await click(buttonByText('保存する'))
    await flush()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(host.textContent).toContain('空の「いずれか」の条件のかたまりがあります')
    expect(lastBuilderValueFixed()).toEqual(emptyOr)
  })
})
