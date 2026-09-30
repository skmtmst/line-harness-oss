// @vitest-environment happy-dom
/*
 * 共通情報の編集画面：詳細・フォルダ・更新予定の取得を分ける試験
 * （監査R591・R592、実React）。
 *
 * 以前は `Promise.all([detail, folders, schedules])` で3つをまとめ読み
 * していたため、フォルダか予定の1つが落ちるだけで詳細の結果まで捨て、
 * 画面全体が「読み込めませんでした」になっていた（R591）。予定だけが
 * 404のときも「この共通情報は見つかりません」になっていた（R592）。
 * ここでは詳細200＋フォルダ503、詳細200＋予定404の組み合わせで、
 * 本体（名前・履歴・編集欄）が出たまま、落ちた欄だけ理由と再試行に
 * なることを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

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

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const navigation = vi.hoisted(() => ({ query: 'id=var-1' }))
vi.mock('next/navigation', () => ({
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

/** 効果（詳細→フォルダ・予定）が落ち着くまで進める。 */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

/** 指定の欄の「再読み込み」ボタンを押す。 */
async function retrySection(stateName: 'folders' | 'schedules') {
  const block = document.querySelector(`[data-${stateName}-state="error"]`)
  if (!block) throw new Error(`失敗中の欄が見つかりません: ${stateName}`)
  const button = Array.from(block.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === '再読み込み',
  )
  if (!button) throw new Error(`再読み込みボタンが見つかりません: ${stateName}`)
  await click(button as HTMLElement)
}

const baseVar = {
  id: 'var-1', name: '期間案内', varKey: 'period_notice', type: 'text', value: '受付中',
  memo: '', folderId: null, version: 3,
  history: [
    {
      id: 'h-1', value: '準備中', changeReason: '開店前のため',
      actorName: '担当', actorId: 'u-1', createdAt: '2026-09-10T00:00:00Z',
    },
  ],
  validFrom: null, validUntil: null, expiryBehavior: 'stop', fallbackValue: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  navigation.query = 'id=var-1'
  api.foldersList.mockResolvedValue({ success: true, data: [] })
  api.schedules.mockResolvedValue({ success: true, data: [] })
  api.impactPreview.mockResolvedValue({ success: true, data: { impactProof: 'proof-1' } })
  api.deleteImpact.mockResolvedValue({ success: true, data: { total: 0, blockingTotal: 0, byKind: {}, items: [], checkedAt: '2026-09-16T00:00:00Z' } })
  api.update.mockResolvedValue({ success: true, data: { id: 'var-1' } })
  api.addSchedule.mockResolvedValue({ success: true, data: { id: 's-1' } })
  api.deleteSchedule.mockResolvedValue({ success: true, data: null })
})

afterEach(async () => {
  if (root) await unmount()
  vi.restoreAllMocks()
})

describe('共通情報の編集：フォルダ・予定の取得失敗は本体を消さない(R591・R592, 実React)', () => {
  it('R591: フォルダ503でも値・履歴・編集欄を出し、フォルダ欄だけ理由と再試行にする', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.foldersList.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    // 本体は出る。
    expect((byId('cv-name') as HTMLInputElement).value).toBe('期間案内')
    expect(document.body.textContent).toContain('はじめて登録')
    expect(document.body.textContent).toContain('開店前のため')
    // 画面全体の失敗にならない。
    expect(document.body.textContent).not.toContain('共通情報を読み込めませんでした')
    // フォルダ欄だけ失敗と再試行。
    expect(document.querySelector('[data-folders-state="error"]')?.textContent).toContain('フォルダ')
    expect(document.querySelector('[data-folders-state="error"]')?.textContent).toContain('再読み込み')
  })

  it('R591: フォルダの再試行で直ると失敗表示が消える', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.foldersList.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    api.foldersList.mockResolvedValue({ success: true, data: [{ id: 'f-1', name: '案内' }] })
    await mount(React.createElement(EditCommonVarPage))
    await settle()
    expect(document.querySelector('[data-folders-state="error"]')).not.toBeNull()

    await retrySection('folders')
    await settle()

    expect(document.querySelector('[data-folders-state="error"]')).toBeNull()
    expect(byId('cv-folder').textContent).toContain('案内')
  })

  it('R592: 本体200・予定404では「見つかりません」にせず予定欄だけ失敗にする', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.schedules.mockRejectedValue(new ApiError(404, 'Not Found'))
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    // 本体は出たまま。
    expect((byId('cv-name') as HTMLInputElement).value).toBe('期間案内')
    expect(document.body.textContent).toContain('はじめて登録')
    expect(document.body.textContent).toContain('開店前のため')
    expect(document.body.textContent).not.toContain('この共通情報は見つかりません')
    // 予定欄だけ失敗と再試行。
    expect(document.querySelector('[data-schedules-state="error"]')?.textContent).toContain('更新の予定')
    expect(document.querySelector('[data-schedules-state="error"]')?.textContent).toContain('再読み込み')
  })

  it('R592: 予定の再試行で直ると失敗表示が消える', async () => {
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    api.schedules.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    api.schedules.mockResolvedValue({
      success: true,
      data: [{ id: 's-1', varId: 'var-1', effectiveFrom: '2026-10-01T15:00:00.000Z', value: '次の値', appliedAt: null }],
    })
    await mount(React.createElement(EditCommonVarPage))
    await settle()
    expect(document.querySelector('[data-schedules-state="error"]')).not.toBeNull()

    await retrySection('schedules')
    await settle()

    expect(document.querySelector('[data-schedules-state="error"]')).toBeNull()
    expect(document.body.textContent).toContain('次の値')
  })

  it('本体404はこれまでどおり「見つかりません」にする（後退防止）', async () => {
    api.detail.mockRejectedValue(new ApiError(404, 'Not Found'))
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    expect(document.body.textContent).toContain('この共通情報は見つかりません')
    expect(document.querySelector('#cv-name')).toBeNull()
  })

  it('本体503は画面全体の失敗と再試行にし、直ると本体が出る（後退防止）', async () => {
    api.detail.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    api.detail.mockResolvedValue({ success: true, data: { ...baseVar } })
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    expect(document.body.textContent).toContain('共通情報を読み込めませんでした')
    const retry = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'もう一度読み込む',
    )
    if (!retry) throw new Error('画面全体の再試行ボタンが見つかりません')
    await click(retry as HTMLElement)
    await settle()

    expect((byId('cv-name') as HTMLInputElement).value).toBe('期間案内')
  })
})
