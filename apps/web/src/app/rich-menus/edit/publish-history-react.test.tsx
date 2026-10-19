// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichMenuDetailV8 from '@/v8/rich-menu-edit/detail'

/**
 * 公開履歴セクションの「応答の形がずれていたとき」の試験(#1056)。
 *
 * publish-runs の応答が success: true でも runs を欠く形（旧APIや途中の
 * プロキシ応答）だと、以前は runs=undefined が state に入り、描画側の
 * runs.length で画面ごと落ちていた。落ちる代わりに読み込み失敗として
 * 表示することを確かめる。差し替えるのは通信(api)だけ。
 */

const net = vi.hoisted(() => ({
  /** 次の publishRuns 応答。 */
  publishRunsResult: undefined as unknown,
  role: 'owner', readOnly: false, roleBundle: undefined as string | undefined,
  preview: vi.fn(), summary: vi.fn(), reconcile: vi.fn(), retry: vi.fn(),
}))

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'owner-1', role: net.role, readOnly: net.readOnly, roleBundle: net.roleBundle } }) },
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        publishRuns: async () => net.publishRunsResult,
        get: async () => ({ success: true, data: { id: 'menu-1', name: 'メニュー', accountId: 'account-1', status: 'published', isDefaultForAll: true, targetingEnabled: false } }),
        publishProgress: async () => ({ success: true, data: { steps: [], run: null, message: null } }),
        previewTargets: net.preview,
        audienceSummary: net.summary,
        retryPublishRun: net.retry,
        tapStats: async () => ({ success: true, data: { byArea: [] } }),
        // K-2: 開いた時の照合は読むだけ。ずれなしで返す。
        reconcile: net.reconcile,
      },
    },
  }
})

// act(...) を使う環境だと React に伝える(伝えないと警告が出続ける)。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(async () => {
  net.role = 'owner'; net.readOnly = false; net.roleBundle = undefined
  net.preview.mockReset().mockResolvedValue({ success: true, data: null })
  net.summary.mockReset().mockResolvedValue({ success: true, data: { effective: { value: 12, state: 'available', reason: null } } })
  net.reconcile.mockReset().mockResolvedValue({ success: true, data: { dryRun: true, diffs: [] } })
  net.retry.mockReset().mockResolvedValue({ success: true, data: {} })
  document.documentElement.dataset.theme = 'v8'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

function run(status: 'succeeded' | 'failed' = 'succeeded') {
  return { id: 'run-1', status, lastErrorCode: status === 'failed' ? 'line_unavailable' : null,
    idempotencyKey: 'key-1', requestedByStaffId: 'owner-1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T01:00:00Z',
    version: { name: '公開した版', chatBarText: 'メニュー', pageCount: 2, isDefaultForAll: false, targetingEnabled: true },
    pages: [{ pageId: 'p1', orderIndex: 0, newRichMenuId: 'line-menu-1', oldRichMenuId: null }] }
}
async function renderDetail() {
  await act(async () => { root.render(<RichMenuDetailV8 groupId="menu-1" />) })
  await flush()
}

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  delete document.documentElement.dataset.theme
})

