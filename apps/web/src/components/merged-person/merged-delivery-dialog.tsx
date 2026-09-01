'use client'

import React, { useEffect, useState } from 'react'
import type { MergedPersonDeliveryPriority } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import {
  canSaveDeliveryPriorities,
  groupByPurpose,
  purposeText,
} from './merged-person-view'
import styles from './merged-person-detail.module.css'

/**
 * 配信元の優先順を変える窓（設計 `w8W4Eh`「優先順位を変更」）。
 *
 * **全部を「使わない」にすると、この人へはどこからも送れなくなる。**
 * 契約では空配列がそのまま「全部解除」になるので、押し間違いで送られないよう、
 * その状態のときだけ確認の印を要求する。
 *
 * 保存には読み込んだ `revision` を付ける。先に別の人が変えていれば
 * Worker が 409 を返し、呼び手が読み直しへ導く。
 */
export default function MergedDeliveryDialog({
  open,
  priorities,
  revision,
  busy,
  error,
  onCancel,
  onSave,
}: {
  open: boolean
  priorities: MergedPersonDeliveryPriority[]
  revision: number
  busy: boolean
  /** 版競合や権限不足の言い換え。統合ユーザーの中身は入れない。 */
  error?: string
  onCancel: () => void
  onSave: (rows: MergedPersonDeliveryPriority[]) => void
}) {
  const [rows, setRows] = useState<MergedPersonDeliveryPriority[]>(priorities)
  const [confirmedClearAll, setConfirmedClearAll] = useState(false)

  // 別の人を開いたら、前の人の編集を持ち越さない。
  useEffect(() => {
    if (!open) return
    setRows(priorities)
    setConfirmedClearAll(false)
  }, [open, priorities])

  const activeCount = rows.filter((row) => row.isActive).length
  const clearingAll = activeCount === 0
  const ready = canSaveDeliveryPriorities({ priorities: rows, confirmedClearAll, busy })

  const toggle = (purpose: string, friendId: string) =>
    setRows((current) =>
      current.map((row) =>
        row.purpose === purpose && row.friendId === friendId
          ? { ...row, isActive: !row.isActive }
          : row,
      ),
    )

  const move = (purpose: string, friendId: string, delta: -1 | 1) =>
    setRows((current) => {
      const group = current.filter((row) => row.purpose === purpose)
        .sort((a, b) => a.priority - b.priority)
      const index = group.findIndex((row) => row.friendId === friendId)
      const next = index + delta
      if (index < 0 || next < 0 || next >= group.length) return current
      const reordered = [...group]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(next, 0, moved)
      const ranks = new Map(reordered.map((row, i) => [row.friendId, i + 1]))
      return current.map((row) =>
        row.purpose === purpose ? { ...row, priority: ranks.get(row.friendId) ?? row.priority } : row,
      )
    })

  return (
    <Dialog
      open={open}
      title="配信元の優先順を変える"
      description="同じ人へ2通目以降を送らないよう、用途ごとに上から1件だけ選びます。"
      busy={busy}
      error={error}
      onCancel={onCancel}
      designNode="w8W4Eh"
      footer={
        <div className={styles.actions}>
          <Button type="button" onClick={onCancel} disabled={busy}>
            やめる
          </Button>
          <Button type="button" variant="primary" onClick={() => onSave(rows)} disabled={!ready}>
            {busy ? '処理中…' : '保存する'}
          </Button>
        </div>
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.note}>読み込んだのは第{revision}版です。保存のときに一緒に送ります。</p>

        {groupByPurpose(rows).map((group) => (
          <div key={group.purpose} className={styles.priorityGroup}>
            <p className={styles.sectionNote}>{purposeText(group.purpose)}</p>
            {group.rows.map((row, index) => (
              <div
                key={`${row.purpose}-${row.friendId}`}
                className={`${styles.editRow} ${row.isActive ? '' : styles.editRowOff}`}
              >
                <span className={styles.priorityRank}>{index + 1}</span>
                <span className={styles.editText}>
                  <span className={styles.editTitle}>{row.lineAccountName}</span>
                  <span className={styles.editNote}>{row.reason}</span>
                </span>
                <span className={styles.rankButtons}>
                  <Button
                    type="button"
                    onClick={() => move(row.purpose, row.friendId, -1)}
                    disabled={index === 0}
                    aria-label={`${row.lineAccountName}を上へ`}
                  >
                    上へ
                  </Button>
                  <Button
                    type="button"
                    onClick={() => move(row.purpose, row.friendId, 1)}
                    disabled={index === group.rows.length - 1}
                    aria-label={`${row.lineAccountName}を下へ`}
                  >
                    下へ
                  </Button>
                  <Button type="button" onClick={() => toggle(row.purpose, row.friendId)}>
                    {row.isActive ? '使わない' : '使う'}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ))}

        {clearingAll ? (
          <label className={styles.warn}>
            <input
              type="checkbox"
              checked={confirmedClearAll}
              onChange={(event) => setConfirmedClearAll(event.target.checked)}
            />
            {' '}
            全部を「使わない」にすると、この人へはどこからも送れなくなります。承知のうえで保存します。
          </label>
        ) : null}
      </div>
    </Dialog>
  )
}
