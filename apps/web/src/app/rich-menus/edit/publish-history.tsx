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
import { api, ApiError, type RichMenuPublishRun } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'

type PublishRun = RichMenuPublishRun

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

/** その版が誰に出る版か。スナップショットに情報が無い版は「分からない」と濁す。 */
function audienceLabel(version: PublishRun['version']): string | null {
  if (version.isDefaultForAll === true) return 'すべての友だち（既定メニュー）'
  if (version.targetingEnabled === true) return '出し分け条件に合う友だち'
  if (version.isDefaultForAll === false && version.targetingEnabled === false) return 'すべての友だち'
  return null
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
  const [published, setPublished] = useState<PublishRun | null>(null)
  const [draftDiffers, setDraftDiffers] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryTarget, setRetryTarget] = useState<PublishRun | null>(null)
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
      setRuns(res.data.runs)
      setPublished(res.data.published)
      setDraftDiffers(res.data.draftDiffersFromPublished)
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
      setRetryTarget(null)
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

  /** 再試行する版の説明文。対象と影響を確認してから実行する。 */
  function retryDescription(run: PublishRun): string {
    const audience = audienceLabel(run.version)
    return [
      `${formatAt(run.createdAt)} に失敗した公開を、保存された版のままやり直します。`,
      `対象: ${audience ?? 'このメニューの出し分け設定に合う友だち'}。`,
      '途中まで作成済みのものは続きから再開し、別の版や別の対象には適用しません。',
      '下書きが保存時から変わっている場合は、上書きを避けるため再試行せず止めます。',
    ].join('')
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

      {/* 公開版と編集中の版を混ぜないための明示。 */}
      {!loadError && runs !== null ? (
        <div className="border-hairline bg-canvas-sunken mt-3 rounded border px-3 py-2 text-xs leading-5">
          {published ? (
            <p className="text-ink">
              いま対象に出ている版: 「{published.version.name ?? '（名前なし）'}」
              {published.version.pageCount !== null ? ` ・ ${published.version.pageCount}ページ` : ''}
              {audienceLabel(published.version) ? ` ・ ${audienceLabel(published.version)}に表示中` : ''}
              {` ・ ${formatAt(published.updatedAt)} に公開`}
            </p>
          ) : (
            <p className="text-ink-faint">いま対象に出ている版はありません（まだ公開に成功していません）。</p>
          )}
          {draftDiffers === true ? (
            <p className="text-warning">編集中の下書きは公開中の版と違います。公開すると、この下書きで上書きされます。</p>
          ) : null}
          {draftDiffers === false && published ? (
            <p className="text-ink-faint">編集中の下書きは公開中の版と同じです。</p>
          ) : null}
        </div>
      ) : null}

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
                <Button type="button" onClick={() => setRetryTarget(run)} disabled={retryingId !== null}>
                  {retryingId === run.id ? '再試行中…' : '失敗分を再試行'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* 再試行は対象と影響を確認してから実行する。 */}
      <ConfirmDialog
        open={retryTarget !== null}
        title="失敗した公開をやり直しますか？"
        description={retryTarget ? retryDescription(retryTarget) : ''}
        confirmLabel="この版を再試行する"
        busy={retryingId !== null}
        error={actionError || undefined}
        onCancel={() => {
          if (retryingId) return
          setRetryTarget(null)
        }}
        onConfirm={() => {
          if (retryTarget) void retry(retryTarget)
        }}
      >
        {retryTarget ? (
          <p className="text-ink-secondary text-xs leading-5">
            版: 「{retryTarget.version.name ?? '（名前なし）'}」
            {retryTarget.version.pageCount !== null ? ` ・ ${retryTarget.version.pageCount}ページ` : ''}
            {retryTarget.lastErrorCode ? ` ・ 前回の失敗: ${retryTarget.lastErrorCode.slice(0, 60)}` : ''}
          </p>
        ) : null}
      </ConfirmDialog>

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
