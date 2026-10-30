import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { canManageRole, useStaffRole } from '@/lib/staff-role'

/** 卓の準備と予約の未登録を区別して、次にできる操作を知らせる。 */
export default function LedgerEmpty({ noTables, filtered = false, canWrite, busy, onCreate }: {
  noTables: boolean
  filtered?: boolean
  canWrite: boolean
  busy: boolean
  onCreate: () => void
}) {
  const role = useStaffRole()
  if (noTables) return <ListState kind="empty" title="卓がまだ設定されていません" description="時間と卓で予約を確認するには、先に座席・卓を登録してください。卓が未設定の予約は一覧で確認できます。" action={role ? <Button variant="primary" href="/restaurant-test/tables" lockedReason={!canManageRole(role) ? '座席・卓の設定には管理者の権限が必要です。' : undefined}>座席・卓を設定する</Button> : <Button variant="primary" disabled>座席・卓を設定する</Button>} />
  return <ListState kind="empty" title={filtered ? '条件に合う予約はありません' : '予約はまだありません'} description={filtered ? '期間や状態、予約元の条件を変えて確認してください。' : '予約が入ると、ここに表示されます。時間×卓の空きマスからも電話の予約を入れられます。'} action={filtered ? undefined : <Button variant="primary" disabled={busy || !role} lockedReason={role && !canWrite ? '予約の登録にはスタッフ以上の権限が必要です。' : undefined} onClick={onCreate}>電話の予約を入れる</Button>} />
}
