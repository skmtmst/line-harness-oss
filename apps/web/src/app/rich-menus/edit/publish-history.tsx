'use client'

/*
 * N-151: 公開履歴・失敗だけの再試行・LINEとの照合修復。
 *
 * 「公開のしかた」画面の下に置く運用セクション。
 * - 履歴: 各公開runの版（名前・ページ数）・状態・最終エラー・使ったLINE ID。
 * - 再試行: 失敗したrunだけ。保存された版のままやり直す（新しい版は作らない）。
 * - 照合: まず dry-run でずれを並べ、中身を見てから「修復する」を押す。
 */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'

type PublishRun = {
  id: string
  status: 'running' | 'succeeded' | 'failed'
  lastErrorCode: string | null
  idempotencyKey: string
  requestedByStaffId: string
  createdAt: string
  updatedAt: string
  version: { name: string | null; chatBarText: string | null; pageCount: number | null }
  pages: Array<{
    pageId: string
    orderIndex: number
    newRichMenuId: string
    oldRichMenuId: string | null
  }>
}

type ReconcileDiff = { kind: string; detail: string; pageId?: string; richMenuId?: string }

const STATUS_LABEL: Record<PublishRun['status'], string> = {
  running: '実行中',
  succeeded: '成功',
  failed: '失敗',
}

const STATUS_TONE: Record<PublishRun['status'], StatusBadgeTone> = {
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
}

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

export function PublishHistorySection({
  groupId,
  onChanged,
}: {
  groupId: string
  /** 再試行・修復が成功したあと、親がメニュー本体を読み直すための合図。 */
  onChanged?: () => void
}) {
  const [runs, setRuns] = useState<PublishRun[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  const [diffs, setDiffs] = useState<ReconcileDiff[] | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileConfirm, setReconcileConfirm] = useState(false)
  const [reconcileError, setReconcileError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.publishRuns(groupId)
      if (!res.success) throw new Error(res.error)
      setRuns(res.data)
      setLoadError('')
    } catch (e) {
      setLoadError(
        e instanceof ApiError && e.status === 403
          ? '公開履歴を見る権限がありません。'
          : '公開履歴を読み込めませんでした。',
      )
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  async function retry(run: PublishRun) {
    if (retryingId) return
    setRetryingId(run.id)
    setActionError('')
    setNotice('')
    try {
      const res = await api.richMenuGroups.retryPublishRun(groupId, run.id)
      if (!res.success) throw new Error(res.error)
      setNotice('失敗した公開をやり直しました。最新の状態を確認してください。')
      onChanged?.()
    } catch (e) {
      setActionError(
        e instanceof ApiError && e.status === 409
          ? 'この公開は実行中か、保存時の内容と今の下書きが変わっています。一覧を読み直してください。'
          : '再試行できませんでした。しばらくおいてから、もう一度お試しください。',
      )
    } finally {
      setRetryingId(null)
      void load()
    }
  }

  async function checkReconcile() {
    if (reconciling) return
    setReconciling(true)
    setReconcileError('')
    setNotice('')
    try {
      const res = await api.richMenuGroups.reconcile(groupId, true)
      if (!res.success) throw new Error(res.error)
      setDiffs(res.data.diffs)
      if (res.data.diffs.length > 0) setReconcileConfirm(true)
      else setNotice('管理画面の記録とLINE上の状態にずれはありませんでした。')
    } catch {
      setReconcileError('LINEの状態を確認できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setReconciling(false)
    }
  }

  async function applyReconcile() {
    if (reconciling) return
    setReconciling(true)
    setReconcileError('')
    try {
      const res = await api.richMenuGroups.reconcile(groupId, false)
      if (!res.success) throw new Error(res.error)
      setReconcileConfirm(false)
      setDiffs(null)
      setNotice(`ずれを ${res.data.applied ?? 0} 件修復しました。`)
      onChanged?.()
    } catch {
      setReconcileError('修復できませんでした。ずれの内容を確認して、もう一度お試しください。')
    } finally {
      setReconciling(false)
      void load()
    }
  }

  return (
    <section aria-label="公開履歴と照合" className="border-hairline bg-canvas rounded-card mt-5 border p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ink text-sm font-bold">公開の履歴とLINEとの照合</h2>
        <Button type="button" onClick={() => void checkReconcile()} disabled={reconciling}>
          {reconciling ? '確認中…' : 'LINEとのずれを確認'}
        </Button>
      </div>

      {notice ? <p role="status" className="text-success mt-3 text-xs">{notice}</p> : null}
      {actionError ? <p role="alert" className="text-danger mt-3 text-xs">{actionError}</p> : null}
      {reconcileError ? <p role="alert" className="text-danger mt-3 text-xs">{reconcileError}</p> : null}

      {loadError ? (
        <p role="alert" className="text-danger mt-3 text-xs">{loadError}</p>
      ) : runs === null ? (
        <p className="text-ink-faint mt-3 text-xs">読み込み中…</p>
      ) : runs.length === 0 ? (
        <p className="text-ink-faint mt-3 text-xs">まだ公開の履歴はありません。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="border-hairline flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
              <span className="text-ink">
                <StatusBadge tone={STATUS_TONE[run.status]} size="compact" className="mr-2">
                  {STATUS_LABEL[run.status]}
                </StatusBadge>
                {formatAt(run.createdAt)}
                {run.version.name ? ` ・ 「${run.version.name}」` : ''}
                {run.version.pageCount !== null ? ` ・ ${run.version.pageCount}ページ` : ''}
                {run.pages.length > 0 ? ` ・ LINE ID ${run.pages.map((p) => p.newRichMenuId).length}件` : ''}
                {run.status === 'failed' && run.lastErrorCode ? (
                  <span className="text-danger block">失敗理由: {run.lastErrorCode.slice(0, 80)}</span>
                ) : null}
              </span>
              {/* 失敗したものだけ再試行できる。成功済みはLINE操作をやり直さない。 */}
              {run.status === 'failed' ? (
                <Button type="button" onClick={() => void retry(run)} disabled={retryingId !== null}>
                  {retryingId === run.id ? '再試行中…' : '失敗分を再試行'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* dry-run で並べたずれを読み合わせてから、明示的に修復する。 */}
      <ConfirmDialog
        open={reconcileConfirm}
        title="LINEとのずれを修復しますか？"
        description="下のずれを、管理画面の記録とLINEの実体が一致するように直します。"
        confirmLabel="この内容で修復する"
        busy={reconciling}
        error={reconcileError || undefined}
        onCancel={() => {
          if (reconciling) return
          setReconcileConfirm(false)
        }}
        onConfirm={() => void applyReconcile()}
      >
        <ul className="text-ink-secondary space-y-1 text-xs leading-5">
          {(diffs ?? []).map((diff, index) => (
            <li key={index}>・{diff.detail}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </section>
  )
}
