// @vitest-environment happy-dom
/*
 * 共通情報の監査付きCSV出力パネルを本物のReactで動かす試験（N-192）。
 *
 * 見るのは5状態の言い分けだけ:
 *   - 依頼中（読込中）… ボタンが「書き出しを依頼しています…」
 *   - 書き出し中（進捗）… processed/total を出す
 *   - 完了 … 件数・期限・ダウンロード口
 *   - 失敗 … 失敗理由ともう一度書き出す口
 *   - 期限切れ … 期限切れの表示と再生成口
 *
 * 通信は api.commonVars.* をモックし、画面に出る文字だけを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listExports: vi.fn(),
  createExport: vi.fn(),
  exportDetail: vi.fn(),
  regenerateExport: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        listExports: api.listExports,
        createExport: api.createExport,
        exportDetail: api.exportDetail,
        regenerateExport: api.regenerateExport,
      },
    },
  }
})

import VarsExportPanel from './export-panel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1', lineAccountId: 'account-1', folderId: null, ungrouped: false,
    status: 'completed', totalCount: 12, processedCount: 12, rowCount: 12,
    byteSize: 500, createdBy: 'owner-1', createdByName: 'Owner',
    createdAt: '2026-09-18T01:00:00.000Z', startedAt: '2026-09-18T01:00:01.000Z',
    finishedAt: '2026-09-18T01:00:02.000Z', expiresAt: '2026-09-25T01:00:00.000Z',
    failureReason: null, downloadUrl: '/api/common-vars/exports/job-1/download',
    ...over,
  }
}

async function render(props: { accountId?: string | null; folderId?: string | null; ungrouped?: boolean } = {}) {
  await act(async () => {
    root.render(React.createElement(VarsExportPanel, {
      accountId: props.accountId === undefined ? 'account-1' : props.accountId,
      folderId: props.folderId ?? null,
      ungrouped: props.ungrouped,
    }))
  })
}

function text(): string {
  return host.textContent ?? ''
}

async function clickButton(label: string) {
  const found = Array.from(host.querySelectorAll('button'))
    .find((el) => el.textContent?.trim() === label)
  if (!found) throw new Error(`見つかりません: <button> "${label}"`)
  await act(async () => { found.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listExports.mockResolvedValue({ success: true, data: [] })
  api.createExport.mockResolvedValue({ success: true, data: job() })
  api.exportDetail.mockResolvedValue({ success: true, data: job() })
  api.regenerateExport.mockResolvedValue({ success: true, data: job({ id: 'job-2' }) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

describe('共通情報CSVの監査付き出力パネル', () => {
  it('依頼するとaccountIdとフォルダ条件をサーバへ送り、完了したら期限つきDL口を出す', async () => {
    await render({ folderId: 'folder-9' })
    await clickButton('CSVで書き出す')
    expect(api.createExport).toHaveBeenCalledWith({
      accountId: 'account-1', folderId: 'folder-9', ungrouped: undefined,
    })
    expect(text()).toContain('完了')
    expect(text()).toContain('12件')
    const link = host.querySelector('a[href$="/api/common-vars/exports/job-1/download"]')
    expect(link).not.toBeNull()
  })

  it('未分類の絞り込みは ungrouped として送る', async () => {
    await render({ ungrouped: true })
    await clickButton('CSVで書き出す')
    expect(api.createExport).toHaveBeenCalledWith({
      accountId: 'account-1', folderId: undefined, ungrouped: true,
    })
  })

  it('書き出し中は processed/total の進捗を出す', async () => {
    api.createExport.mockResolvedValue({
      success: true,
      data: job({ status: 'running', processedCount: 40, totalCount: 100, downloadUrl: null, rowCount: null }),
    })
    await render()
    await clickButton('CSVで書き出す')
    expect(text()).toContain('書き出し中')
    expect(text()).toContain('40')
    expect(text()).toContain('100')
  })

  it('失敗は理由ともう一度書き出す口を出し、再生成で新しいjobへ進む', async () => {
    api.listExports.mockResolvedValue({
      success: true,
      data: [job({ status: 'failed', failureReason: '出力が大きすぎます', downloadUrl: null })],
    })
    await render()
    expect(text()).toContain('失敗')
    expect(text()).toContain('出力が大きすぎます')
    await clickButton('もう一度書き出す')
    expect(api.regenerateExport).toHaveBeenCalledWith('job-1')
  })

  it('期限切れは期限切れと再生成口を出し、ダウンロード口は出さない', async () => {
    api.listExports.mockResolvedValue({
      success: true,
      data: [job({ status: 'expired', downloadUrl: null })],
    })
    await render()
    expect(text()).toContain('期限切れ')
    expect(host.querySelector('a[href$="/download"]')).toBeNull()
    await clickButton('もう一度書き出す')
    expect(api.regenerateExport).toHaveBeenCalledWith('job-1')
  })

  it('アカウント未選択では依頼できない', async () => {
    await render({ accountId: null })
    const button = Array.from(host.querySelectorAll('button'))
      .find((el) => el.textContent?.includes('CSVで書き出す'))
    expect(button?.disabled).toBe(true)
    await act(async () => { button?.click() })
    expect(api.createExport).not.toHaveBeenCalled()
  })

  it('依頼失敗はエラーを出し、前の状態に戻る', async () => {
    api.createExport.mockRejectedValue(new Error('network'))
    await render()
    await clickButton('CSVで書き出す')
    expect(text()).toContain('書き出しを依頼できませんでした')
  })
})
