'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type { MergedPersonDeliveryPriority, MergedPersonLinkedFriend } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { api, ApiError, type MergedPersonWithCandidates } from '@/lib/api'
import MergedDeliveryDialog from './merged-delivery-dialog'
import MergedProfileDialog, {
  emptyProfileCandidateDraft,
  type ProfileCandidateDraft,
} from './merged-profile-dialog'
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
  const [person, setPerson] = useState<MergedPersonWithCandidates | null>(null)
  const [failure, setFailure] = useState<MergedPersonFailure | null>(null)
  const [editing, setEditing] = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileDraft, setProfileDraft] = useState<ProfileCandidateDraft>({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [unlinkTarget, setUnlinkTarget] = useState<MergedPersonLinkedFriend | null>(null)
  const [unlinkReason, setUnlinkReason] = useState('')
  const [unlinking, setUnlinking] = useState(false)

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
        setPerson({ ...res.data, profileCandidates: res.data.profileCandidates ?? [], tagCandidates: res.data.tagCandidates ?? [] })
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
          setPerson((current) => current ? { ...res.data, profileCandidates: current.profileCandidates, tagCandidates: current.tagCandidates } : null)
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

  const unlink = useCallback(() => {
    if (!person || !unlinkTarget || !unlinkReason.trim()) return
    setUnlinking(true)
    setSaveError('')
    api.mergedPeople.unlink(person.id, unlinkTarget.friendId, {
      expectedRevision: person.revision,
      reason: unlinkReason.trim(),
    }).then((res) => {
      if (!res.success) {
        setSaveError(failureOf(null).description)
        return
      }
      setUnlinkTarget(null)
      setUnlinkReason('')
      setReloadKey((key) => key + 1)
    }).catch((error: unknown) => {
      const next = error instanceof ApiError
        ? failureOf({ status: error.status, code: error.code })
        : failureOf(null)
      setSaveError(`${next.title}。${next.description}`)
    }).finally(() => setUnlinking(false))
  }, [person, unlinkReason, unlinkTarget])

  const openProfileEditor = useCallback(() => {
    if (!person) return
    setSaveError('')
    setProfileDraft(emptyProfileCandidateDraft(person.profileCandidates))
    setProfileEditing(true)
  }, [person])

  const saveProfile = useCallback(() => {
    if (!person) return
    const selections = person.profileCandidates.flatMap((field) => {
      const draft = profileDraft[field.fieldKey]
      const optionIndex = Number(draft?.optionIndex)
      const option = draft?.optionIndex !== '' && Number.isInteger(optionIndex) && optionIndex >= 0
        ? field.options[optionIndex]
        : undefined
      return option?.candidateId && draft
        ? [{ fieldKey: field.fieldKey, candidateId: option.candidateId, updateMode: draft.updateMode }]
        : []
    })
    if (selections.length === 0) return
    setProfileSaving(true)
    setSaveError('')
    api.mergedPeople.updateProfileValues(person.id, {
      expectedRevision: person.revision,
      selections,
    }).then((res) => {
      if (!res.success) {
        setSaveError(failureOf(null).description)
        return
      }
      setPerson(res.data)
      setProfileEditing(false)
      setProfileDraft({})
    }).catch((error: unknown) => {
      const next = error instanceof ApiError
        ? failureOf({ status: error.status, code: error.code })
        : failureOf(null)
      setSaveError(`${next.title}。${next.description}`)
    }).finally(() => setProfileSaving(false))
  }, [person, profileDraft])

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
          <Button type="button" variant="primary" data-qa-open="w8W4Eh-profile" onClick={openProfileEditor}>
            プロフィールを編集
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
        <MergedProfileCard person={person} tags={person.tagCandidates} />
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
        <MergedFriendsTable friends={person.linkedFriends} onUnlink={setUnlinkTarget} />
        <MergedProfileValues
          values={person.profileValues}
          candidates={person.profileCandidates}
          onEdit={openProfileEditor}
        />
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

      <MergedProfileDialog
        open={profileEditing}
        candidates={person.profileCandidates}
        draft={profileDraft}
        revision={person.revision}
        busy={profileSaving}
        error={saveError || undefined}
        onChange={setProfileDraft}
        onCancel={() => setProfileEditing(false)}
        onSave={saveProfile}
      />

      <Dialog
        open={Boolean(unlinkTarget)}
        title="統合を解除"
        description="元の友だちと過去の履歴は消さず、この統合ユーザーとの結び付けだけを解除します。"
        tone="destructive"
        busy={unlinking}
        error={saveError || undefined}
        onCancel={() => setUnlinkTarget(null)}
        designNode="w8W4Eh"
        footer={(
          <div className={styles.actions}>
            <Button type="button" onClick={() => setUnlinkTarget(null)} disabled={unlinking}>やめる</Button>
            <Button type="button" variant="primary" className="!bg-danger !text-on-accent" onClick={unlink} disabled={unlinking || !unlinkReason.trim()}>
              {unlinking ? '解除中…' : '結び付けを解除'}
            </Button>
          </div>
        )}
      >
        <label className={styles.fieldLabel}>
          解除する友だち
          <span className={styles.personName}>{unlinkTarget?.displayName}</span>
        </label>
        <label className={styles.fieldLabel}>
          解除する理由（必須）
          <textarea className={styles.reason} value={unlinkReason} onChange={(event) => setUnlinkReason(event.target.value)} placeholder="確認した根拠を書いてください" />
        </label>
      </Dialog>
    </div>
  )
}
