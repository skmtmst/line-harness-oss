'use client'

import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { RequiredBadge } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import MergedDeliveryDialog from './merged-delivery-dialog'
import MergedProfileDialog from './merged-profile-dialog'
import {
  MergedAdminCard,
  MergedDeliveryCard,
  MergedFriendsTable,
  MergedHistoryTable,
  MergedProfileCard,
  MergedProfileValues,
} from './merged-person-sections'
import { useMergedPerson } from './use-merged-person'
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
export default function MergedPersonDetailView({
  personId,
  onClose,
}: {
  personId: string
  onClose: () => void
}) {
  // 読み込み・保存・解除のロジックは use-merged-person.ts が正本。
  // ★V8 の詳細（merged-person-detail-v8.tsx）も同じ口を使う。
  const {
    phase,
    person,
    failure,
    editing,
    setEditing,
    profileEditing,
    setProfileEditing,
    profileDraft,
    setProfileDraft,
    profileSaving,
    saving,
    saveError,
    setSaveError,
    reload,
    save,
    unlinkTarget,
    setUnlinkTarget,
    unlinkReason,
    setUnlinkReason,
    unlinking,
    unlink,
    openProfileEditor,
    saveProfile,
  } = useMergedPerson(personId)

  if (phase === 'loading') return <ListState kind="loading" />
  if (phase === 'forbidden') {
    /*
     * R391: 権限不足でも一覧へ戻る口は残す。解除しきった直後の本人は
     * サーバー側で保管状態として開くので、ここは本当に権限が無いときだけ。
     */
    return (
      <ListState
        kind="forbidden"
        title={failure?.title}
        description={failure?.description}
        action={<Button type="button" onClick={onClose}>一覧へ戻る</Button>}
      />
    )
  }
  if (phase === 'error' || !person) {
    // 取得失敗は共通の再読み込み口だけにする（契約試験）。一覧へ戻る口は
    // forbidden 側に残し、ここでは読み直しを優先する。
    return (
      <ListState
        kind="error"
        title={failure?.title}
        description={failure?.description}
        onRetry={reload}
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
          <button type="button" className={styles.crumbLink} onClick={reload}>
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
            <Button type="button" onClick={() => setUnlinkTarget(null)} disabled={unlinking}>キャンセル</Button>
            <Button type="button" variant="primary" className="!bg-danger !text-on-accent" onClick={unlink} disabled={unlinking || !unlinkReason.trim()} busy={unlinking} busyLabel="解除中…">結び付けを解除
            </Button>
          </div>
        )}
      >
        <label className={styles.fieldLabel}>
          解除する友だち
          <span className={styles.personName}>{unlinkTarget?.displayName}</span>
        </label>
        <label className={styles.fieldLabel}>
          <span>解除する理由<RequiredBadge /></span>
          <textarea className={styles.reason} value={unlinkReason} onChange={(event) => setUnlinkReason(event.target.value)} placeholder="確認した根拠を書いてください" />
        </label>
      </Dialog>
    </div>
  )
}
