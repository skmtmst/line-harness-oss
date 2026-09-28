// @vitest-environment happy-dom
/*
 * R259〜R263（監査・2026-09-27）: 友だち追加時の配信の編集画面。
 *  - R259: 保存済みの「判定する人」は読取専用。新規では両方選べる。
 *  - R261: 再追加「何も配信しない」は本文・時刻・シナリオを適用外として出す。
 *  - R262: 確認段のテストは経路・想定日時・友だちを指定して実行側と同じ判定へ渡す。
 *  - R263: 再追加シナリオの開始位置（最初から/前回配信した次から）を選び・保存・再読込する。
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- lightweight component mocks for interaction coverage */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ search: 'step=basic' }))
const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
const api = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  conflicts: vi.fn(),
  createDraft: vi.fn(),
  saveDraft: vi.fn(),
  test: vi.fn(),
  friends: { list: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(state.search),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/dialog', () => ({ default: () => null }))
vi.mock('@/components/shared/confirm-dialog', () => ({ default: () => null }))
vi.mock('@/components/shared/icon-button', () => ({ default: () => null }))
vi.mock('@/components/shared/list-state', () => ({ default: ({ title }: any) => <div>{title}</div> }))
vi.mock('@/components/shared/select', () => ({
  default: ({ value, onChange, options, disabled, ...rest }: any) => (
    <select aria-label={rest['aria-label']} value={value} disabled={disabled}
      onChange={(event: any) => onChange?.(event.target.value)}>
      {options.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/shared/sticky-bar', () => ({ default: ({ actions }: any) => <div>{actions}</div> }))
vi.mock('@/components/shared/text-field', () => ({
  TextField: (props: any) => <input {...props} />,
  TextArea: (props: any) => <textarea {...props} />,
}))
vi.mock('@/components/shared/date-time-field', () => ({
  default: ({ value, onChange, ...rest }: any) => <input {...rest} value={value} onChange={(event: any) => onChange?.(event.target.value)} />,
  TimeField: ({ value, onChange, ...rest }: any) => <input {...rest} value={value} onChange={(event: any) => onChange?.(event.target.value)} />,
}))
vi.mock('@/components/shared/button', () => ({
  default: ({ href, children, ...props }: any) => (href ? <a href={href}>{children}</a> : <button {...props}>{children}</button>),
}))
vi.mock('@/components/shared/line-preview', () => ({ default: ({ caption, children }: any) => <div data-caption={caption}>{children}</div> }))
vi.mock('@/lib/api', async (importOriginal) => {
  // describeSaveFailure など通信口でないものは本物のままにする。
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friendAddRules: {
        list: api.list, conflicts: api.conflicts, get: api.get,
        createDraft: api.createDraft, saveDraft: api.saveDraft, test: api.test,
      },
      friends: { list: api.friends.list },
    },
  }
})

const { default: Editor } = await import('./friend-add-rule-editor')

const OPTIONS = {
  routes: [{ id: 'route-1', name: '紹介QR', kind: 'QR' }],
  scenarios: [{ id: 'scenario-1', name: '再案内シナリオ' }],
  tags: [],
  folders: [],
}

const BASE_DEFINITION = {
  routeIds: ['route-1'], scenarioId: 'scenario-1', messageType: 'text',
  messageText: 'おかえりなさい', timing: 'immediate', actions: [],
  friendCondition: '', activeFrom: null, activeUntil: null,
  resendSuppressionHours: 24, weekdays: [], timeWindows: [],
  deliveryChoices: { sendWelcomeMessage: true, startScenario: true, runActions: true },
  unknownRouteAction: { sendCommonGuidance: true, notifyStaff: false },
}

function savedRule(overrides: Record<string, unknown> = {}) {
  return {
    name: '再追加の案内', folderName: null, priority: 2, friendKind: 'returning',
    isFallback: false, status: 'draft', matchedLast7Days: 3, lastTestStatus: null,
    version: 2, routeNames: ['紹介QR'], scenarioName: '再案内シナリオ',
    definition: { ...BASE_DEFINITION, returningMode: 'other', startPosition: 'beginning' },
    ...overrides,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.search = 'step=basic'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  navigation.replace.mockReset()
  api.get.mockReset()
  api.saveDraft.mockReset().mockResolvedValue({ success: true, data: { id: 'rule-1', version: 3 } })
  api.test.mockReset().mockResolvedValue({
    success: true,
    data: { stateChanged: false, ruleId: 'rule-1', matched: true, reasons: ['確認できました。'], scenarioId: null, message: null, actions: [] },
  })
  api.conflicts.mockReset().mockResolvedValue({ success: true, data: { rules: [], conflicts: [] } })
  api.list.mockReset().mockResolvedValue({ success: true, data: { items: [], options: OPTIONS } })
  api.friends.list.mockReset().mockResolvedValue({ success: true, data: { items: [] } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render(ruleId?: string) {
  await act(async () => {
    root.render(<Editor ruleId={ruleId} />)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

async function renderExisting(definition?: Record<string, unknown>) {
  const rule = savedRule(definition ? { definition: { ...BASE_DEFINITION, ...definition } } : {})
  api.get.mockResolvedValue({ success: true, data: { rule, options: OPTIONS } })
  await render('rule-1')
}

function select(label: string) {
  const node = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null
  if (!node) throw new Error(`${label}: ${host.textContent}`)
  return node
}

async function choose(label: string, value: string) {
  const node = select(label)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function button(label: string) {
  const node = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(label))
  if (!node) throw new Error(`${label}: ${host.textContent}`)
  return node
}

async function input(label: string, value: string) {
  const node = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null
  if (!node) throw new Error(`${label}: ${host.textContent}`)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('R259 保存済みの「判定する人」は変えられないと操作前に分かる', () => {
  it('保存済みは選択欄が無効になり、理由と作り直しの入口を説明する', async () => {
    await renderExisting()
    expect(select('判定する人').disabled).toBe(true)
    expect(host.textContent).toContain('保存したあとの設定では変えられません')
    expect(host.textContent).toContain('一覧から新しく作ってください')
  })

  it('新規作成では両方の種別を選べる', async () => {
    await render()
    const field = select('判定する人')
    expect(field.disabled).toBe(false)
    expect(host.textContent).toContain('保存したあとは変えられません。')
    await choose('判定する人', 'returning')
    expect(select('判定する人').value).toBe('returning')
  })
})

describe('R263 再追加シナリオの開始位置を選び・保存・再読込する', () => {
  it('「別のシナリオ」で開始位置を選ぶと保存値に乗る', async () => {
    await renderExisting({ returningMode: 'other', startPosition: 'beginning' })
    expect(select('再追加時の開始位置').value).toBe('beginning')
    await choose('再追加時の開始位置', 'resume')
    await act(async () => { button('下書き保存').click(); await Promise.resolve() })
    expect(api.saveDraft).toHaveBeenCalled()
    const payload = api.saveDraft.mock.calls[0][1] as { definition: { startPosition: string } }
    expect(payload.definition.startPosition).toBe('resume')
  })

  it('保存済みの「前回配信した次から」を再読込で復元する', async () => {
    await renderExisting({ returningMode: 'other', startPosition: 'resume' })
    expect(select('再追加時の開始位置').value).toBe('resume')
  })

  it('「何も配信しない」では開始位置を出さない', async () => {
    await renderExisting({ returningMode: 'none' })
    expect(host.querySelector('select[aria-label="再追加時の開始位置"]')).toBeNull()
  })
})

describe('R261 再追加「何も配信しない」は配信欄を適用外にする', () => {
  it('初回案内の段は本文必須ではなく「届けない」説明とアクションだけを出す', async () => {
    state.search = 'step=message'
    await renderExisting({ returningMode: 'none' })
    expect(host.textContent).toContain('メッセージを届けません')
    expect(host.textContent).toContain('アクションだけ')
    // 本文・送信時刻・シナリオの入力欄は出さない
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('select[aria-label="次に流すシナリオ"]')).toBeNull()
    expect(host.querySelector('select[aria-label="追加から送信まで"]')).toBeNull()
  })

  it('プレビューの吹き出しは「再追加では配信しません」と出す', async () => {
    state.search = 'step=message'
    await renderExisting({ returningMode: 'none' })
    expect(host.querySelector('[data-caption="再追加では配信しません"]')).not.toBeNull()
  })

  it('「別のシナリオ」では通常どおり本文・シナリオ欄を出す', async () => {
    state.search = 'step=message'
    await renderExisting({ returningMode: 'other' })
    expect(host.querySelector('textarea')).not.toBeNull()
    expect(select('次に流すシナリオ')).not.toBeNull()
  })
})

describe('R262 確認段のテストは経路・日時・友だちを指定できる', () => {
  it('試す流入リンク・想定日時・試す友だちをテストAPIへ渡す', async () => {
    state.search = 'step=preview'
    await renderExisting()
    await choose('試す流入リンク', 'route-1')
    await input('想定日時', '2026-09-28T10:00')
    await input('試す友だちを検索', '山田')
    // 検索は300ms待ってから一覧口を叩く
    api.friends.list.mockResolvedValue({
      success: true,
      data: { items: [{ id: 'friend-1', displayName: '山田 太郎' }] },
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
    const result = [...host.querySelectorAll('.friend-add-editor-friendResults button')]
      .find((item) => item.textContent?.includes('山田 太郎'))
    if (!result) throw new Error(`friend result: ${host.textContent}`)
    await act(async () => { (result as HTMLButtonElement).click() })
    await act(async () => { button('テスト送信').click(); await Promise.resolve() })
    expect(api.test).toHaveBeenCalledWith('account-a', 'rule-1', {
      routeId: 'route-1', expectedAt: '2026-09-28T10:00', friendId: 'friend-1',
    })
  })

  it('試行条件を指定しなければ「いま・どの経路でも・友だち不問」で送る', async () => {
    state.search = 'step=preview'
    await renderExisting()
    await act(async () => { button('テスト送信').click(); await Promise.resolve() })
    expect(api.test).toHaveBeenCalledWith('account-a', 'rule-1', {
      routeId: null, expectedAt: null, friendId: null,
    })
  })
})
