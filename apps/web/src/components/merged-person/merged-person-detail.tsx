'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type { MergedPersonDeliveryPriority, MergedPersonDetail } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { api, ApiError } from '@/lib/api'
import MergedDeliveryDialog from './merged-delivery-dialog'
import {
  MergedAdminCard,
  MergedDeliveryCard,
  MergedFriendsTable,
  MergedHistoryTable,
  MergedProfileCard,
  MergedProfileValues,
} from './merged-person-sections'
import { failureOf, type MergedPersonFailure } from './merged-person-view'
import styles from './merged-person-detail.module.css'

/**
 * 統合ユーザー詳細（設計 `w8W4Eh` 3-3-A）。
 *
 * `/friends?tab=merged` の一覧から1件開く。同じ画面を二重に作らないため、
 * 別のルートは足さず、一覧の面をこの詳細に差し替える。
 *
 * 出せないときは4つに分ける。**読込・失敗・権限不足は面ごと差し替え**、
 * **取得できた0件は各節の中で「まだありません」**と書く。失敗を0件と
 * 同じ文にすると、読めていないだけなのに「消えた」に見える。
 */
type Phase = 'loading' | 'ready' | 'error' | 'forbidden'

export default function MergedPersonDetailView({
  personId,
  onClose,
}: {
  personId: string
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [person, setPerson] = useState<MergedPersonDetail | null>(null)
  const [failure, setFailure] = useState<MergedPersonFailure | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setPhase('loading')
    setFailure(null)
    api.mergedPeople
      .get(personId)
      .then((res) => {
        if (!alive) return
        /*
         * 200 でも `success: false` が返ることがある（画面確認のモックも
         * この形で失敗を返す）。中身を読む前に必ず見る。
         */
        if (!res.success) {
          setFailure(failureOf(null))
          setPhase('error')
          return
        }
        setPerson(res.data)
        setPhase('ready')
      })
      .catch((error: unknown) => {
        if (!alive) return
        const next = error instanceof ApiError
          ? failureOf({ status: error.status, code: error.code })
          : failureOf(null)
        setFailure(next)
        setPhase(next.kind === 'forbidden' ? 'forbidden' : 'error')
      })
    return () => {
      alive = false
    }
  }, [personId, reloadKey])

  const save = useCallback(
    (rows: MergedPersonDeliveryPriority[]) => {
      if (!person) return
      setSaving(true)
      setSaveError('')
      api.mergedPeople
        .updateDeliveryPriorities(person.id, {
          expectedRevision: person.revision,
          priorities: rows.map((row) => ({
            purpose: row.purpose,
            friendId: row.friendId,
            priority: row.priority,
            isActive: row.isActive,
            reason: row.reason,
          })),
        })
        .then((res) => {
          if (!res.success) {
            setSaveError(failureOf(null).description)
            return
          }
          setPerson(res.data)
          setEditing(false)
        })
        .catch((error: unknown) => {
          const next = error instanceof ApiError
            ? failureOf({ status: error.status, code: error.code })
            : failureOf(null)
          setSaveError(`${next.title}。${next.description}`)
        })
        .finally(() => setSaving(false))
    },
    [person],
  )

  if (phase === 'loading') return <ListState kind="loading" />
  if (phase === 'forbidden') {
    return <ListState kind="forbidden" title={failure?.title} description={failure?.description} />
  }
  if (phase === 'error' || !person) {
    return (
      <ListState
        kind="error"
        title={failure?.title}
        description={failure?.description}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  return (
    <div className={styles.screen} data-design-node="w8W4Eh">
      <div className={styles.top}>
        <div>
          <p className={styles.crumb}>
            <button type="button" className={styles.crumbLink} onClick={onClose}>
              統合ユーザー
            </button>
            <span>›</span>
            <span>{person.primaryDisplayName}</span>
          </p>
          <p className={styles.title}>{person.primaryDisplayName}</p>
        </div>
        <div className={styles.actions}>
          <Button type="button" onClick={onClose}>
            一覧へ戻る
          </Button>
        </div>
      </div>

      {/*
        版が競合したときは、この面の上に出す。窓を閉じたあとも
        「保存できなかった」ことが残るようにするため、窓の中だけに置かない。
      */}
      {saveError ? (
        <p className={styles.warn} role="alert">
          {saveError}{' '}
          <button type="button" className={styles.crumbLink} onClick={() => setReloadKey((key) => key + 1)}>
            読み直す
          </button>
        </p>
      ) : null}

      <div className={styles.three}>
        <MergedProfileCard person={person} />
        <MergedDeliveryCard
          priorities={person.deliveryPriorities}
          onEdit={() => {
            setSaveError('')
            setEditing(true)
          }}
        />
        <MergedAdminCard person={person} />
      </div>

      <div className={styles.two}>
        <MergedFriendsTable friends={person.linkedFriends} />
        <MergedProfileValues values={person.profileValues} />
      </div>

      <MergedHistoryTable history={person.history} />

      <MergedDeliveryDialog
        open={editing}
        priorities={person.deliveryPriorities}
        revision={person.revision}
        busy={saving}
        error={saveError || undefined}
        onCancel={() => setEditing(false)}
        onSave={save}
      />
    </div>
  )
}
