'use client'

import { PageHeading } from '@/components/templates/page-frame'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import ListState from '@/components/shared/list-state'
import { isForbidden, isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { bookingApi, type BookingStaff } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canEditFeature } from '@/lib/staff-capability'
// 編集窓は V8 予約設定の担当スタッフタブ（menus/settings-v8.tsx）と共用。
import { EMPTY_STAFF as EMPTY, StaffEditModal } from './staff-edit-dialog'

type LoadStatus = 'loading' | 'ready' | 'error'

/** 担当一覧の読み込み待ちの骨組み（見出しはそのまま・5行・列幅も本物と同じ）。 */
function StaffTableSkeleton() {
  return (
    <DataTable data-design="Table" aria-hidden="true">
      <thead>
        <TableHeadRow>
          <Th>スタッフ</Th>
          <Th style={{ width: '16%' }}>役職</Th>
          <Th style={{ width: '14%' }} align="center">指名なし枠</Th>
          <Th style={{ width: '10%' }} align="right">並び順</Th>
          <Th style={{ width: '10%' }} align="center">有効</Th>
          <Th align="right" className="w-32">操作</Th>
        </TableHeadRow>
      </thead>
      <tbody>
        {[0, 1, 2, 3, 4].map((row) => (
          <Tr key={row}>
            <Td>
              <div className="flex items-center gap-3">
                <Skeleton circle width={36} height={36} />
                <div>
                  <Skeleton width={96} height={16} />
                  <Skeleton width={64} height={12} />
                </div>
              </div>
            </Td>
            <Td><Skeleton width="60%" height={14} /></Td>
            <Td align="center"><Skeleton width={48} height={18} /></Td>
            <Td align="right"><Skeleton width={32} height={14} /></Td>
            <Td align="center"><Skeleton width={40} height={18} /></Td>
            <Td align="right"><Skeleton width={96} height={28} /></Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  )
}

export default function BookingStaffPage() {
  usePageTitle('予約設定')
  const { selectedAccountId } = useAccount()
  /* V8 のときだけ骨組み・保存中表示へ。v7 は従来の見た目のまま。 */
  const adminTheme = useAdminTheme()
  const [items, setItems] = useState<BookingStaff[]>([])
  const [editing, setEditing] = useState<Partial<BookingStaff> | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  /** m23m: 捕まえた読み込み失敗。403・429の1枚へ渡すためだけに持つ。 */
  const [loadError, setLoadError] = useState<unknown>(null)
  const [removeTarget, setRemoveTarget] = useState<BookingStaff | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [removeError, setRemoveError] = useState('')
  // N-411: 予約スタッフの登録・変更・削除は 'booking.settings' の実効permission。
  const [canManageStaff, setCanManageStaff] = useState(false)
  // 行の「その他」メニューの開き先（#641）
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()
  const loadRequestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!selectedAccountId) {
      setItems([])
      setLoadStatus('ready')
      return
    }
    setLoadStatus('loading')
    setLoadError(null)
    // アカウント切替時の stale state 防止（cross-account 表示/操作の事故防止）。
    setItems([])
    try {
      const r = await bookingApi.listStaff(selectedAccountId)
      if (requestId !== loadRequestRef.current) return
      setItems(r.staff)
      setLoadStatus('ready')
    } catch (caught) {
      if (requestId !== loadRequestRef.current) return
      setItems([])
      setLoadError(caught)
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    setCanManageStaff(canEditFeature('booking.settings'))
  }, [])

  useEffect(() => {
    void load()
    return () => {
      loadRequestRef.current += 1
    }
  }, [load])

  async function save(s: Partial<BookingStaff>) {
    if (!selectedAccountId) return
    if (s.id) {
      await bookingApi.updateStaff(selectedAccountId, s.id, s)
    } else {
      await bookingApi.createStaff(selectedAccountId, s)
    }
    setEditing(null)
    await load()
  }

  /**
   * 消す前に、**何が消えて何が残るかを本文で読ませる。**
   * ブラウザの `confirm()` は見た目がブラウザ任せで、設計の確認窓と違ううえ、
   * 画像比較にも写らない（確認の絵をそもそも撮れない）。
   */
  async function remove(id: string) {
    if (!selectedAccountId) return
    setDeleting(true)
    setRemoveError('')
    try {
      await bookingApi.deleteStaff(selectedAccountId, id)
      setRemoveTarget(null)
      await load()
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setRemoveError('このスタッフを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="v8-only"><PageHeading title="担当スタッフ" /></div>
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav data-design="Crumb" className="text-ink-faint text-xs" aria-label="パンくず">
          <Link href="/booking/menus" className="hover:underline">予約設定</Link>
          <span className="mx-1.5">/</span>
          <span>担当スタッフ</span>
        </nav>
      </div>
      {/*
        作る操作は一覧のすぐ上の左。見出しの行の右端には置かない。
        押せない理由はボタンの説明に出す。押せないボタンを黙って置かない。
      */}
      <div data-design="Actions" className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => setEditing(EMPTY)}
          disabled={!canManageStaff || !selectedAccountId || loadStatus !== 'ready'}
          title={canManageStaff ? undefined : '予約設定の変更権限がありません'}
        >
          ＋ スタッフを作る
        </Button>
      </div>

      {!selectedAccountId ? (
        <div className="bg-canvas rounded-card border border-hairline">
          <ListState kind="empty" title="LINEアカウントを選んでください" description="共通メニューで、予約スタッフを管理するLINEアカウントを選んでください。" />
        </div>
      ) : loadStatus === 'loading' ? (
        adminTheme === 'v8' ? (
          <div aria-busy="true">
            <span className="sr-only" role="status">予約スタッフを読み込んでいます</span>
            <DelayedSkeleton loading skeleton={<StaffTableSkeleton />} />
          </div>
        ) : (
          <ListState kind="loading" title="予約スタッフを読み込んでいます" />
        )
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="予約スタッフを表示できませんでした"
          // m23m: 403・429は共通の1枚（権限の案内・待ち案内）へ切り替える。
          // それ以外は画面の文のまま。R539: 429は待ち直せば直るので再試行の口を
          // 残す。403だけが押しても直らないので再試行の口を出さない。
          description={isForbiddenOrRateLimited(loadError) ? undefined : '登録したスタッフは消えていません。再読み込みしても直らない場合はエラー報告へ。'}
          error={loadError ?? undefined}
          action={isForbidden(loadError) ? undefined : <Button variant="secondary" onClick={() => void load()}>予約スタッフを再読み込み</Button>}
        />
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border border-hairline">
          <ListState kind="empty" title="予約スタッフはまだいません" description="「＋ スタッフを作る」から最初のスタッフを追加してください。" />
        </div>
      ) : (
        <DataTable data-design="Table">
              <thead>
                <TableHeadRow>
                  {/* 名前は長さが読めないため幅を指定しない。残りを吸って表を器に合わせる。 */}
                  <Th>スタッフ</Th>
                  <Th style={{ width: '16%' }}>役職</Th>
                  <Th style={{ width: '14%' }} align="center">指名なし枠</Th>
                  <Th style={{ width: '10%' }} align="right">並び順</Th>
                  <Th style={{ width: '10%' }} align="center">有効</Th>
                  {/*
                    操作列は固定幅（128px）。割合（24%）では右に大きく空く。
                    中身（編集＋…約118px）に合わせる。残りは割合と自動の列で吸う。
                  */}
                  <Th align="right" className="w-32">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {items.map((s) => (
                  <Tr key={s.id} interactive>
                    <Td>
                      <div className="flex items-center gap-3">
                        {s.profile_image_url ? (
                          <img
                            src={s.profile_image_url}
                            alt={s.display_name}
                            className="w-9 h-9 rounded-pill object-cover"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-pill bg-shell-gray flex items-center justify-center text-ink-faint text-xs">
                            {s.display_name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{s.display_name}</div>
                          {s.name !== s.display_name && (
                            <div className="text-xs text-ink-faint">{s.name}</div>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink-secondary">{s.role ?? '-'}</Td>
                    <Td align="center">
                      {s.is_designation_optional ? (
                        <span className="inline-block px-2 py-0.5 rounded-mini bg-chip-alt-soft text-chip-alt text-xs">指名なし</span>
                      ) : (
                        <span className="text-xs text-ink-disabled">-</span>
                      )}
                    </Td>
                    <Td align="right" className="tabular-nums text-ink-faint">{s.sort_order}</Td>
                    <Td align="center">
                      {s.is_active ? (
                        <span className="inline-block px-2 py-0.5 rounded-mini bg-success-bg text-success text-xs">ON</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-mini bg-canvas-sunken text-ink-faint text-xs">OFF</span>
                      )}
                    </Td>
                    <ActionCell>
                      {/* 行の操作は「主な1つ＋…メニュー」。削除は行に直に置かず、メニューの中の危ない操作へ。 */}
                      <div className="relative inline-flex items-center justify-end gap-1.5">
                        {canManageStaff ? (
                          <>
                            <Button variant="secondary" size="compact" onClick={() => setEditing(s)}>編集</Button>
                            <IconButton
                              aria-label={`${s.display_name}のその他操作`}
                              aria-expanded={openMenuId === s.id}
                              onClick={() => setOpenMenuId((current) => (current === s.id ? null : s.id))}
                            >
                              <MoreHorizontal aria-hidden />
                            </IconButton>
                            <ActionMenu
                              open={openMenuId === s.id}
                              ariaLabel={`${s.display_name}の操作`}
                              onClose={() => setOpenMenuId(null)}
                              items={[{
                                id: 'shift',
                                label: 'シフト',
                                onSelect: () => router.push(`/booking/staff/shifts?staff_id=${s.id}`),
                              }, {
                                id: 'delete',
                                label: '削除する',
                                tone: 'danger',
                                dividerBefore: true,
                                onSelect: () => { setRemoveError(''); setRemoveTarget(s) },
                              }]}
                            />
                          </>
                        ) : (
                          <Button href={`/booking/staff/shifts?staff_id=${s.id}`} variant="secondary" size="compact">
                            シフト
                          </Button>
                        )}
                      </div>
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
        </DataTable>
      )}

      {editing && <StaffEditModal staff={editing} onSave={save} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget?.name ?? ''}」を削除しますか？`}
        description="このスタッフを一覧から削除します。すでに入っている予約はそのまま残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={removeError}
        onCancel={() => {
          if (deleting) return
          setRemoveTarget(null)
          setRemoveError('')
        }}
        onConfirm={() => { if (removeTarget) void remove(removeTarget.id) }}
      />
    </div>
  )
}
