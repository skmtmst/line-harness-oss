// @vitest-environment happy-dom
/*
 * R589・R590：共通情報の取得失敗を分けて案内する。
 *
 * R589：フォルダだけ503/403でも、取得済みの共通情報一覧と使用中の
 * 空欄警告は残す。フォルダ欄だけ対象の失敗と再試行（503）または
 * 権限案内（403）を出す。
 * R590：一覧GETの403は権限不足、503は通信障害と再試行として区別する。
 */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { CommonVar } from '@line-crm/shared'
import { ApiError } from '@/lib/api'

const api = vi.hoisted(() => ({
  varsList: vi.fn(),
  listExports: vi.fn(),
  foldersList: vi.fn(),
  staffMe: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: api.staffMe },
      commonVars: {
        ...actual.api.commonVars,
        list: api.varsList,
        listExports: api.listExports,
      },
      folders: { ...actual.api.folders, list: api.foldersList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
    back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))

vi.mock('@/components/feature-gate', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}))

import CommonVarsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function itemOf(id: string, name: string, value: string, usageCount: number): CommonVar {
  return {
    id,
    lineAccountId: 'account-1',
    folderId: null,
    name,
    varKey: `key_${id}`,
    type: 'text',
    value,
    validFrom: null,
    validUntil: null,
    fallbackValue: null,
    expiryBehavior: 'stop',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    usageCount,
  }
}

const VARS = [
  itemOf('var-1', '営業時間', '10:00〜19:00', 3),
  itemOf('var-2', '空のままの案内', '', 2),
]

const FOLDERS = [{ id: 'folder-1', kind: 'common_var', name: '店舗', createdAt: '2026-09-01T00:00:00.000Z' }]

beforeEach(() => {
  vi.clearAllMocks()
  api.varsList.mockResolvedValue({ success: true, data: VARS, meta: { limited: false } })
  api.listExports.mockResolvedValue({ success: true, data: [] })
  api.foldersList.mockResolvedValue({ success: true, data: FOLDERS })
  api.staffMe.mockResolvedValue({ success: true, data: { role: 'owner' } })
})

afterEach(() => {
  cleanup()
})

function folderPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('aside[aria-label="フォルダ"]')
  if (!panel) throw new Error('フォルダパネルがありません')
  return panel
}

