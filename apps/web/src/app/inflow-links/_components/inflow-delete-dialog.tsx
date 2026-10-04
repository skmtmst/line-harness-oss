'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { ApiError, api, fetchApi } from '@/lib/api'
import type { EntryRoute } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { useOverlayFocus } from '@/components/shared/overlay-utils'

/**
 * 流入経路の削除・受付停止・転送の確認の窓（V6 `UIaM7`）。
 *
 * 影響（URL・記録・動き）を示してから、止める・別リンクへ送る・削除の
 * 3つから選ぶ。転送先は必ず利用者に選ばせる（先頭の自動採用はしない）。
 * v7 の詳細画面と V8 の詳細画面（`inflow-detail-v8`）で同じ窓を使う。
 */
export default function InflowDeleteDialog({
  route,
  routes,
  funnelFriendCount,
  workerBase,
  canPermanentlyDelete,
  initialChoice,
  onDeleted,
  onClose,
}: {
  route: EntryRoute
  routes: EntryRoute[]
  funnelFriendCount: number
  workerBase: string
  canPermanentlyDelete: boolean
  /** 開いたときに選ばれている処理（その後の「…」から開くときに使う）。 */
  initialChoice?: 'stop' | 'redirect' | 'delete'
  /** 選んだ処理が終わったら呼ぶ（ふつうは一覧へ戻る）。 */
  onDeleted: () => void
  onClose: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteChoice, setDeleteChoice] = useState<'stop' | 'redirect' | 'delete'>(
    initialChoice ?? 'stop',
  )
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  // 「別の流入リンクへ送る」の転送先。先頭を自動採用しない（#514 重大4）。
  const [redirectTargetId, setRedirectTargetId] = useState('')
  const deleteDialogRef = useOverlayFocus(true, onClose, deleting)

  async function applyDeleteChoice() {
    if (deleting) return
    if (deleteChoice === 'delete' && !canPermanentlyDelete) {
      setDeleteChoice('stop')
      setDeleteError('完全削除には管理者権限が必要です。受付停止を選んでください。')
      return
    }
    setDeleting(true)
    setDeleteError('')
    try {
      if (deleteChoice === 'redirect') {
        // 転送先は必ず利用者に選ばせる。選ばずに進ませない。
        const redirectTarget = routes.find((candidate) => candidate.id === redirectTargetId && candidate.id !== route.id)
        if (!redirectTarget) {
          setDeleteError('転送先のリンクを選んでください')
          return
        }
        const result = await api.entryRoutes.update(route.id, {
          redirectUrl: `${workerBase}/r/${encodeURIComponent(redirectTarget.refCode)}`,
        })
        if (!result.success) throw new Error(result.error)
      } else {
        const result = deleteChoice === 'delete'
          ? await fetchApi<{ success: boolean; error?: string }>(`/api/entry-routes/${encodeURIComponent(route.id)}`, {
              method: 'DELETE',
              body: JSON.stringify({ confirmationName: deleteConfirmationName }),
            })
          : await api.entryRoutes.update(route.id, { isActive: false })
        if (!result.success) throw new Error(result.error)
      }
      onDeleted()
    } catch (cause) {
      setDeleteError(cause instanceof ApiError && (
        cause.code === 'ENTRY_ROUTE_IN_USE'
        || cause.code === 'ENTRY_ROUTE_NAME_CONFIRMATION_MISMATCH'
      )
        ? cause.message
        : '選んだ処理を完了できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true" aria-labelledby="inflow-delete-title">
      <div ref={deleteDialogRef} tabIndex={-1} className="w-full overflow-hidden rounded-card bg-canvas shadow-overlay" style={{ maxWidth: 840 }}>
        <div className="flex items-start gap-3 border-b border-hairline px-6 py-5" style={{ minHeight: 96 }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-danger-bg text-xl font-bold text-danger">!</span><div className="min-w-0 flex-1"><h2 id="inflow-delete-title" className="text-xl font-bold text-ink">「{route.name}」を削除しますか？</h2><p className="mt-1 text-sm text-ink-faint">このURLは {route.createdAt.slice(5, 10).replace('-', '/')} から使われています。消すと同じURLは開けなくなります。</p></div><button type="button" onClick={onClose} disabled={deleting} aria-label="閉じる" className="rounded-mini shrink-0 p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-6">
          <Notice tone="danger"><h3 className="text-sm font-bold">削除すると、次のことが起きます</h3><div className="mt-3 divide-y divide-danger/15"><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">貼り付けたURL・QRコード</p><p className="mt-0.5 text-xs">このURLを置いた投稿や広告から開けなくなります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">差し替えが必要</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">この経路から来た記録</p><p className="mt-0.5 text-xs">{funnelFriendCount}人の流入元と成果は過去の記録として残ります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">記録は残る</span></div><div className="flex items-center justify-between gap-4 py-2"><div><p className="text-sm font-bold">追加時の動き</p><p className="mt-0.5 text-xs">新しい友だちへのタグ付けとシナリオ開始が止まります。</p></div><span className="rounded-pill bg-canvas px-3 py-1 text-xs font-bold">受付を停止</span></div></div></Notice>
          <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p>
          <div><h3 className="text-sm font-bold text-ink">どうしますか？</h3><div className="mt-2 grid gap-2">{([['stop','新しい人を受けるのをやめる（おすすめ）','URLは残し、「受付を終了しました」と表示します。','休'],['redirect','別の流入リンクへ送るようにする','印刷ずみのQRコードを別の経路へつなぎます。','→'],['delete','このまま削除する','利用履歴がない経路だけ完全に削除できます。元には戻せません。','×']] as const).filter(([value]) => value !== 'delete' || canPermanentlyDelete).map(([value,title,description,icon]) => <Button variant="secondary" key={value} type="button" disabled={deleting} onClick={() => { setDeleteChoice(value); setDeleteError('') }} style={{ width: '100%', height: 'auto', padding: 12, gap: 12, textAlign: 'left', fontWeight: 400, borderColor: deleteChoice === value ? 'var(--color-accent)' : 'var(--color-hairline)', background: deleteChoice === value ? 'var(--color-accent-soft)' : 'var(--color-canvas)' }}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border text-xs font-bold ${deleteChoice === value ? 'border-accent-deep bg-accent-deep text-on-accent' : 'border-hairline text-ink-faint'}`}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink-faint">{description}</span></span><span className="text-ink-faint">›</span></Button>)}</div></div>
          {deleteChoice === 'redirect' && <div><p className="text-sm font-semibold text-ink">転送先のリンク</p><Select aria-label="転送先のリンク" id="inflow-redirect-target" value={redirectTargetId} disabled={deleting} onChange={setRedirectTargetId} size="full" options={[{ value: '', label: '選んでください' }, ...routes.filter((candidate) => candidate.id !== route.id).map((candidate) => ({ value: candidate.id, label: `${candidate.name}（#${candidate.refCode}）` }))]} /><p className="text-ink-faint mt-1 text-xs">先頭を自動で選ぶことはしません。必ず選んでください。</p></div>}
          {deleteChoice === 'delete' && <div className="rounded-control border border-status-danger bg-danger-bg p-4"><label htmlFor="inflow-delete-confirmation" className="text-sm font-medium text-danger">完全削除するには「{route.name}」と入力</label><input id="inflow-delete-confirmation" value={deleteConfirmationName} disabled={deleting} onChange={(event) => setDeleteConfirmationName(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink" /><p className="mt-1 text-xs text-danger">空白や大文字・小文字も含め、現在の経路名と同じ入力が必要です。</p></div>}
          {deleteError && <Notice tone="danger" message={deleteError} />}
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-6 py-4" style={{ minHeight: 82 }}><p className="max-w-md text-xs text-ink-faint">選んだ方法を確認してから進みます。過去の友だち・タグ・分析記録は消えません。</p><div className="flex gap-2"><Button variant="secondary" disabled={deleting} onClick={onClose}>キャンセル</Button><Button onClick={() => void applyDeleteChoice()} disabled={deleting || (deleteChoice === 'delete' && deleteConfirmationName !== route.name)}>{deleteChoice === 'stop' ? '受けるのをやめる' : deleteChoice === 'redirect' ? '別のリンクへ送る' : 'この経路を削除する'}</Button></div></div>
      </div>
    </div>
  )
}
