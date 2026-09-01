import React from 'react'
import type {
  MergedPersonDetail,
  MergedPersonDeliveryPriority,
  MergedPersonHistoryItem,
  MergedPersonLinkedFriend,
  MergedPersonProfileValue,
} from '@line-crm/shared'
import Card from '@/components/shared/card'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  confidenceText,
  dateText,
  dayText,
  eventText,
  groupByPurpose,
  NOT_AVAILABLE,
  previewText,
  purposeText,
  sourceText,
  statusText,
  updateModeText,
} from './merged-person-view'
import styles from './merged-person-detail.module.css'

/**
 * 統合ユーザー詳細（設計 `w8W4Eh`）の各節。
 *
 * どの節も**取得できた0件**を「まだありません」と書く。失敗と権限不足は
 * 呼び手（`merged-person-detail.tsx`）が面ごと差し替えるので、ここへは来ない。
 * 0件を失敗と同じ文にすると、読めていないだけなのに「消えた」に見える。
 *
 * `friendId` / `candidateId` / `lineAccountId` は操作にだけ使い、本文へ出さない。
 * メール・電話は `valuePreview` をそのまま出し、生値は組み立てない。
 */

export function MergedProfileCard({ person }: { person: MergedPersonDetail }) {
  const email = person.profileValues.find((value) => value.fieldKey === 'email')
  const phone = person.profileValues.find((value) => value.fieldKey === 'phone')
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="profile">
      <p className={styles.sectionTitle}>統合プロフィール</p>
      <p className={styles.personName}>{person.primaryDisplayName}</p>
      <div className={styles.rows}>
        <Row label="メールアドレス" value={email ? previewText(email.valuePreview) : NOT_AVAILABLE} />
        <Row label="電話番号" value={phone ? previewText(phone.valuePreview) : NOT_AVAILABLE} />
        <Row label="状態" value={statusText(person.status)} />
        <Row label="結び付いている友だち" value={`${person.linkedFriends.length}件`} />
      </div>
    </Card>
  )
}

/**
 * 配信元の優先順。
 *
 * **用途ごとに独立している。** 混ぜて並べると、1位が2つあるように見える。
 */
export function MergedDeliveryCard({
  priorities,
  onEdit,
}: {
  priorities: MergedPersonDeliveryPriority[]
  onEdit: () => void
}) {
  const groups = groupByPurpose(priorities)
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="delivery">
      <p className={styles.sectionTitle}>重複配信時の優先順位</p>
      {groups.length === 0 ? (
        <p className={styles.empty}>優先順はまだ決めていません。用途ごとに配信元を選べます。</p>
      ) : (
        groups.map((group) => (
          <div key={group.purpose} className={styles.priorityGroup}>
            <p className={styles.sectionNote}>{purposeText(group.purpose)}</p>
            {group.rows.map((row) => (
              <p key={`${row.purpose}-${row.friendId}`} className={styles.priorityRow}>
                <span className={styles.priorityRank}>{row.priority}</span>
                <span className={styles.priorityName}>{row.lineAccountName}</span>
                <span className={`${styles.tag} ${row.isActive ? styles.tagOn : styles.tagOff}`}>
                  {row.isActive ? '使う' : '使わない'}
                </span>
                <span className={styles.priorityReason}>{row.reason}</span>
              </p>
            ))}
          </div>
        ))
      )}
      <p className={styles.sectionNote}>
        同じ人へ2通目以降を送らないよう、配信前に上の順で1件だけ選びます。
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.crumbLink} onClick={onEdit}>
          優先順位を変更
        </button>
      </div>
    </Card>
  )
}

/**
 * 統合の管理。
 *
 * 解除の口は #599 に無く、#598 の候補取り消しを使う。だから
 * **候補から結び付いたものだけ**「本人照合へ戻る」導線を出す。
 * 移行で入った古い結び付きには `candidateId` が無いので、戻る先が無い。
 */
export function MergedAdminCard({ person }: { person: MergedPersonDetail }) {
  const linked = person.history.find((item) => item.eventType === 'link')
  const fromCandidate = person.linkedFriends.filter((friend) => friend.candidateId !== null)
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="admin">
      <p className={styles.sectionTitle}>統合の管理</p>
      <div className={styles.rows}>
        <Row label="まとめた日時" value={dateText(person.createdAt)} />
        <Row label="最後の変更" value={dateText(person.updatedAt)} />
        <Row label="担当" value={linked?.actorName ?? NOT_AVAILABLE} pending={!linked} />
        <Row label="読み込んだ版" value={`第${person.revision}版`} />
      </div>
      <p className={styles.sectionNote}>
        {fromCandidate.length > 0
          ? '解除は本人照合の判定を取り消して行います。元の友だちと履歴は残ります。'
          : '本人照合を通していない結び付きのため、この画面からは解除できません。'}
      </p>
    </Card>
  )
}

