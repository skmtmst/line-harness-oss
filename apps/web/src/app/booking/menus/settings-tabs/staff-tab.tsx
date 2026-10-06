'use client'

/* ⑤ 担当スタッフ（VLEaj）（settings-v8.tsx から分割。見た目・動きは変えない） */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Pagination from '@/components/shared/pagination'
import { MoreAction } from '@/components/shared/row-actions'
import ListRange from '@/components/ui/list-range'
import { ApiError, bookingApi, type BookingStaff, type StaffMenuMatrix } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { EMPTY_STAFF, StaffEditModal } from '../../staff/staff-edit-dialog'
import {
  AccountIcon,
  StateCard,
  SkeletonRows,
  type LoadStatus,
} from './shared'
import styles from '../settings-v8.module.css'

const STAFF_PAGE_SIZE = 4

const MEMBER_ROLE_LABEL: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
}

export function StaffTabV8({ accountId, staff, status, error, matrices, extras, members, canEdit, onReload }: {
  accountId: string
  staff: BookingStaff[]
  status: LoadStatus
  error: string | null
  matrices: Record<string, StaffMenuMatrix[]>
  extras: Record<string, { work: string | null; calendar: 'loading' | 'connected' | 'none' | 'error' }>
  members: StaffMember[]
  canEdit: boolean
  onReload: () => void
}) {
  const router = useRouter()
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<BookingStaff> | null>(null)
  const [removeTarget, setRemoveTarget] = useState<BookingStaff | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [pauseTarget, setPauseTarget] = useState<BookingStaff | null>(null)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const pageCount = Math.max(1, Math.ceil(staff.length / STAFF_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = staff.slice((safePage - 1) * STAFF_PAGE_SIZE, safePage * STAFF_PAGE_SIZE)

  async function saveStaff(input: Partial<BookingStaff>) {
    if (input.id) {
      await bookingApi.updateStaff(accountId, input.id, input)
    } else {
      await bookingApi.createStaff(accountId, input)
    }
    setEditing(null)
    onReload()
  }

  async function setActive(person: BookingStaff, nextActive: boolean) {
    setPausing(true)
    setPauseError(null)
    try {
      await bookingApi.updateStaff(accountId, person.id, { is_active: nextActive ? 1 : 0 })
      setPauseTarget(null)
      onReload()
    } catch (cause) {
      setPauseError(cause instanceof ApiError && cause.status === 403
        ? 'スタッフの受付状態を変える権限がありません。'
        : '変更できませんでした。もう一度お試しください。')
    } finally {
      setPausing(false)
    }
  }

  async function remove() {
    const target = removeTarget
    if (!target) return
    setRemoving(true)
    setRemoveError('')
    try {
      await bookingApi.deleteStaff(accountId, target.id)
      setRemoveTarget(null)
      onReload()
    } catch (cause) {
      setRemoveError(cause instanceof ApiError && cause.status === 403
        ? 'スタッフを消す権限がありません。'
        : '消せませんでした。もう一度お試しください。')
    } finally {
      setRemoving(false)
    }
  }

  function memberLabel(person: BookingStaff): string {
    if (!person.staff_member_id) return 'ひも付けなし'
    const member = members.find((entry) => entry.id === person.staff_member_id)
    if (!member) return 'ひも付けあり'
    const role = MEMBER_ROLE_LABEL[member.role] ?? member.role
    return `${member.name}（${role}）`
  }

  if (status === 'loading') return <SkeletonRows rows={4} />
  if (status === 'error') {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="スタッフを読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>読み直す</Button>}
      />
    )
  }

  return (
    <div data-design="Table">
      <div className={styles.staffHeadRow}>
        <h2 className={styles.staffHeadTitle}>担当スタッフ <b>{staff.length}人</b></h2>
        <div className={styles.staffHeadActions}>
          <Button href="/booking/menus/staff">担当メニューをまとめて決める</Button>
          {canEdit ? <Button variant="primary" onClick={() => setEditing(EMPTY_STAFF)}>＋ スタッフを登録</Button> : null}
        </div>
      </div>

      {staff.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="スタッフはまだいません"
          description="お客さまが予約するときに指名できる担当者を登録します。"
          action={canEdit ? <Button variant="primary" onClick={() => setEditing(EMPTY_STAFF)}>スタッフを登録</Button> : undefined}
        />
      ) : (
      <section className={styles.section}>
      <div className={`${styles.staffRow} ${styles.tableHead}`} aria-hidden="true">
        <span className={styles.staffName}>スタッフ</span>
        <span className={styles.staffColMenus}>担当メニュー</span>
        <span className={styles.staffColNoAssign}>指名なし</span>
        <span className={styles.staffColWork}>勤務（今週）</span>
        <span className={styles.staffColLink}>カレンダー・ログイン</span>
        <span className={styles.staffColStatus}>状態</span>
        <span className={styles.staffColMenu} />
      </div>

      {visible.map((person) => {
        const offered = (matrices[person.id] ?? []).filter((entry) => entry.is_offered).length
        const extra = extras[person.id]
        const menuItems: ActionMenuItem[] = [
          {
            id: 'shifts',
            label: '勤務とシフト',
            external: true,
            onSelect: () => router.push(`/booking/staff/shifts?staff_id=${person.id}`),
          },
          ...(canEdit ? [
            { id: 'edit', label: '中身を編集', onSelect: () => setEditing(person) },
            {
              id: 'pause',
              label: person.is_active ? '止める' : '再開する',
              onSelect: () => { setPauseError(null); setPauseTarget(person) },
            },
            {
              id: 'delete',
              label: '削除する',
              tone: 'danger' as const,
              dividerBefore: true,
              onSelect: () => { setRemoveError(''); setRemoveTarget(person) },
            },
          ] satisfies ActionMenuItem[] : []),
        ]
        return (
          <div key={person.id} className={styles.staffRow}>
            <span className={styles.staffName}>
              <Link href={`/booking/staff/shifts?staff_id=${person.id}`} className={styles.staffNameLink}>
                {person.name}
              </Link>
              {person.role ? <span className={styles.staffRole}>{person.role}</span> : null}
            </span>
            <span className={styles.staffColMenus}>
              {offered > 0 ? (
                <span className={styles.staffCellMain}>{offered}つ</span>
              ) : (
                <span className={styles.cellWarn}>
                  0<span className={styles.staffCellSub}>予約画面に出ません</span>
                </span>
              )}
            </span>
            <span className={styles.staffColNoAssign}>
              <span className={styles.staffCellMain}>{person.is_designation_optional ? '入る' : '—'}</span>
            </span>
            <span className={styles.staffColWork}>
              {extra?.work ? (() => {
                const [days, range] = extra.work.split('　')
                return (
                  <>
                    <span className={styles.staffCellMain}>{days}</span>
                    {range ? <span className={styles.staffCellSub}>{range}</span> : null}
                  </>
                )
              })() : <span className={styles.staffCellMain}>…</span>}
            </span>
            <span className={styles.staffColLink}>
              <span className={`${styles.linkState} ${extra?.calendar === 'connected' ? styles.linkStateOn : ''}`}>
                <span className={styles.linkStateDot} aria-hidden="true" />
                {extra?.calendar === 'connected' ? 'つながっている' : extra?.calendar === 'error' ? '確認できません' : 'つないでいない'}
              </span>
              <span className={styles.staffCellSub}>ログイン：{memberLabel(person)}</span>
            </span>
            <span className={styles.staffColStatus}>
              <span className={`${styles.statePill} ${person.is_active ? styles.statePillOn : styles.statePillOff}`}>
                <span className={styles.stateDot} aria-hidden="true" />
                {person.is_active ? '受付中' : '止めている'}
              </span>
            </span>
            <span className={styles.staffColMenu}>
              <MoreAction
                label={`${person.display_name}のそのほかの操作`}
                aria-expanded={openMenuId === person.id}
                onClick={() => setOpenMenuId((current) => (current === person.id ? null : person.id))}
                className={styles.rowMenuButton}
              />
              <ActionMenu
                open={openMenuId === person.id}
                inline
                ariaLabel={`${person.display_name}の操作`}
                onClose={() => setOpenMenuId(null)}
                items={menuItems}
              />
            </span>
          </div>
        )
      })}

      {staff.length > STAFF_PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <ListRange
            label="スタッフ"
            total={staff.length}
            first={visible.length === 0 ? 0 : (safePage - 1) * STAFF_PAGE_SIZE + 1}
            last={(safePage - 1) * STAFF_PAGE_SIZE + visible.length}
          />
          <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} ariaLabel="担当スタッフのページ送り" />
        </div>
      ) : null}
      </section>
      )}

      <p className={`${styles.noteText} mt-4`}>
        行の「…」から 勤務とシフト・編集・止める。名前を押すと勤務とシフトが開きます。カレンダーにつないでいないスタッフは、ほかの予約サービスの予約で枠が埋まらないので、つなぐのをおすすめします。
      </p>

      {editing ? (
        <StaffEditModal staff={editing} onSave={saveStaff} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={pauseTarget !== null}
        title={`${pauseTarget?.display_name ?? ''}の受付を${pauseTarget?.is_active ? '止め' : '再開し'}ますか？`}
        description={pauseTarget?.is_active
          ? 'お客さまの画面から外れ、新しい予約を受けなくなります。すでに入っている予約はそのまま残ります。'
          : 'お客さまの画面へ出し、新しい予約を受け付けます。'}
        confirmLabel={pauseTarget?.is_active ? '止める' : '再開する'}
        destructive={Boolean(pauseTarget?.is_active)}
        busy={pausing}
        error={pauseError ?? undefined}
        onCancel={() => { if (!pausing) setPauseTarget(null) }}
        onConfirm={() => { if (pauseTarget) void setActive(pauseTarget, !pauseTarget.is_active) }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget?.display_name ?? ''}」を削除しますか？`}
        description="削除すると元に戻せません。受付だけ止めたいときは「止める」を使ってください。"
        confirmLabel="削除する"
        destructive
        busy={removing}
        error={removeError || undefined}
        onCancel={() => { if (!removing) setRemoveTarget(null) }}
        onConfirm={() => void remove()}
      />

    </div>
  )
}
