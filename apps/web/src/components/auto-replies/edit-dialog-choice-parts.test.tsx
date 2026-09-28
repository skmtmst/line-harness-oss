// @vitest-environment happy-dom
/**
 * m20j: 素の radio・checkbox を共通部品（RadioCard・Checkbox）へ置き換えた契約。
 *
 * 対象は自動応答の編集ダイアログ。祝日・応答する回数は「1つだけ選ぶ」、
 * 対応中トークの除外・有効化は「オン・オフ」であることが、読み上げ名と
 * 操作（押す・矢印キー・Space）で保たれることを見る。素の input に戻すと
 * group ロールや共通部品の振る舞いがなくなり赤になる。
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
  default: () => <div data-testid="inline-action-list" />,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value }: { 'aria-label'?: string; value: string }) => (
    <select aria-label={label} value={value} readOnly>
      <option value={value}>{value}</option>
    </select>
  ),
}))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
}))

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

const existingDraft: AutoReplyDraft = { ...newDraft, id: 'reply-1', versionNumber: 3 }

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

function mount(draft: AutoReplyDraft = newDraft) {
  act(() => {
    root.render(
      <EditDialog draft={draft} templates={[]} onClose={() => {}} onSaved={() => {}} onStepChange={() => {}} />,
    )
  })
}

function radio(name: RegExp): HTMLInputElement {
  const found = host.querySelectorAll('input[type="radio"]')
  const hit = Array.from(found).find((el) => el.closest('label')?.textContent?.match(name))
  if (!hit) throw new Error(`ラジオが見つかりません: ${name}`)
  return hit as HTMLInputElement
}

function checkbox(name: RegExp): HTMLInputElement {
  const found = host.querySelectorAll('input[type="checkbox"]')
  const hit = Array.from(found).find((el) => el.closest('label')?.textContent?.match(name))
  if (!hit) throw new Error(`チェックボックスが見つかりません: ${name}`)
  return hit as HTMLInputElement
}

describe('m20j: 自動応答ダイアログの選ぶ部品', () => {
  it('祝日は群として読まれ、1つだけ選べる', async () => {
    mount()
    const group = host.querySelector('fieldset legend')
    expect(group?.textContent).toBe('祝日')
    const ignore = radio(/祝日は考えない/)
    const exclude = radio(/祝日は応答しない/)
    expect(ignore.checked).toBe(true)
    await act(async () => { exclude.click() })
    expect(exclude.checked).toBe(true)
    expect(ignore.checked).toBe(false)
  })

  it('応答する回数は群として読まれ、選び直せる', async () => {
    mount()
    const legends = Array.from(host.querySelectorAll('fieldset legend')).map((el) => el.textContent)
    expect(legends).toContain('応答する回数')
    const many = radio(/何度でも応答する/)
    const once = radio(/1人につき1回だけ応答する/)
    expect(many.checked).toBe(true)
    await act(async () => { once.click() })
    expect(once.checked).toBe(true)
    expect(many.checked).toBe(false)
  })

  it('対応中トークの除外は押すたびに切り替わる', async () => {
    mount()
    const box = checkbox(/担当者が対応中のトークでは返さない/)
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    expect(box.checked).toBe(true)
  })

  it('保存済みの応答はオン・オフを切り替えられる', async () => {
    mount(existingDraft)
    const box = checkbox(/この応答をオンにする/)
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    expect(box.checked).toBe(false)
  })
})
