'use client'

/*
 * N-152: 自分のLINEだけへテスト適用する。
 *
 * 「公開のしかた」画面で、全員へ出す前に自分のトーク画面で見え方を確かめる。
 * - 対象はログイン担当者に連携済みの本人LINEだけ。任意の友だちIDは選べない。
 * - 適用前にその人へ出ていたメニューを記録し、「元に戻す」で戻せる。
 * - 適用も取り消しも冪等（確認窓を開くたびに新しい鍵、実行中は disabled）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'

type TestApplyState = {
  linked: boolean
  linkGuidance: string | null
  active: {
    id: string
    status: string
    previousRichMenuId: string | null
    appliedRichMenuId: string | null
    lastErrorCode: string | null
    createdAt: string
    updatedAt: string
  } | null
  recent: Array<{
    id: string
    status: string
    appliedRichMenuId: string | null
    lastErrorCode: string | null
    createdAt: string
  }>
}

const APPLY_STATUS_LABEL: Record<string, string> = {
  running: '適用中',
  applied: '自分のLINEに出ています',
  reverting: '取り消し中',
  reverted: '取り消し済み',
  failed: '失敗',
}

export function TestApplySection({ groupId }: { groupId: string }) {
  const [state, setState] = useState<TestApplyState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [confirmKind, setConfirmKind] = useState<'apply' | 'revert' | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  /**
   * 確認窓を開いた時点で鍵を振る。窓を閉じて開き直すと別の操作なので
   * 新しい鍵になる。窓の中で押し直しても同じ鍵＝1回に数えられる。
   */
  const keyRef = useRef<string>('')

  const load = useCallback(async () => {
    try {
      const res = await api.richMenuGroups.testApplyState(groupId)
      if (!res.success) throw new Error(res.error)
      setState(res.data)
      setLoadError('')
    } catch (e) {
      setLoadError(
        e instanceof ApiError && e.status === 403
          ? 'テスト適用の状態を見る権限がありません。'
          : 'テスト適用の状態を確認できませんでした。',
      )
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  function openConfirm(kind: 'apply' | 'revert') {
    keyRef.current = crypto.randomUUID()
    setActionError('')
    setConfirmKind(kind)
  }

  async function run() {
    if (!confirmKind || busy) return
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const res = confirmKind === 'apply'
        ? await api.richMenuGroups.testApply(groupId, keyRef.current)
        : await api.richMenuGroups.testApplyRevert(groupId, keyRef.current)
      if (!res.success) throw new Error(res.error)
      setConfirmKind(null)
      setNotice(
        confirmKind === 'apply'
          ? 'あなたのLINEにこのメニューを出しました。LINEアプリで見え方を確認してください。'
          : '適用前の表示へ戻しました。',
      )
      await load()
    } catch (e) {
      setActionError(
        e instanceof ApiError && e.status === 409
          ? 'ほかの操作と重なりました。状態を確認してから、もう一度お試しください。'
          : confirmKind === 'apply'
            ? 'テスト適用できませんでした。しばらくおいてから、もう一度お試しください。'
            : '取り消せませんでした。しばらくおいてから、もう一度お試しください。',
      )
    } finally {
      setBusy(false)
    }
  }

  const active = state?.active ?? null
  const activeLabel = active ? (APPLY_STATUS_LABEL[active.status] ?? active.status) : null

  return (
    <section aria-label="自分のLINEで試す" className="border-hairline bg-canvas rounded-card border p-5">
      <h2 className="text-ink text-sm font-bold">自分のLINEで試す</h2>
      <p className="text-ink-faint mt-1 text-xs leading-5">
        あなたのLINEアカウントにだけ、このメニューを出して見え方を確かめます。ほかの友だちの表示は変わりません。
      </p>

      {loadError ? <p role="alert" className="text-danger mt-3 text-xs">{loadError}</p> : null}
      {notice ? <p role="status" className="text-success mt-3 text-xs">{notice}</p> : null}
      {actionError ? <p role="alert" className="text-danger mt-3 text-xs">{actionError}</p> : null}

      {state && !state.linked ? (
        <p className="text-warning mt-3 text-xs leading-5">{state.linkGuidance ?? 'テスト適用にはLINE連携が必要です。'}</p>
      ) : null}

      {state?.linked ? (
        <div className="mt-3 space-y-2">
          {active ? (
            <p className="text-ink-secondary text-xs">
              いまの状態: <strong className="text-ink">{activeLabel}</strong>
              {active.status === 'failed' && active.lastErrorCode
                ? `（${active.lastErrorCode.slice(0, 60)}）`
                : ''}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {active && (active.status === 'applied' || active.status === 'failed') ? (
              <Button type="button" onClick={() => openConfirm('revert')} disabled={busy}>
                元のメニューに戻す
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={() => openConfirm('apply')}
                disabled={busy || Boolean(active && active.status !== 'reverted' && active.status !== 'failed')}
              >
                自分のLINEに適用して試す
              </Button>
            )}
          </div>
          {state.recent.length > 0 ? (
            <p className="text-ink-faint text-micro">
              最近の適用: {state.recent.length}件（直近 {new Date(state.recent[0].createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}）
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmKind === 'apply'}
        title="自分のLINEにこのメニューを出しますか？"
        description="あなたのトーク画面のメニューだけがこの内容に変わります。ほかの友だちには出ません。「元のメニューに戻す」でいつでも戻せます。"
        confirmLabel="自分のLINEに適用する"
        busy={busy}
        error={actionError || undefined}
        onConfirm={() => void run()}
        onCancel={() => {
          if (busy) return
          setConfirmKind(null)
        }}
      />

      <ConfirmDialog
        open={confirmKind === 'revert'}
        title="テスト適用を取り消しますか？"
        description="あなたのトーク画面のメニューを、適用前の表示へ戻します。テスト用に作ったメニューがあればLINE上から削除します。"
        confirmLabel="元のメニューに戻す"
        busy={busy}
        error={actionError || undefined}
        onConfirm={() => void run()}
        onCancel={() => {
          if (busy) return
          setConfirmKind(null)
        }}
      />
    </section>
  )
}
