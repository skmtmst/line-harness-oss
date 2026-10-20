'use client'
import type { LineAccount } from '@line-crm/shared'
import { canManageRole, isOwnerRole } from '@/lib/staff-role'
import type { UidMigrationItem } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { type StatusBadgeTone } from '@/components/shared/status-badge'

import { formatNumber } from '@/lib/format'

import { classLabel, decisionLabel, type UidMigrationDetail } from './use-uid-migration'

export interface RunStatusView {
  heading: string
  description: string
  badgeTone: StatusBadgeTone
  badgeLabel: string
}

/**
 * FRIEND-15: 見出し・説明・バッジ・操作は run.status だけで決める。
 * 完了した履歴へ「実データはまだ変更していません」と出さない。
 */
export function runStatusView(run: UidMigrationDetail, unresolved: number | null): RunStatusView {
  switch (run.status) {
    case 'completed':
      return {
        heading: '移行の状態',
        description: '本移行と照合が完了しています。必要な場合はこの履歴から切り戻せます。',
        badgeTone: 'success',
        badgeLabel: '本移行済み',
      }
    case 'rolled_back':
      return {
        heading: '移行の状態',
        description: '切り戻し済みです。反映した内容は移行前の状態へ戻しています。',
        badgeTone: 'neutral',
        badgeLabel: '切り戻し済み',
      }
    case 'executing':
      return {
        heading: '移行の状態',
        description: '本移行を実行しています。結果が出るまで操作をお待ちください。',
        badgeTone: 'info',
        badgeLabel: '実行中',
      }
    case 'failed':
      return run.counts.applied > 0
        ? {
            heading: '移行の状態',
            description: `一部だけ反映されました（反映 ${formatNumber(run.counts.applied)} 件・失敗 ${formatNumber(run.counts.failed)} 件）。失敗した行を確認して再実行するか、反映済みの分だけ切り戻せます。`,
            badgeTone: 'danger',
            badgeLabel: '一部失敗',
          }
        : {
            heading: '移行の状態',
            description: '本移行は失敗しました。実データは変更されていません。',
            badgeTone: 'danger',
            badgeLabel: '失敗',
          }
    default:
      return {
        heading: 'テスト移行の状態',
        description: '実データはまだ変更していません。',
        badgeTone: unresolved === 0 ? 'success' : 'warning',
        badgeLabel: unresolved === 0 ? '確認完了' : `要確認 ${unresolved ?? '—'}件`,
      }
  }
}

/** 行の「詳細を見る」で開く読み取り専用ダイアログ。管理画面 で共用する。 */
export function MigrationItemDialog({
  detailItem,
  active,
  me,
  busy,
  detailError,
  onClose,
  decide,
}: {
  detailItem: UidMigrationItem | null
  active: UidMigrationDetail | null
  me: { id: string; role: string } | null
  busy: boolean
  detailError: string | null
  onClose: () => void
  decide: (item: UidMigrationItem, decision: 'link' | 'create' | 'exclude') => void
}) {
  return (
    <Dialog
      open={detailItem !== null}
      title="移行内容の確認"
      description="内容の確認だけでは保存されません。承認・除外は下のボタンで確定します。"
      busy={busy}
      error={detailError ?? undefined}
      onCancel={() => { if (!busy) onClose() }}
      footer={detailItem ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {active && !['review', 'ready', 'failed'].includes(active.status) ? (
            <span className="text-ink-faint text-xs">この移行の状態では判断を変更できません。</span>
          ) : !canManageRole(me?.role) ? (
            <span className="text-ink-faint text-xs">判断の保存はowner/adminが行います。</span>
          ) : (<>
            {detailItem.decision !== 'exclude' && (
              <Button type="button" disabled={busy} onClick={() => decide(detailItem, 'exclude')}>除外する</Button>
            )}
            {detailItem.newUid && detailItem.decision !== 'link' && (
              <Button type="button" variant="primary" disabled={busy} onClick={() => decide(detailItem, 'link')}>この組合せを承認</Button>
            )}
          </>)}
        </div>
      ) : undefined}
    >
      {detailItem && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-faint text-xs">旧UID</dt><dd className="text-ink break-all">{detailItem.oldUid}</dd></div>
          <div><dt className="text-ink-faint text-xs">新UID</dt><dd className="text-ink break-all">{detailItem.newUid ?? '—'}</dd></div>
          <div><dt className="text-ink-faint text-xs">候補ユーザー</dt><dd className="text-ink">{detailItem.candidateName ?? '候補なし'}</dd></div>
          <div><dt className="text-ink-faint text-xs">一致根拠</dt><dd className="text-ink">{({ same_provider: '同一提供者', line_login: 'LINEログイン', signed_customer_id: '署名済み顧客ID', verified_contact: '確認済み連絡先', operator_csv: '運用者のCSV', manual: '手作業' } as const)[detailItem.evidenceType]}</dd></div>
          <div><dt className="text-ink-faint text-xs">分類</dt><dd className="text-ink">{classLabel[detailItem.classification]}</dd></div>
          <div><dt className="text-ink-faint text-xs">競合内容</dt><dd className="text-ink">{detailItem.conflictReason ?? '—'}</dd></div>
          <div><dt className="text-ink-faint text-xs">現在の判断</dt><dd className="text-ink font-semibold">{decisionLabel[detailItem.decision]}</dd></div>
          <div><dt className="text-ink-faint text-xs">実行結果</dt><dd className="text-ink">{({ pending: '未実行', applied: '反映済み', skipped: '除外', failed: '失敗', rolled_back: '切り戻し済み' } as const)[detailItem.result]}{detailItem.errorMessage ? `（${detailItem.errorMessage}）` : ''}</dd></div>
        </dl>
      )}
    </Dialog>
  )
}

