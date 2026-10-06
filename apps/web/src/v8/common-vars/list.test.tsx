// @vitest-environment happy-dom
/*
 * V8 共通情報の一覧（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が出る・札で絞れる・行の「…」から止める窓と削除の窓が開く（板 Hhl9M・xxKtW）・
 * 閲覧のみでは帯が出て作れない・空のまま使われている帯の「直す」で絞れる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listVars = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const deleteImpact = vi.hoisted(() => vi.fn())
const replacementCandidates = vi.hoisted(() => vi.fn())
const replacementImpact = vi.hoisted(() => vi.fn())
const listExports = vi.hoisted(() => vi.fn())
const staffRole = vi.hoisted(() => ({ value: 'owner' as string }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        list: listVars,
        deleteImpact,
        replacementCandidates,
        replacementImpact,
        listExports,
      },
      folders: { ...actual.api.folders, list: listFolders },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => staffRole.value }
})

import CommonVarsListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const base = {
  lineAccountId: 'account-a',
  type: 'text',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  nextSchedule: null,
  pendingScheduleCount: 0,
  validFrom: null,
  validUntil: null,
}
const company = { ...base, id: 'v-company', folderId: null, name: '会社名', varKey: 'company_name', value: '株式会社NEN', usageCount: 15 }
const contact = { ...base, id: 'v-contact', folderId: null, name: '問い合わせ先', varKey: 'contact', value: '', usageCount: 2 }
const notice = { ...base, id: 'v-notice', folderId: null, name: '臨時のお知らせ', varKey: 'temp_notice', value: '本日は17時まで', state: 'draft', usageCount: 0 }

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  staffRole.value = 'owner'
  listVars.mockImplementation(async () => ({ success: true, data: [company, contact, notice] }))
  listFolders.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 3 }))
  listExports.mockImplementation(async () => ({ success: true, data: [] }))
  deleteImpact.mockImplementation(async () => ({
    success: true,
    data: {
      variable: { id: 'v-company', name: '会社名', varKey: 'company_name' },
      total: 15,
      blockingTotal: 15,
      historicalTotal: 0,
      unscopedFormTotal: 0,
      canDelete: false,
      byKind: {},
      items: [
        { kind: 'broadcast', kindLabel: '一斉配信', name: '10月のお知らせ', status: '配信予約中', href: '/broadcasts/edit?id=b1', blocksDeletion: true, currentPreview: '' },
      ],
      unavailableReferences: [],
      checkedAt: '2026-09-07T10:00:00.000+09:00',
      recommendedAction: 'review_references',
    },
  }))
  replacementCandidates.mockImplementation(async () => ({ success: true, data: { source: { id: 'v-company', name: '会社名', type: 'text', version: 1 }, candidates: [] } }))
  replacementImpact.mockImplementation(async () => ({ success: false, error: 'none' }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
  expect(found, `「${label}」のボタンがありません`).toBeTruthy()
  return found as HTMLButtonElement
}

function buttonByText(text: string): HTMLElement {
  const found = [...document.querySelectorAll('button, [role="menuitem"]')]
    .find((element) => element.textContent?.trim() === text) as HTMLElement | undefined
  expect(found, `「${text}」がありません`).toBeTruthy()
  return found as HTMLElement
}

describe('V8 共通情報の一覧（src/v8）の動き', () => {
  it('行が出て、数の帯と空のままの帯が出る', async () => {
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    expect(host.textContent).toContain('会社名')
    expect(host.textContent).toContain('{{var.company_name}}')
    expect(host.textContent).toContain('問い合わせ先')
    expect(host.textContent).toContain('差し込んでいる所')
    expect(host.textContent).toContain('「問い合わせ先」が空のまま 2か所で使われています。')
  })

  it('札「下書き・止めた」で下書きだけになり、もう一度押すと戻る', async () => {
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    act(() => { buttonByText('下書き・止めた').click() })
    await flush()
    expect(host.textContent).toContain('臨時のお知らせ')
    expect(host.textContent).not.toContain('株式会社NEN')
    act(() => { buttonByText('下書き・止めた').click() })
    await flush()
    expect(host.textContent).toContain('株式会社NEN')
  })

  it('空のままの帯の「直す」で、空のものだけに絞る', async () => {
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    const fix = [...host.querySelectorAll('[role="status"] button')].find((b) => b.textContent === '直す') as HTMLButtonElement
    expect(fix, '帯の「直す」がありません').toBeTruthy()
    act(() => { fix.click() })
    await flush()
    expect(host.textContent).not.toContain('株式会社NEN')
    expect(host.textContent).toContain('{{var.contact}}')
  })

  it('行の「…」から止める窓（Hhl9M）が開き、予約中の配信を知らせる', async () => {
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    act(() => { buttonByLabel('共通情報「会社名」の操作').click() })
    await flush()
    act(() => { buttonByText('止める').click() })
    await flush()
    expect(document.body.textContent).toContain('「会社名」を止める')
    expect(document.body.textContent).toContain('予約中の一斉配信「10月のお知らせ」が送られなくなります。')
  })

  it('行の「…」から削除の窓（xxKtW）が開き、使われているものは「まだ消せません」', async () => {
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    act(() => { buttonByLabel('共通情報「会社名」の操作').click() })
    await flush()
    act(() => { buttonByText('削除する').click() })
    await flush()
    expect(document.body.textContent).toContain('「会社名」はまだ消せません')
    expect(document.body.textContent).toContain('どうしますか')
    expect(document.body.textContent).toContain('消さずに止める')
  })

  it('閲覧のみ（staff）では帯が出て、作るボタンは押せない', async () => {
    staffRole.value = 'staff'
    act(() => { root.render(<CommonVarsListV8 />) })
    await flush()
    expect(host.textContent).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
    const create = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('共通情報を作る'))
    expect(create.length).toBeGreaterThan(0)
    for (const button of create) expect(button.disabled).toBe(true)
  })
})
