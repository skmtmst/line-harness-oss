// @vitest-environment happy-dom
/**
 * 監査 R252：曜日の選択表示と解除操作が一致せず、最後の曜日を外すと
 * 全曜日へ広がる。
 *
 * 直し（司令塔の向きのうち「最後の1つは外せない」案。理由は報告に書く）：
 * - 「すべての曜日」を押す操作として明示する（空＝全曜日をボタンにする）
 * - 各曜日の解除はその曜日だけを外す。最後の1つは外さず、欄の下で理由を知らせる
 * - 表示と保存する値は常に一致する（外せなかった曜日は保存でも残る）
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
  keyword: '営業時間',
  matchType: 'exact',
  responseType: 'text',
  responseContent: '承りました。',
  templateId: null,
  lineAccountId: 'account-1',
  isActive: false,
  priority: 0,
  responseWeekdays: [5],
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

function weekdayButton(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label && el.getAttribute('aria-pressed') !== null,
  )
  if (!found) throw new Error(`曜日ボタンが見つかりません: ${label}`)
  return found as HTMLButtonElement
}

const pressed = (label: string) => weekdayButton(label).getAttribute('aria-pressed') === 'true'

const click = (el: HTMLElement) => act(async () => { el.click() })

describe('R252 曜日の解除はその曜日だけ・最後の1つは外さない', () => {
  it('金曜だけの状態で金曜を押しても全曜日へ広がらない', async () => {
    mountDialog()
    await flush()
    expect(pressed('金')).toBe(true)
    expect(pressed('日')).toBe(false)
    await click(weekdayButton('金'))
    // 最後の1つは外れない。7つとも押された状態（全曜日）にならない。
    expect(pressed('金')).toBe(true)
    expect(pressed('日')).toBe(false)
    expect(pressed('月')).toBe(false)
  })

  it('最後の1つを外そうとしたら欄の下で理由を知らせる', async () => {
    mountDialog()
    await flush()
    await click(weekdayButton('金'))
    expect(host.textContent).toContain('すべてにする場合')
  })

  it('「すべての曜日」を押すと全曜日扱いになり、そこから1つ押すとその曜日だけになる', async () => {
    mountDialog()
    await flush()
    await click(weekdayButton('すべての曜日'))
    expect(pressed('日')).toBe(true)
    expect(pressed('土')).toBe(true)
    // 全曜日の状態で日曜を押すと、日曜だけが残る（他は外れる）。
    await click(weekdayButton('日'))
    expect(pressed('日')).toBe(true)
    expect(pressed('月')).toBe(false)
    expect(pressed('金')).toBe(false)
  })

  it('外せなかった金曜は保存でも残る（表示と保存が一致）', async () => {
    mountDialog()
    await flush()
    await click(weekdayButton('金'))
    const save = Array.from(host.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === '保存',
    )!
    await click(save)
    await flush()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const body = mocks.create.mock.calls[0][0] as { responseWeekdays: number[] | null }
    expect(body.responseWeekdays).toEqual([5])
  })
})
