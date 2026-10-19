// @vitest-environment happy-dom
/*
 * 更新スケジュールの操作が、保存していない入力を消さないことを本物の
 * React(react-dom/client)で確かめる試験（監査R219・R221）。
 *
 * 以前は予定の追加・削除のあと `load` で詳細を読み直していて、
 * 名前・値・メモ・期間の入力中の内容まで保存済みの値へ戻ってしまった。
 * ここでは「予定を削除しても入力は残る」「チェックを外すと消す確認が
 * 出る」を実mountで見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  foldersList: vi.fn(),
  detail: vi.fn(),
  schedules: vi.fn(),
  update: vi.fn(),
  impactPreview: vi.fn(),
  deleteImpact: vi.fn(),
  addSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        detail: api.detail,
        schedules: api.schedules,
        update: api.update,
        impactPreview: api.impactPreview,
        deleteImpact: api.deleteImpact,
        addSchedule: api.addSchedule,
        deleteSchedule: api.deleteSchedule,
      },
      folders: { ...actual.api.folders, list: api.foldersList },
    },
  }
})

vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const navigation = vi.hoisted(() => ({ query: 'id=var-1' }))
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string
    id?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

import EditCommonVarPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function mount(element: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(element) })
}

async function unmount() {
  await act(async () => { root.unmount() })
  host.remove()
}

/** 効果(Promise.all([detail, folders, schedules]))が落ち着くまで進める。 */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

function byExactText(tag: string, text: string, explicitScope?: ParentNode): HTMLElement {
  const dialog = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).at(-1)
  const scope = explicitScope ?? (text === 'キャンセル' && dialog ? dialog : document)
  const found = Array.from(scope.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

/** V8の社内メモ欄を読む。 */
function memoInput(): HTMLInputElement {
  return byId('cv-memo') as HTMLInputElement
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    if (element instanceof HTMLSelectElement) element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

const baseVar = {
  id: 'var-1', name: '期間案内', varKey: 'period_notice', type: 'text', value: '受付中',
  memo: '', folderId: null, version: 3, history: [],
  validFrom: null, validUntil: null, expiryBehavior: 'stop', fallbackValue: null,
}

const scheduleRow = {
  id: 's-1', varId: 'var-1',
  effectiveFrom: '2026-10-01T15:00:00.000Z', value: '次の値', appliedAt: null,
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  vi.clearAllMocks()
  navigation.query = 'id=var-1'
  api.foldersList.mockResolvedValue({ success: true, data: [] })
  api.schedules.mockResolvedValue({ success: true, data: [] })
  api.impactPreview.mockResolvedValue({ success: true, data: { impactProof: 'proof-1', canSave: true, total: 0, blockingTotal: 0, byKind: {}, items: [], unavailableReferences: [], checkedAt: '2026-09-16T00:00:00Z' } })
  api.deleteImpact.mockResolvedValue({ success: true, data: { total: 0, blockingTotal: 0, byKind: {}, items: [], unavailableReferences: [], checkedAt: '2026-09-16T00:00:00Z' } })
  api.update.mockResolvedValue({ success: true, data: { id: 'var-1' } })
  api.addSchedule.mockResolvedValue({ success: true, data: scheduleRow })
  api.deleteSchedule.mockResolvedValue({ success: true, data: null })
})

afterEach(async () => {
  if (root) await unmount()
  vi.restoreAllMocks()
})

describe('共通情報: 更新スケジュールの操作で入力中の内容が消えない(R219・R221, 実React)', () => {
  it('予定を削除しても、入力中の名前・値・メモは残る', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.schedules.mockResolvedValue({ success: true, data: [scheduleRow] })
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    // 保存しないまま入力する。
    await setValue(byId('cv-name'), '入力中の名前')
    await setValue(byId('cv-value'), '入力中の値')
    await setValue(memoInput(), '入力中のメモ')

    await click(byExactText('button', '予定を消す'))
    expect(api.deleteSchedule).not.toHaveBeenCalled()
    await click(byExactText('button', '削除する', document.querySelector('[role="alertdialog"]')!))
    await settle()

    expect(api.deleteSchedule).toHaveBeenCalledWith('var-1', 's-1', 'account-1')
    // 予定一覧は取り直すが、入力欄は保存済みの値へ戻さない。
    expect(api.schedules.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect((byId('cv-name') as HTMLInputElement).value).toBe('入力中の名前')
    expect((byId('cv-value') as HTMLInputElement).value).toBe('入力中の値')
    expect(memoInput().value).toBe('入力中のメモ')
  })

  it('予定を追加しても、入力中の名前・値は残る', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    await setValue(byId('cv-name'), '入力中の名前')
    await setValue(byId('cv-value'), '入力中の値')

    // 現役V8の操作で予定の入力窓を開く。
    await click(byExactText('button', '予定を足す'))
    await setValue(byId('sc-value'), '切替後の値')
    await click(byExactText('button', '登録する'))
    await settle()

    expect(api.addSchedule).toHaveBeenCalled()
    expect((byId('cv-name') as HTMLInputElement).value).toBe('入力中の名前')
    expect((byId('cv-value') as HTMLInputElement).value).toBe('入力中の値')
  })

  it('予定を消すを押すと、いきなり消さず確認窓を出す', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.schedules.mockResolvedValue({ success: true, data: [scheduleRow] })
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    await click(byExactText('button', '予定を消す'))
    // 確認窓が開き、まだ消していない。
    expect(document.body.textContent).toContain('「更新の予定」を削除しますか')
    expect(api.deleteSchedule).not.toHaveBeenCalled()

    // 確認すると全件消して一覧を取り直す。入力中の値は残る。
    await click(byExactText('button', 'キャンセル'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    await setValue(byId('cv-name'), '入力中の名前')
    await click(byExactText('button', '予定を消す'))
    await click(byExactText('button', '削除する', document.querySelector('[role="alertdialog"]')!))
    await settle()
    expect(api.deleteSchedule).toHaveBeenCalledWith('var-1', 's-1', 'account-1')
    expect((byId('cv-name') as HTMLInputElement).value).toBe('入力中の名前')
  })

  it('入力中の予定をキャンセルするだけなら削除の確認窓は出さない', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    await click(byExactText('button', '予定を足す'))
    expect(document.querySelector('#sc-value')).not.toBeNull()
    await setValue(byId('sc-value'), '入力中の予定')
    await click(byExactText('button', 'キャンセル'))
    // V8の共通窓は入力の破棄を確認する。保存済みの予定の削除とは別。
    expect(document.body.textContent).toContain('入力を破棄しますか？')
    await click(byExactText('button', '破棄する'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    expect(document.querySelector('#sc-value')).toBeNull()
    expect(document.body.textContent).not.toContain('「更新の予定」を削除しますか')
    expect(api.deleteSchedule).not.toHaveBeenCalled()
    expect(api.addSchedule).not.toHaveBeenCalled()
  })
})