/** 本移行の実行確認（管理画面 共用）。確定ボタンだけが execute を呼ぶ。 */
export function ExecuteConfirmDialog({
  active,
  accounts,
  me,
  busy,
  open,
  error,
  canRun,
  onConfirm,
  onCancel,
}: {
  active: UidMigrationDetail | null
  accounts: LineAccount[]
  me: { id: string; role: string } | null
  busy: boolean
  open: boolean
  error: string | null
  canRun: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!active) return null
  return (
    <ConfirmDialog
      open={open}
      title="本移行を実行します"
      description="実行すると友だちと統合ユーザーの紐付けが実際に変わります。内容を確認してから確定してください。"
      confirmLabel="本移行を実行"
      busy={busy}
      error={error ?? undefined}
      onConfirm={canRun ? onConfirm : undefined}
      onCancel={onCancel}
    >
      <ul className="text-ink list-disc space-y-1 pl-5 text-sm">
        <li>対象：{accounts.find((account) => account.id === active.fromAccountId)?.name ?? active.fromAccountId} → {accounts.find((account) => account.id === active.toAccountId)?.name ?? active.toAccountId}</li>
        <li>結び付け {active.decisionCounts?.link ?? '—'} 件・除外 {active.decisionCounts?.exclude ?? '—'} 件・新規作成の判断 {active.decisionCounts?.create ?? '—'} 件（自動反映できない行は失敗として記録されます）</li>
        <li>実行権限：ownerのみ。テスト移行を作成した本人は実行できません。</li>
        <li>復旧：実行後、この履歴から反映済みの分だけ切り戻せます。移行後に別の変更があった行は切り戻しを止めて表示します。</li>
      </ul>
      {me && !isOwnerRole(me.role) && <p className="text-danger mt-2 text-sm font-semibold">本移行の実行はownerの権限が必要です。</p>}
      {me && isOwnerRole(me.role) && me.id === active.createdBy && <p className="text-danger mt-2 text-sm font-semibold">この移行はあなたが作成したため、別のownerが実行してください。</p>}
    </ConfirmDialog>
  )
}

/** 切り戻しの確認（管理画面 共用）。 */
export function RollbackConfirmDialog({
  active,
  me,
  busy,
  open,
  error,
  conflicts,
  canRun,
  onConfirm,
  onCancel,
}: {
  active: UidMigrationDetail | null
  me: { id: string; role: string } | null
  busy: boolean
  open: boolean
  error: string | null
  conflicts: Array<{ itemId: string; oldUid: string; reason: string }>
  canRun: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!active) return null
  return (
    <ConfirmDialog
      open={open}
      title="この移行を切り戻します"
      description={`反映した ${formatNumber(active.counts.applied)} 件を移行前の紐付けに戻します。移行後に別の変更があった行は切り戻さず、競合として表示します。`}
      confirmLabel="切り戻す"
      destructive
      busy={busy}
      error={error ?? undefined}
      onConfirm={canRun ? onConfirm : undefined}
      onCancel={onCancel}
    >
      <ul className="text-ink list-disc space-y-1 pl-5 text-sm">
        <li>対象：この履歴で反映済みの {formatNumber(active.counts.applied)} 行だけです。失敗・除外の行は変更しません。</li>
        <li>制約：移行後に統合ユーザーへ別の変更があった行は切り戻せません。</li>
        <li>実行権限：ownerのみ。</li>
      </ul>
      {conflicts.length > 0 && (
        <ul className="text-danger mt-2 list-disc space-y-1 pl-5 text-sm">
          {conflicts.map((conflict) => <li key={conflict.itemId}>{conflict.oldUid}：{conflict.reason}</li>)}
        </ul>
      )}
      {me && !isOwnerRole(me.role) && <p className="text-danger mt-2 text-sm font-semibold">切り戻しはownerの権限が必要です。</p>}
    </ConfirmDialog>
  )
}
