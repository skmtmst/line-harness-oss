// @vitest-environment happy-dom
/*
 * 設定の中の「ファイルの検査」を本物の React で動かす試験。
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
import { ApiError, type FileScanItem } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  accountId: 'acc-1' as string | null,
  me: vi.fn(),
  list: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  release: vi.fn(),
  remove: vi.fn(),
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
    fetchApi: vi.fn(async () => ({ data: { identityRetentionDays: 90 } })),
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
        release: mocks.release,
        remove: mocks.remove,
      },
    },
  }
})

import FileScanSettingsPage from './page'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
  // 一覧のページ・検索語はURLに残る。別の試験の操作を持ち越さない。
  window.history.replaceState(null, '', '/settings/file-scan')
  window.dispatchEvent(new PopStateEvent('popstate'))
  mocks.accountId = 'acc-1'
  // ★V8 の画面は白い板の中に「設定の中のメニュー」を置き、手元の役割（localStorage）を読む。
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
})

describe('ファイルの検査の設定画面', () => {
  const externalConfig = {
    externalProvider: 'scanner', externalEndpointUrl: 'https://scan.example.com/check',
    externalSecretRef: 'FILE_SCAN_SECRET_PRIMARY', externalEnabled: true,
    externalTimeoutMs: 10000, maxBytesOverride: null, maxPixelsOverride: null, updatedAt: '2026-10-12T00:00:00Z',
  }
  async function openConfig(config = externalConfig) {
    ready()
    mocks.getConfig.mockResolvedValue({ success: true, data: { config } })
    mocks.list.mockResolvedValue({ success: true, data: { items: [], total: 0 } })
    render(<FileScanSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '設定を編集' }))
  }
  test.each(['externalProvider', 'externalEndpointUrl', 'externalSecretRef'])('400の%sの理由を該当欄へ出し、入力と編集を保つ', async key => {
    await openConfig()
    const labels: Record<string, string> = { externalProvider: '提供元', externalEndpointUrl: '送り先（https）', externalSecretRef: '鍵の名前' }
    const message = `${labels[key]}を確認してください（サーバーの理由）`
    mocks.saveConfig.mockRejectedValueOnce(new ApiError(400, message, undefined, undefined, undefined, undefined, { [key]: message }))
    fireEvent.click(screen.getByRole('button', { name: '外の検査の設定を保存する' }))
    const input = screen.getByLabelText(labels[key]) as HTMLInputElement
    await waitFor(() => { expect(input.getAttribute('aria-invalid')).toBe('true') })
    const described = input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent).join(' ')
    expect(described).toContain(message)
    await waitFor(() => { expect(document.activeElement).toBe(input) })
    expect(screen.getByLabelText('鍵の名前').getAttribute('value')).toBe(externalConfig.externalSecretRef)
    fireEvent.change(input, { target: { value: input.value + 'A' } })
    await waitFor(() => { expect(screen.queryByText(message)).toBeNull() })
    expect(screen.getByRole('button', { name: '外の検査の設定を保存する' })).toBeTruthy()
  })
  test('許可された組と違う設定の案内と400の理由を両欄へ出す', async () => {
    await openConfig({ ...externalConfig, externalEnabled: false })
    expect(screen.getByText(/送り先と鍵の名前の組を運営に確認/)).toBeTruthy()
    const message = '送り先と鍵の名前は、運営が許可した同じ組で指定してください'
    mocks.saveConfig.mockRejectedValueOnce(new ApiError(400, message, undefined, undefined, undefined, undefined, { externalEndpointUrl: message, externalSecretRef: message }))
    fireEvent.click(screen.getByRole('button', { name: '外の検査の設定を保存する' }))
    for (const label of ['送り先（https）', '鍵の名前']) {
      await waitFor(() => { expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true') })
      expect((screen.getByLabelText(label).getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent).join(' ')).toContain(message)
    }
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByLabelText('送り先（https）')) })
    expect((screen.getByLabelText('鍵の名前') as HTMLInputElement).value).toBe(externalConfig.externalSecretRef)
  })
  test('古い鍵の名前では送信停止の案内を出し、保存せず欄へ誘導する', async () => {
    await openConfig({ ...externalConfig, externalSecretRef: 'FILE_SCAN_API_KEY', externalEnabled: false })
    expect(screen.getByText(/古い鍵の名前は使えません/)).toBeTruthy()
    expect(screen.getByText(/外の検査への送信は停止中です/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '外の検査の設定を保存する' }))
    await waitFor(() => { expect(screen.getByLabelText('鍵の名前').getAttribute('aria-invalid')).toBe('true') })
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })
  test('保存済みの宛先があっても、Workerが無効と返したら送信中と表示しない', async () => {
    await openConfig({ ...externalConfig, externalEnabled: false })
    expect(screen.getByText(/外の検査への送信は停止中です/)).toBeTruthy()
    expect(screen.queryByText(/使っています/)).toBeNull()
    expect(screen.queryByText(/外の検査への送信は有効です/)).toBeNull()
  })
  test('送信が有効でも、疎通を確認済みとは表示しない', async () => {
    await openConfig()
    expect(screen.getByText(/外の検査への送信は有効です/)).toBeTruthy()
    expect(screen.getByText(/接続先の稼働状況を確認した表示ではありません/)).toBeTruthy()
  })
  test('設定保存が通信で失敗しても編集と入力を残す', async () => {
    await openConfig()
    mocks.saveConfig.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: '外の検査の設定を保存する' }))
    expect(await screen.findByText('設定を保存できませんでした。通信状態を確認して、もう一度お試しください。')).toBeTruthy()
    expect((screen.getByLabelText('鍵の名前') as HTMLInputElement).value).toBe(externalConfig.externalSecretRef)
    expect(screen.getByRole('button', { name: '外の検査の設定を保存する' })).toBeTruthy()
  })
  test('保存に成功したら閉じて読み直し、現在の送信状態を反映する', async () => {
    await openConfig()
    fireEvent.change(screen.getByLabelText('提供元'), { target: { value: 'updated-scanner' } })
    mocks.saveConfig.mockResolvedValueOnce({ success: true, data: { lineAccountId: 'acc-1' } })
    mocks.getConfig.mockResolvedValueOnce({ success: true, data: { config: { ...externalConfig, externalProvider: 'updated-scanner', externalEnabled: false } } })
    fireEvent.click(screen.getByRole('button', { name: '外の検査の設定を保存する' }))
    await waitFor(() => { expect(screen.getByText(/外の検査への送信は停止中です/)).toBeTruthy() })
    expect(mocks.saveConfig).toHaveBeenCalledWith('acc-1', {
      externalProvider: 'updated-scanner', externalEndpointUrl: externalConfig.externalEndpointUrl,
      externalSecretRef: externalConfig.externalSecretRef,
    })
    expect(screen.queryByLabelText('鍵の名前')).toBeNull()
    expect(screen.getByRole('button', { name: '設定を編集' })).toBeTruthy()
  })
  test('正常時は表の行と件数と操作が出る', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByText('invoice.pdf')).toBeTruthy()
    })
    expect(screen.getByText('川野')).toBeTruthy()
    expect(screen.getByText('危険な仕掛けが見つかりました')).toBeTruthy()
    // ★V8 ：件数は札「しまったファイル N」に出す。
    expect(screen.getByRole('button', { name: /^しまったファイル \d+$/ })).toBeTruthy()
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
      // ★V8 ：しまったファイルが無いときの言い方。
      expect(screen.getByText('しまったファイルはありません')).toBeTruthy()
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

  test('送信状態が未取得でも保存済みの古い設定を確認して消せる (監査R133)', async () => {
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
    // 古い名前の設定は送信停止。畳んでいても古い設定は削除できる。
    await waitFor(() => {
      expect(screen.getByText(/外の検査への送信状態を確認できません/)).toBeTruthy()
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

  /*
   * 監査 D017: 確認窓の中で起きた失敗は、窓の中に理由を出す。
   * ページ最上部の帯は暗転の後ろに隠れて読めないため、窓の中の
   * 注意表示（role="alert"）へ出し、窓は開いたままにする。
   */
  async function openReleaseDialog() {
    ready()
    mocks.release.mockResolvedValue({ success: true, data: {} })
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    const { container } = render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '使えるように戻す' }))
    const reason = screen.getByLabelText(/理由/)
    fireEvent.change(reason, { target: { value: '社内の画像と確認できたため' } })
    return { container }
  }

  function confirmInDialog(label: string) {
    const buttons = screen.getAllByRole('button', { name: label })
    fireEvent.click(buttons.at(-1)!)
  }

  test('戻すの失敗（409）は窓の中に理由を出し、窓は開いたまま (D017)', async () => {
    const { container } = await openReleaseDialog()
    mocks.release.mockRejectedValueOnce(new ApiError(409, 'version conflict'))
    confirmInDialog('使えるように戻す')
    const message = 'しまったファイルだけ戻せます。一覧を読み直してください。'
    await waitFor(() => {
      expect(screen.getByText(message)).toBeTruthy()
    })
    // 窓は開いたまま（理由欄が残る）。
    expect(screen.getByLabelText(/理由/)).toBeTruthy()
    // ページ最上部（暗転の後ろ）には出さない。
    expect(container.querySelector('p[role="alert"]')).toBeNull()
  })

  test('消すの失敗（409）は窓の中に理由を出す (D017)', async () => {
    ready()
    mocks.remove.mockRejectedValueOnce(new ApiError(409, 'already gone'))
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    const { container } = render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'invoice.pdfのその他操作' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'invoice.pdfのその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
    await waitFor(() => {
      expect(screen.getByText('「invoice.pdf」を削除しますか？')).toBeTruthy()
    })
    confirmInDialog('削除する')
    const message = 'しまった・使えないファイルだけ消せます。一覧を読み直してください。'
    await waitFor(() => {
      expect(screen.getByText(message)).toBeTruthy()
    })
    expect(screen.getByText('「invoice.pdf」を削除しますか？')).toBeTruthy()
    expect(container.querySelector('p[role="alert"]')).toBeNull()
  })

  test('外の検査を止める失敗（500）は窓の中に理由を出す (D017)', async () => {
    ready()
    mocks.saveConfig.mockRejectedValueOnce(new Error('boom'))
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
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    const { container } = render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '外の検査を止める' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '外の検査を止める' }))
    await waitFor(() => {
      expect(screen.getByText('外の検査を止める', { selector: 'h2' })).toBeTruthy()
    })
    confirmInDialog('外の検査を止める')
    const message = '設定を消せませんでした。通信状態を確認して、もう一度お試しください。'
    await waitFor(() => {
      expect(screen.getByText(message)).toBeTruthy()
    })
    expect(screen.getByText('外の検査を止める', { selector: 'h2' })).toBeTruthy()
    expect(container.querySelector('p[role="alert"]')).toBeNull()
  })

  /*
   * 監査 D018: 必須の理由が空なら、APIを送らず「理由を入れてください」を
   * 窓の中に出す（他画面の「変更理由を入力してください」と同じ流儀）。
   */
  test('戻すで理由が空ならAPIを送らず理由を促す (D018)', async () => {
    ready()
    mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1, limit: 50, offset: 0 } })
    render(<FileScanSettingsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '使えるように戻す' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '使えるように戻す' }))
    expect(screen.getByLabelText(/理由/)).toBeTruthy()
    confirmInDialog('使えるように戻す')
    await waitFor(() => {
      expect(screen.getByText('理由を入力してください')).toBeTruthy()
    })
    expect(mocks.release).not.toHaveBeenCalled()
    // 窓は開いたまま。
    expect(screen.getByLabelText(/理由/)).toBeTruthy()
  })
})

test.each([{ role: 'admin', readOnly: true }, { role: 'owner', roleBundle: 'view_only' }])('閲覧のみの管理者は検査結果を読めるが変更操作はない: %j', async identity => {
  ready()
  mocks.me.mockResolvedValue({ success: true, data: identity })
  mocks.list.mockResolvedValue({ success: true, data: { items: [scanOf()], total: 1 } })
  render(<FileScanSettingsPage />)
  await screen.findByText('invoice.pdf')
  expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
  for (const name of ['使えるように戻す', 'invoice.pdfのその他操作', '設定を編集', '外の検査を止める']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
  expect(mocks.release).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(mocks.saveConfig).not.toHaveBeenCalled()
})