describe('R589 フォルダだけの失敗は一覧と警告を隠さない', () => {
  it('フォルダ503でも共通情報一覧と空欄警告は残し、フォルダ欄だけ失敗と再試行を出す', async () => {
    api.foldersList.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    render(<CommonVarsPage />)

    // 取得済みの一覧と使用中の空欄警告は残る。
    expect(await screen.findByText('営業時間')).toBeTruthy()
    expect(screen.getByText(/中身が空のまま使われているものが/)).toBeTruthy()
    expect(screen.queryByText('共通情報を読み込めませんでした')).toBeNull()
    // フォルダ欄だけ失敗と再試行。
    const panel = folderPanel()
    expect(panel.textContent).toContain('フォルダを読み込めませんでした')
    const retry = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読み込む')
    expect(retry).toBeTruthy()
  })

  it('フォルダ欄の再試行で復旧する', async () => {
    api.foldersList.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    render(<CommonVarsPage />)
    // 一覧の取得を先に待ち、フォルダの失敗の解決も待つ。
    // 注記は縦パネルと狭い幅の選択欄の2か所に出るため、パネル内に絞って探す。
    expect(await screen.findByText('営業時間')).toBeTruthy()
    expect(await within(folderPanel()).findByText(/フォルダを読み込めませんでした/)).toBeTruthy()

    api.foldersList.mockResolvedValue({ success: true, data: FOLDERS })
    const retry = [...folderPanel().querySelectorAll('button')]
      .find((button) => button.textContent === 'もう一度読み込む')!
    await act(async () => { fireEvent.click(retry) })
    expect(await screen.findByText('店舗')).toBeTruthy()
    expect(folderPanel().textContent).not.toContain('フォルダを読み込めませんでした')
    expect(screen.getByText('営業時間')).toBeTruthy()
  })

  it('フォルダ403でも一覧は残し、フォルダ欄は権限案内で再試行は出さない', async () => {
    api.foldersList.mockRejectedValue(new ApiError(403, 'Forbidden'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('営業時間')).toBeTruthy()
    expect(screen.queryByText('共通情報を読み込めませんでした')).toBeNull()
    const panel = folderPanel()
    expect(panel.textContent).toContain('フォルダを見る権限がありません')
    const retry = [...panel.querySelectorAll('button')].find((button) => button.textContent === 'もう一度読み込む')
    expect(retry).toBeUndefined()
  })
})

describe('R590 一覧の403と503を区別する', () => {
  it('一覧403は権限案内で再試行も作成口も出さない', async () => {
    api.varsList.mockRejectedValue(new ApiError(403, 'Forbidden'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('共通情報を見る権限がありません')).toBeTruthy()
    expect(screen.getByText(/管理者に権限を申請してください/)).toBeTruthy()
    expect(screen.queryByText('通信が切れたか')).toBeNull()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
    // 読めていないのに作る口は出さない。
    expect(screen.queryByRole('link', { name: '＋ 共通情報を作る' })).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 共通情報を作る' })).toBeNull()
  })

  it('一覧503は通信障害と再試行を出し、復旧できる', async () => {
    api.varsList.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('共通情報を読み込めませんでした')).toBeTruthy()
    expect(screen.getByText(/接続を確かめて/)).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'もう一度読み込む' })
    await act(async () => { fireEvent.click(retry) })
    expect(await screen.findByText('営業時間')).toBeTruthy()
  })
})

describe('m26m 一覧の取得失敗は件数を0と誤案内しない', () => {
  function allRowText(): string {
    const panel = folderPanel()
    const allRow = [...panel.querySelectorAll('button')]
      .find((button) => button.textContent?.startsWith('すべて'))
    if (!allRow?.textContent) throw new Error('「すべて」の行がありません')
    return allRow.textContent
  }

  it('一覧403は「すべて 0」「0件」と言わず、権限案内のまま件数を未知にする', async () => {
    api.varsList.mockRejectedValue(new ApiError(403, 'Forbidden'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('共通情報を見る権限がありません')).toBeTruthy()
    // 成功時0件と区別する。フォルダ欄の「すべて」に 0 を付けない。
    expect(allRowText()).not.toContain('0')
    // 狭い幅の選択欄も「すべて（0件）」と言わない。
    expect(document.body.textContent).not.toContain('すべて（0件）')
    // 表の下に「0件」を出さない。
    expect(screen.queryByText('0件')).toBeNull()
  })

  it('一覧503も件数を未知にし、再試行の復旧後は実件数を戻す', async () => {
    api.varsList.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('共通情報を読み込めませんでした')).toBeTruthy()
    expect(allRowText()).not.toContain('0')
    expect(document.body.textContent).not.toContain('すべて（0件）')
    expect(screen.queryByText('0件')).toBeNull()

    const retry = screen.getByRole('button', { name: 'もう一度読み込む' })
    await act(async () => { fireEvent.click(retry) })
    expect(await screen.findByText('営業時間')).toBeTruthy()
    // 復旧後は実件数（2件）を戻す。
    expect(await screen.findByText(/2件中/)).toBeTruthy()
    expect(allRowText()).toContain('2')
  })

  it('フォルダだけ失敗したときは取得済み一覧の実件数を維持する', async () => {
    api.foldersList.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    render(<CommonVarsPage />)

    expect(await screen.findByText('営業時間')).toBeTruthy()
    // 一覧は読めているので実件数を出す。未知にしない。
    expect(screen.getByText(/2件中/)).toBeTruthy()
    expect(allRowText()).toContain('2')
  })
})