/** 紐付く友だち。`friendId` は開く操作にだけ使い、本文へは出さない。 */
export function MergedFriendsTable({ friends }: { friends: MergedPersonLinkedFriend[] }) {
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="friends">
      <p className={styles.sectionTitle}>結び付いている友だち {friends.length}件</p>
      {friends.length === 0 ? (
        <p className={styles.empty}>結び付いている友だちはまだありません。</p>
      ) : (
        <div className={styles.tableWrap}>
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th>アカウント</Th>
                <Th>表示名</Th>
                <Th>状態</Th>
                <Th>結び付けた日</Th>
                <Th align="right">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {friends.map((friend) => (
                <Tr key={friend.friendId}>
                  <Td>{friend.lineAccountName}</Td>
                  <Td>{friend.displayName}</Td>
                  <Td>
                    <span className={styles.cellStack}>
                      <span className={`${styles.tag} ${friend.isFollowing ? styles.tagOn : styles.tagWarn}`}>
                        {friend.isFollowing ? '友だち' : 'ブロック中'}
                      </span>
                      {/* 確からしさは列を足さず状態の下に置く。半分の幅に6列は入らない。 */}
                      <span className={styles.cellSub}>
                        確からしさ {confidenceText(friend.confidence)}
                      </span>
                    </span>
                  </Td>
                  <Td>{dayText(friend.linkedAt)}</Td>
                  <ActionCell>
                    <a
                      className={styles.crumbLink}
                      href={`/friends/detail?id=${encodeURIComponent(friend.friendId)}`}
                    >
                      友だちを開く
                    </a>
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </Card>
  )
}

/** 統合された属性。項目ごとに「どこから採ったか」を記録する。 */
export function MergedProfileValues({ values }: { values: MergedPersonProfileValue[] }) {
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="values">
      <p className={styles.sectionTitle}>統合された属性 {values.length}件</p>
      {values.length === 0 ? (
        <p className={styles.empty}>採用した値はまだありません。</p>
      ) : (
        <div className={styles.rows}>
          {values.map((value) => (
            <div key={value.fieldKey} className={styles.cellStack}>
              <p className={styles.row}>
                <span className={styles.rowLabel}>{value.fieldLabel}</span>
                <span className={styles.rowValue}>{previewText(value.valuePreview)}</span>
              </p>
              <p className={styles.cellSub}>
                {sourceText(value.sourceType)}（{value.sourceLabel}）／
                {updateModeText(value.updateMode)}／
                {value.verifiedAt ? `確認済み ${dateText(value.verifiedAt)}` : '未確認'}／
                {value.selectedByName} が {dateText(value.selectedAt)} に採用
              </p>
            </div>
          ))}
        </div>
      )}
      <p className={styles.sectionNote}>
        採用する値の変更は、変更元の項目が揃ってから開けます。
      </p>
    </Card>
  )
}

/** すべてのアカウントを横断した履歴。 */
export function MergedHistoryTable({ history }: { history: MergedPersonHistoryItem[] }) {
  return (
    <Card layout="vertical" className={styles.section} data-merged-part="history">
      <p className={styles.sectionTitle}>すべてのアカウントを横断した履歴</p>
      {history.length === 0 ? (
        <p className={styles.empty}>まだ記録がありません。</p>
      ) : (
        <div className={styles.tableWrap}>
          <DataTable>
            <thead>
              <TableHeadRow>
                <Th>日時</Th>
                <Th>種別</Th>
                <Th>内容</Th>
                <Th>担当</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {history.map((item) => (
                <Tr key={item.id}>
                  <Td>{dateText(item.occurredAt)}</Td>
                  <Td>{eventText(item.eventType)}</Td>
                  <Td>{item.summary}</Td>
                  <Td>{item.actorName}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </Card>
  )
}

function Row({ label, value, pending }: { label: string; value: string; pending?: boolean }) {
  const missing = pending ?? value === NOT_AVAILABLE
  return (
    <p className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${missing ? styles.rowValuePending : ''}`}>{value}</span>
    </p>
  )
}
