'use client'

/*
 * ★V8 統合ユーザーの詳細（Pencil `Hn9eE`）。/friends?tab=merged&person=<id>（一覧の名前からも開く）。
 *
 * 読み込み・「配信に使う」の保存・解除・使う値の保存は今と同じ口（components/merged-person の useMergedPerson：
 * 版の照合・409 の読み直し）。窓（目的ごとの順位・使う値・解除の理由）も今のものを使う。
 * 見せ方：頭（← 統合ユーザーへ）→ 左に3つの段、右の列に「使う値を直す」と「使っている値」。
 * 変えられない人には、スイッチ・解除・直すのボタンを置かない（状態の文字だけ）。
 */
import { Unlink } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Toggle from '@/components/shared/toggle'
import { TextArea } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import MergedDeliveryDialog from '@/components/merged-person/merged-delivery-dialog'
import MergedProfileDialog from '@/components/merged-person/merged-profile-dialog'
import { useMergedPerson } from '@/components/merged-person/use-merged-person'
import styles from './person.module.css'

/** 9/30（日本時間）。 */
function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')}`
}

const FIELD_WORD: Record<string, string> = { メールアドレス: 'メール', 電話番号: '電話' }

export default function MergedPersonV8({ personId, onClose }: { personId: string; onClose: () => void }) {
  usePageTitle('統合ユーザーの詳細')
  const m = useMergedPerson(personId)
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)

  const head = (title: string, description: string) => (
    <header className={styles.head}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
    </header>
  )

  if (m.phase !== 'ready' || !m.person) {
    return (
      <PageFrame kind="detail" boardId="Hn9eE">
        {head('統合ユーザー', '結び付けて、同じ人として扱っている人です')}
        <div className={styles.state}>
          {m.phase === 'loading' ? <ListState kind="loading" /> : m.phase === 'forbidden' ? (
            <ListState kind="forbidden" title={m.failure?.title} description={m.failure?.description} action={<Button type="button" onClick={onClose}>一覧へ戻る</Button>} />
          ) : (
            <ListState kind="error" title={m.failure?.title} description={m.failure?.description} onRetry={m.reload} />
          )}
        </div>
      </PageFrame>
    )
  }

  const person = m.person
  const deliveryRows = person.linkedFriends.map((friend) => {
    const rows = person.deliveryPriorities.filter((p) => p.friendId === friend.friendId)
    return { friend, active: rows.length > 0 && rows.every((row) => row.isActive) }
  })
  const earliestLink = person.linkedFriends.reduce<string | null>((min, f) => (min === null || f.linkedAt < min ? f.linkedAt : min), null)

  return (
    <PageFrame kind="detail" boardId="Hn9eE">
      {head(person.primaryDisplayName, `統合ユーザー・結び付いた友だち ${person.linkedFriends.length}${earliestLink ? `・${shortDate(earliestLink)} に結び付けた` : ''}`)}

      <div className={styles.split}>
        <div className={styles.main}>
          {m.saveError ? (
            <p className={styles.error} role="alert">
              {m.saveError}
              <button type="button" className={styles.link} onClick={m.reload}>読み直す</button>
            </p>
          ) : null}

          <section className={styles.card} aria-labelledby="mp-delivery">
            <div className={styles.cardHead}>
              <div className={styles.cardTitleRow}>
                <h3 id="mp-delivery" className={styles.cardTitle}>同じ人に重なって届かないようにする</h3>
                {canManage ? (
                  <button type="button" className={styles.linkRight} onClick={() => { m.setSaveError(''); m.setEditing(true) }}>目的ごとの順位を編集 →</button>
                ) : null}
              </div>
              <p className={styles.cardSub}>どのアカウントから送るかを決めます。全部「使わない」にすると、どこからも送れなくなります</p>
            </div>
            <DataTable className={styles.table}>
              <colgroup>
                <col className={styles.colAccountWide} />
                <col className={styles.colName} />
                <col className={styles.colState} />
                <col />
              </colgroup>
              <thead>
                <TableHeadRow>
                  <Th className={styles.th}>アカウント</Th>
                  <Th className={styles.th}>表示名</Th>
                  <Th className={styles.th}>状態</Th>
                  <Th className={styles.th}>配信に使う</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {deliveryRows.map(({ friend, active }) => (
                  <Tr key={friend.friendId} className={styles.row}>
                    <Td className={styles.td}>{friend.lineAccountName}</Td>
                    <Td className={styles.td}>{friend.displayName}</Td>
                    <Td className={styles.td}><span className={friend.isFollowing ? `${styles.pill} ${styles.pillOk}` : `${styles.pill} ${styles.pillMuted}`}>{friend.isFollowing ? '友だち' : 'ブロック・削除'}</span></Td>
                    <Td className={styles.td}>
                      {canManage ? (
                        <Toggle checked={active} label={`${friend.lineAccountName} の配信に使う`} onChange={m.saving ? undefined : (next) => m.setDeliveryActive(friend.friendId, next)} />
                      ) : <span className={styles.small}>{active ? '使う' : '使わない'}</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </section>

          <section className={styles.card} aria-labelledby="mp-linked">
            <div className={styles.cardHead}>
              <h3 id="mp-linked" className={styles.cardTitle}>結び付いている友だち</h3>
              <p className={styles.cardSub}>解除すると、元の2人に戻ります。履歴は残ります</p>
            </div>
            <DataTable className={styles.table}>
              <colgroup>
                <col className={styles.colAccount} />
                <col className={styles.colName} />
                <col className={styles.colDate} />
                <col />
              </colgroup>
              <thead>
                <TableHeadRow>
                  <Th className={styles.th}>アカウント</Th>
                  <Th className={styles.th}>表示名</Th>
                  <Th className={styles.th}>結び付けた日</Th>
                  <Th className={styles.th}><span className="sr-only">解除</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {person.linkedFriends.map((friend) => (
                  <Tr key={friend.friendId} className={`${styles.row} ${styles.rowTall}`}>
                    <Td className={styles.td}>{friend.lineAccountName}</Td>
                    <Td className={styles.td}>{friend.displayName}</Td>
                    <Td className={styles.td}>{shortDate(friend.linkedAt)}</Td>
                    <Td className={styles.td}>
                      {canManage ? (
                        <button type="button" className={styles.textButton} disabled={m.saving} onClick={() => m.setUnlinkTarget(friend)}>
                          <Unlink size={14} aria-hidden="true" />
                          解除する
                        </button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </section>

          <section className={styles.card} aria-labelledby="mp-history">
            <h3 id="mp-history" className={styles.cardTitle}>すべてのアカウントを通した履歴</h3>
            {person.history.length === 0 ? (
              <p className={styles.cardSub}>まだ履歴はありません。</p>
            ) : (
              <ul className={styles.lines}>
                {person.history.map((item) => (
                  <li key={item.id} className={styles.line}>
                    <span className={styles.when}>{`${formatDateTime(item.occurredAt)} ${item.actorName}`}</span>
                    <span className={styles.what}>{item.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className={styles.rail} aria-label="使っている値">
          {canManage ? (
            <Button type="button" variant="secondary" className={styles.railButton} onClick={m.openProfileEditor} data-qa-open="Hn9eE-profile">使う値を直す</Button>
          ) : null}
          <section className={styles.valuesCard} aria-labelledby="mp-values">
            <h3 id="mp-values" className={styles.valuesTitle}>使っている値</h3>
            <ul className={styles.values}>
              <li className={styles.value}>
                <span className={styles.valueLabel}>LINE表示名</span>
                <span className={styles.valueText}>{person.primaryDisplayName}</span>
              </li>
              {person.profileValues.map((value) => (
                  <li key={value.fieldKey} className={styles.value} title={value.sourceLabel ? `元：${value.sourceLabel}` : undefined}>
                    <span className={styles.valueLabel}>{FIELD_WORD[value.fieldLabel] ?? value.fieldLabel}</span>
                    <span className={styles.valueText}>{value.valuePreview ?? '—'}</span>
                  </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <MergedDeliveryDialog
        open={m.editing}
        priorities={person.deliveryPriorities}
        revision={person.revision}
        busy={m.saving}
        error={m.saveError || undefined}
        onCancel={() => m.setEditing(false)}
        onSave={m.save}
      />
      <MergedProfileDialog
        open={m.profileEditing}
        candidates={person.profileCandidates}
        draft={m.profileDraft}
        revision={person.revision}
        busy={m.profileSaving}
        error={m.saveError || undefined}
        onChange={m.setProfileDraft}
        onCancel={() => m.setProfileEditing(false)}
        onSave={m.saveProfile}
      />
      <Dialog
        open={Boolean(m.unlinkTarget)}
        title="統合を解除"
        description="元の友だちと過去の履歴は消さず、この統合ユーザーとの結び付けだけを解除します。"
        tone="destructive"
        busy={m.unlinking}
        error={m.saveError || undefined}
        onCancel={() => m.setUnlinkTarget(null)}
        designNode="Hn9eE"
        footer={(
          <div className={styles.dialogActions}>
            <Button type="button" onClick={() => m.setUnlinkTarget(null)} disabled={m.unlinking}>キャンセル</Button>
            <Button type="button" variant="danger" onClick={m.unlink} disabled={m.unlinking || !m.unlinkReason.trim()} busy={m.unlinking} busyLabel="解除中…">結び付けを解除</Button>
          </div>
        )}
      >
        <p className={styles.small}>{`解除する友だち：${m.unlinkTarget?.displayName ?? ''}`}</p>
        <label className={styles.reasonLabel}>
          <span>解除する理由<RequiredBadge /></span>
          <TextArea value={m.unlinkReason} onChange={(event) => m.setUnlinkReason(event.target.value)} placeholder="確認した根拠を書いてください" />
        </label>
      </Dialog>
    </PageFrame>
  )
}