describe('公開履歴の読み込み（応答の形ずれ）', () => {
  it('runs を欠く応答では画面を落とさず、読み込み失敗として表示する', async () => {
    net.publishRunsResult = { success: true, data: {} }

    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="menu-1" />)
    })
    await flush()

    expect(container.textContent).toContain('公開の履歴を読み込めませんでした。')
  })

  it('通常の形の応答では履歴を表示する', async () => {
    net.publishRunsResult = {
      success: true,
      data: {
        runs: [],
        published: null,
        draftDiffersFromPublished: null,
      },
    }

    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="menu-1" />)
    })
    await flush()

    expect(container.textContent).toContain('まだ公開の履歴はありません。')
  })

  it('公開中の版と面の数を補足し、下書きが同じかを区別する', async () => {
    net.publishRunsResult = { success: true, data: { runs: [run()], published: run(), draftDiffersFromPublished: false } }
    await renderDetail()
    expect(screen.getByTitle(/いま対象に出ている版: 「公開した版」.*2ページ.*編集中の下書きは公開中の版と同じです/)).toBeTruthy()
    expect(screen.queryByText(/この下書きで上書きされます/)).toBeNull()
    expect(screen.getByTitle('「公開した版」 ・ 2ページ ・ LINE ID 1件')).toBeTruthy()
  })

  it('公開版と違う下書きは上書きされると警告する', async () => {
    net.publishRunsResult = { success: true, data: { runs: [run()], published: run(), draftDiffersFromPublished: true } }
    await renderDetail()
    expect(screen.getByText('編集中の下書きは公開中の版と違います。公開すると、この下書きで上書きされます。')).toBeTruthy()
  })

  it('公開版が無い時は成功済みと断定しない', async () => {
    net.publishRunsResult = { success: true, data: { runs: [], published: null, draftDiffersFromPublished: null } }
    await renderDetail()
    expect(screen.getByTitle('いま対象に出ている版はありません（まだ公開に成功していません）。')).toBeTruthy()
  })

  it('失敗した保存版と対象を確認してから、その版だけを再試行する', async () => {
    net.publishRunsResult = { success: true, data: { runs: [run('failed')], published: null, draftDiffersFromPublished: null } }
    await renderDetail()
    expect(screen.getByTitle('「公開した版」 ・ 2ページ ・ LINE ID 1件 ・ 失敗理由: line_unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '失敗だけやり直す' }))
    const dialog = screen.getByRole('dialog', { name: '失敗した公開をやり直しますか？' })
    expect(within(dialog).getByText(/対象: 条件に当てはまる友だち/)).toBeTruthy()
    expect(within(dialog).getByText(/下書きが保存時から変わっている場合.*再試行せず止めます/)).toBeTruthy()
    expect(net.retry).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'やり直す' }))
    await screen.findByText('失敗した公開をやり直しました。最新の状態を確かめてください。')
    expect(net.retry).toHaveBeenCalledExactlyOnceWith('menu-1', 'run-1')
  })

  it('照合は読むだけで始め、確認した修復後も取り込みが必要な分を知らせる', async () => {
    net.publishRunsResult = { success: true, data: { runs: [] } }
    const diff = { kind: 'alias_missing', detail: '切り替え先がありません', fix: { action: 'restore_alias', label: '切り替え先を戻す' } }
    net.reconcile.mockImplementation(async (_id, dryRun) => ({ success: true, data: dryRun ? { dryRun: true, diffs: [diff] } : { applied: 1, unapplied: [{ kind: 'external_richmenu' }] } }))
    await renderDetail()
    expect(net.reconcile).toHaveBeenCalledExactlyOnceWith('menu-1', true)
    fireEvent.click(screen.getByRole('button', { name: 'ずれを直す' }))
    const dialog = screen.getByRole('dialog', { name: 'LINEとのずれを直しますか？' })
    expect(within(dialog).getByText('切り替え先がありません（切り替え先を戻す）')).toBeTruthy()
    expect(net.reconcile).not.toHaveBeenCalledWith('menu-1', false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'ずれを直す' }))
    await screen.findByText(/ずれを 1 件修復しました。取り込みが必要なずれが 1 件あります/)
    expect(net.reconcile).toHaveBeenCalledWith('menu-1', false)
    expect(net.reconcile.mock.calls.filter(call => call[1] === false)).toHaveLength(1)
  })

  it.each([
    { role: 'staff' }, { role: 'viewer' }, { role: 'admin', readOnly: true }, { role: 'owner', roleBundle: 'view_only' },
  ])('操作できない担当者は合計だけを読み、公開履歴の操作を出さない: %j', async identity => {
    Object.assign(net, identity)
    net.publishRunsResult = { success: true, data: { runs: [run('failed')] } }
    await renderDetail()
    await waitFor(() => expect(net.summary).toHaveBeenCalledExactlyOnceWith('menu-1'))
    expect(net.preview).not.toHaveBeenCalled()
    expect(net.reconcile).not.toHaveBeenCalled()
    expect(screen.getByText('12 人')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '公開の履歴とLINEとの照合' })).toBeNull()
    expect(screen.queryByRole('button', { name: '失敗だけやり直す' })).toBeNull()
  })
})
