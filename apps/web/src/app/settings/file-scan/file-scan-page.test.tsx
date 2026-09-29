// @vitest-environment happy-dom
/*
 * 設定の中の「ファイルの検査」（B-2）を本物の React で動かす試験。
 * 見るのは主な状態の言い分けだけ:
 *   - 空 … 当てはまるファイルがありません
 *   - 読み込み中 … 待っている表示
 *   - 失敗 … 読み込めませんでした＋読み直し
 *   - 権限なし … 管理者だけの表示
 *   - 正常 … 表の行・件数・操作
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileScanItem } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  accountId: 'acc-1' as string | null,
  me: vi.fn(),
  list: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: mocks.accountId }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => '/settings/file-scan',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: {
        ...actual.api.staff,
        me: mocks.me,
      },
      fileScan: {
        ...actual.api.fileScan,
        list: mocks.list,
        getConfig: mocks.getConfig,
        saveConfig: mocks.saveConfig,
      },
    },
  }
})

import FileScanSettingsPage from './page'

afterEach(() => cleanup())

const scanOf = (overrides: Partial<FileScanItem> = {}): FileScanItem => ({
  id: 'scan-1',
  lineAccountId: 'acc-1',
  subjectKind: 'media',
  subjectId: 'md-1',
  mediaId: 'md-1',
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 220000,
  status: 'quarantined',
  reasonCode: 'pdf_active_content',
  reasonLabel: '危険な仕掛けが見つかりました',
  uploaderLabel: '川野',
  attempts: 0,
  nextRetryAt: null,
  scannedAt: '2026-09-25T10:00:00+09:00',
  quarantinedAt: '2026-09-25T10:00:00+09:00',
  releasedAt: null,
  releaseReason: null,
  createdAt: '2026-09-25T10:00:00+09:00',
  updatedAt: '2026-09-25T10:00:00+09:00',
  ...overrides,
})

function ready() {
  mocks.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  mocks.getConfig.mockResolvedValue({ success: true, data: { config: null } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.accountId = 'acc-1'
})

describe('ファイルの検査の設定画面', () => {
  test('正常時は表の行と件数と操作が出る', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('invoice.pdf')).toBeTruthy()
    })
    expect(screen.getByText('川野')).toBeTruthy()
    expect(screen.getByText('危険な仕掛けが見つかりました')).toBeTruthy()
    expect(screen.getByText('1件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    // 消すは「…」の中の危ない操作として入る。
    expect(screen.getByRole('button', { name: 'invoice.pdfのその他操作' })).toBeTruthy()
    // 中身は画面に出さない。理由の言葉だけ。
    expect(screen.queryByText(/JavaScript/)).toBeNull()
  })

  test('空の時は作成導線なしの表示', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('当てはまるファイルがありません')).toBeTruthy()
    })
  })

  test('失敗時は読み込めませんでしたと読み直し', async () => {
    ready()
    mocks.list.mockRejectedValue(new Error('network'))
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('ファイルの検査を読み込めませんでした')).toBeTruthy()
    })
  })

  test('管理者以外は入れない', async () => {
    mocks.me.mockResolvedValue({ success: true, data: { role: 'staff' } })
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0, limit: 50, offset: 0 } })
    mocks.getConfig.mockResolvedValue({ success: true, data: { config: null } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('ファイルの検査は管理者だけが開けます')).toBeTruthy()
    })
  })

  test('戻す操作は理由を入れる欄と一緒に出る', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '使えるように戻す' }))
    expect(screen.getByLabelText(/理由/)).toBeTruthy()
  })

  test('51件以上あるときページ送りが出て、先のページを取りに行く (監査R132)', async () => {
    ready()
    mocks.list.mockImplementation((_id: string, params?: { offset?: number }) =>
      Promise.resolve({ success: true, data: { items: [scanOf()], total: 51, limit: 50, offset: params?.offset ?? 0 } }))
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '次のページ' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith('acc-1', expect.objectContaining({ offset: 50 }))
    })
  })

  test('ファイル名で探すと検索語をAPIへ渡す (監査R132)', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    const input = await screen.findByLabelText('ファイル名で探す')
    fireEvent.change(input, { target: { value: 'invoice' } })
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith('acc-1', expect.objectContaining({ q: 'invoice' }))
    })
  })

  test('外の検査の有効表示は保存済み設定に従い、止めると設定を消す (監査R133)', async () => {
    ready()
    mocks.getConfig.mockResolvedValue({
      success: true,
      data: {
        config: {
          externalProvider: 'acme-scan',
          externalEndpointUrl: 'https://scan.example.com/check',
          externalSecretRef: 'FILE_SCAN_API_KEY',
          externalTimeoutMs: 10000,
          maxBytesOverride: null,
          maxPixelsOverride: null,
          updatedAt: '2026-09-20T00:00:00Z',
        },
      },
    })
    mocks.saveConfig.mockResolvedValue({ success: true, data: { lineAccountId: 'acc-1' } })
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    // 設定済みなら「使っています」と出る。畳んでいても実行状態の表示は変わらない。
    await waitFor(() => {
      expect(screen.getByText(/使っています。送り先：/)).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: '設定を編集' })).toBeTruthy()
    // 止める操作は確認を経て、実際に設定を消す。
    fireEvent.click(screen.getByRole('button', { name: '外の検査を止める' }))
    await waitFor(() => {
      expect(screen.getByText('外の検査サービスへの送信設定を消します。内蔵の簡易検査は続きます。もう一度使うには設定を入れ直します。')).toBeTruthy()
    })
    fireEvent.click(screen.getAllByRole('button', { name: '外の検査を止める' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.saveConfig).toHaveBeenCalledWith('acc-1', {
        externalProvider: null,
        externalEndpointUrl: null,
        externalSecretRef: null,
      })
    })
  })
})
