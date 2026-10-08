'use client'

/*
 * 概要タブ（JCDRm・Q5F2QE の 1.）。左に要点 320px、右に数の帯・進行中・同じ人・最近の履歴・行う操作。
 */
import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Link2,
  List,
  MailOpen,
  MessageCircle,
  ShoppingBag,
  Tag as TagIcon,
  Workflow,
} from 'lucide-react'
import type { FriendField } from '@line-crm/shared'
import Button from '@/components/shared/button'
import TagPill from '@/components/shared/tag-pill'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import { formatDay, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import type { FriendDetail } from '@/lib/api'
import type { FriendDetailState } from './use-friend-detail'
import type { FriendDetailPermissions } from './permissions'
import { inboxHrefForFriend, timelineSourceHref, timelineTypeLabel, timelineKey, type FriendTimelineItem } from './timeline'
import { SUPPORT_LABELS } from './support'
import styles from './detail.module.css'

function GroupHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className={styles.groupHead}>
      <p className={styles.groupTitle}>{title}</p>
      {action}
    </div>
  )
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.kv}>
      <dt>{label}</dt>
      <dd title={typeof children === 'string' ? children : undefined}>{children}</dd>
    </div>
  )
}

/** 最近の履歴の印。種類ごとに決まった形。 */
function recentIcon(type: string) {
  if (type === 'message_received' || type === 'message_sent') return <MessageCircle size={12} aria-hidden />
  if (type === 'tag_change') return <TagIcon size={12} aria-hidden />
  if (type === 'ec_order') return <ShoppingBag size={12} aria-hidden />
  if (type.includes('booking')) return <CalendarDays size={12} aria-hidden />
  if (type.startsWith('scenario')) return <Workflow size={12} aria-hidden />
  return <MailOpen size={12} aria-hidden />
}

/** 最後のやりとり。履歴の中のいちばん新しいメッセージの時刻（無ければ —）。 */
export function lastContactText(items: FriendTimelineItem[]) {
  const latest = items.find((item) => item.type === 'message_received' || item.type === 'message_sent')
  return latest ? formatRelative(latest.occurredAt) : '—'
}

export default function OverviewTab({
  friend,
  friendId,
  data,
  perms,
  fields,
  values,
  realName,
  onEditSupport,
  onEnrollScenario,
  scenarioNotice,
}: {
  friend: FriendDetail
  friendId: string
  data: FriendDetailState
  perms: FriendDetailPermissions
  fields: FriendField[]
  values: Record<string, string>
  realName: string
  onEditSupport: () => void
  onEnrollScenario: () => void
  scenarioNotice: string
}) {
  const [expanded, setExpanded] = useState(false)
  const inbox = inboxHrefForFriend(friendId)
  const starred = fields.filter((f) => f.isStarred)
  const { upcoming, upcomingStatus, mileage, mileageStatus, mileageInsights, mileageConnections, richMenu, richMenuStatus } = data
  const support = friend.support
  const nextDelivery = upcoming?.nextAutoDelivery ?? null
  const deliveryFailed = upcomingStatus === 'error' || !!upcoming?.nextAutoDeliveryError
  const bookingFailed = upcomingStatus === 'error' || !!upcoming?.nextBookingError
  const history = data.historyItems.slice(0, 3)

  return (
    <div className={styles.overview}>
      {/* 左：要点（顧客情報 → 対応 → タグ → マイル → リッチメニュー → メモ → すべて表示） */}
      <aside className={styles.summary} data-design="Left" data-friend-profile-panel>
        <section className={styles.group} aria-label="顧客情報">
          <GroupHead
            title="顧客情報"
            action={perms.saveFields ? <Link className={styles.groupLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}>編集</Link> : null}
          />
          <dl className={styles.kvList}>
            <Kv label="本名">{realName || <span className={styles.faint}>未登録</span>}</Kv>
            <Kv label="システム表示名">{friend.displayName || <span className={styles.faint}>未登録</span>}</Kv>
          </dl>
        </section>

        <section className={styles.group} aria-label="対応">
          <GroupHead
            title="対応"
            action={perms.editSupport ? <button type="button" className={styles.groupLink} onClick={onEditSupport}>編集</button> : null}
          />
          <dl className={styles.kvList}>
            <Kv label="状況">{support ? SUPPORT_LABELS[support.status] : <span className={styles.faint}>やり取りなし</span>}</Kv>
            <Kv label="担当">{support?.operatorName ?? <span className={styles.faint}>未割り当て</span>}</Kv>
            <Kv label="最後のやりとり">{data.historyStatus === 'ready' ? lastContactText(data.historyItems) : '—'}</Kv>
          </dl>
        </section>

        <section className={styles.group} aria-label="タグ">
          {/* タグの付け外しは受信箱の友だち欄が持つ（今と同じ）。 */}
          <GroupHead title="タグ" action={perms.editSupport ? <Link className={styles.groupLink} href={inbox}>編集</Link> : null} />
          <div className={styles.tags}>
            {friend.tags?.length
              ? friend.tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} />)
              : <span className={`${styles.memo} ${styles.faint}`}>タグはありません</span>}
            {perms.editSupport ? <Link className={`${styles.tag} ${styles.tagAdd}`} href={inbox}>＋ 追加</Link> : null}
          </div>
        </section>

        <section className={styles.group} aria-label="マイル">
          <GroupHead title="マイル" action={<Link className={styles.groupLink} href={`/mileage/friends/detail?id=${encodeURIComponent(friendId)}`}>詳細を見る</Link>} />
          {mileageStatus === 'error' ? (
            <p className={`${styles.memo} ${styles.faint}`}>
              マイルを読み込めませんでした
              <button type="button" className={styles.retry} onClick={() => void data.loadMileage()}>もう一度試す</button>
            </p>
          ) : (
            <div className={styles.mile}>
              <span className={styles.mileNum}>{mileageStatus === 'ready' && mileage ? formatNumber(mileage.available) : '—'}</span>
              <span className={styles.mileUnit}>
                mile 使える{mileage && mileage.pending > 0 ? `・確定待ち ${formatNumber(mileage.pending)}` : ''}
              </span>
            </div>
          )}
        </section>

        <section className={styles.group} aria-label="リッチメニュー">
          <GroupHead title="リッチメニュー" action={perms.manage ? <Link className={styles.groupLink} href="/rich-menus">変更</Link> : null} />
          {richMenuStatus === 'error' ? (
            <p className={`${styles.memo} ${styles.faint}`}>
              読み込めませんでした
              <button type="button" className={styles.retry} onClick={() => void data.loadRichMenu()}>もう一度試す</button>
            </p>
          ) : (
            <p className={styles.value} title={richMenu?.name ?? undefined}>
              {richMenuStatus === 'ready'
                ? <>{richMenu?.name ?? '既定のメニュー'}{richMenu?.isDefault ? <span className={styles.faint}>（全員に出しているもの）</span> : null}</>
                : '—'}
            </p>
          )}
        </section>

        <section className={styles.group} aria-label="メモ">
          {/* 個別メモの書き換えは受信箱側が持っている。ここは読むだけ。 */}
          <GroupHead title="メモ" action={perms.editSupport ? <Link className={styles.groupLink} href={inbox}>編集</Link> : null} />
          <p className={`${styles.memo} ${support?.notes ? '' : styles.faint}`}>{support?.notes || 'メモはありません'}</p>
        </section>

        <Button className={styles.full} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <List aria-hidden />
          {expanded ? '顧客情報を閉じる' : '顧客情報をすべて表示'}
        </Button>

        {expanded ? (
          <div className={styles.more}>
            {starred.length > 0 ? (
              <section className={styles.group} aria-label="★つき友だち情報">
                <GroupHead title="★つき友だち情報" action={<Link className={styles.groupLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`}>すべて見る</Link>} />
                <dl className={styles.kvList}>
                  {starred.map((f) => <Kv key={f.id} label={f.name}>{values[f.id] || <span className={styles.faint}>未入力</span>}</Kv>)}
                </dl>
              </section>
            ) : null}
            {data.fieldsStatus === 'error' ? (
              <p className={`${styles.memo} ${styles.faint}`}>
                情報欄を読み込めませんでした
                <button type="button" className={styles.retry} onClick={() => void data.loadFields()}>もう一度試す</button>
              </p>
            ) : null}
            <section className={styles.group} aria-label="友だち情報">
              <GroupHead title="友だち情報" />
              <dl className={styles.kvList}>
                <Kv label="追加日">{friend.createdAt ? formatDay(friend.createdAt) : '—'}</Kv>
                <Kv label="流入元">{friend.firstTrackedLinkName ?? '不明'}</Kv>
              </dl>
            </section>
            <section className={styles.group} aria-label="フォーム回答">
              <GroupHead title="フォーム回答" action={<Link className={styles.groupLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=forms`}>すべて見る</Link>} />
              <p className={styles.value}>
                {typeof friend.formSubmissionTotal === 'number'
                  ? friend.formSubmissionTotal > 0 ? `${friend.formSubmissionTotal}件` : '回答はまだありません'
                  : friend.formSubmissions?.length ? `${friend.formSubmissions.length}件` : '回答はまだありません'}
              </p>
            </section>
          </div>
        ) : null}
      </aside>

      {/* 右：概要 */}
      <div className={styles.content} data-design="Right">
        <KpiBand className={styles.kpis} gridClassName="grid grid-cols-3">
          <KpiCard
            presentation="band"
            density="compact"
            title="配信を開いた率"
            icon={<MailOpen size={13} aria-hidden />}
            value={null}
            unit="%"
            detail=""
            help="この友だちの開封率を数える口はまだありません。数が出るまで「—」です。"
          />
          <KpiCard
            presentation="band"
            density="compact"
            title="この90日の購入"
            icon={<ShoppingBag size={13} aria-hidden />}
            value={null}
            unit="回"
            detail=""
            help="この友だちの90日間の購入回数を数える口はまだありません。数が出るまで「—」です。"
          />
          <KpiCard
            presentation="band"
            density="compact"
            title="次の予約"
            icon={<CalendarDays size={13} aria-hidden />}
            value={null}
            unit=""
            loading={upcomingStatus === 'loading' || upcomingStatus === 'idle'}
            valueText={upcoming?.nextBooking && !upcoming.nextBookingError ? formatDay(upcoming.nextBooking.startsAt).replace(/（.）$/, '') : undefined}
            detail={bookingFailed ? '読み込めませんでした' : upcoming && !upcoming.nextBooking ? '予定なし' : ''}
            onRetry={bookingFailed ? () => void data.loadUpcoming() : undefined}
          />
        </KpiBand>

        <section className={styles.section} aria-labelledby="fdt-running">
          <div className={styles.secHead}>
            <h2 id="fdt-running" className={styles.secTitle}>進行中の配信・自動処理</h2>
            <Link className={styles.secLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=scenario`}>すべてを見る<ArrowRight size={12} aria-hidden /></Link>
          </div>
          {upcomingStatus === 'loading' || upcomingStatus === 'idle' ? (
            <p className={styles.secNote}>読み込んでいます…</p>
          ) : deliveryFailed ? (
            <p className={styles.secNote} role="alert">
              配信予定を読み込めませんでした
              <button type="button" className={styles.retry} onClick={() => void data.loadUpcoming()}>もう一度試す</button>
            </p>
          ) : nextDelivery ? (
            <Link
              className={styles.row}
              href={nextDelivery.kind === 'scenario' ? `/scenarios/detail?id=${encodeURIComponent(nextDelivery.id)}` : `/reminders/detail?id=${encodeURIComponent(nextDelivery.id)}`}
            >
              <span className={styles.rowIcon}>{nextDelivery.kind === 'scenario' ? <Workflow size={17} aria-hidden /> : <Bell size={17} aria-hidden />}</span>
              <span className={styles.rowBody}>
                <span className={styles.rowTop}>
                  <span className={styles.rowTitle} title={nextDelivery.name}>{nextDelivery.name}</span>
                  <span className={styles.rowSub}>{`${formatDateTime(nextDelivery.scheduledAt)} に送信予定`}</span>
                </span>
                {/* 進み具合（何通目まで）は口がまだ無い。棒の場所だけ取って、行の高さを絵にそろえる。 */}
                <span className={styles.barSpace} aria-hidden />
              </span>
            </Link>
          ) : (
            <p className={styles.secNote}>確定した配信予定はありません</p>
          )}
          {upcomingStatus === 'ready' && !deliveryFailed ? (
            // 今の口は「いちばん近い1件」だけを返す。ほかがあるかは分からないことを、行の形で正直に出す。
            <div className={`${styles.row} ${styles.rowMuted}`}>
              <span className={styles.rowIcon}><List size={17} aria-hidden /></span>
              <span className={styles.rowBody}>
                <span className={styles.rowTop}>
                  <span className={styles.rowTitle}>ほかの進行中の配信・リマインダ</span>
                  <span className={styles.rowSub}>一覧はまだ見られません</span>
                </span>
                <span className={styles.barSpace} aria-hidden />
              </span>
            </div>
          ) : null}
        </section>

        <div className={styles.same}>
          <span className={styles.rowIcon}><Link2 size={17} aria-hidden /></span>
          <div className={styles.sameBody}>
            <p className={styles.sameTitle}>同じ人としてつながる情報</p>
            {/* NEXT-10: 名寄せの実績（マイル口の応答の統合情報）から出す。 */}
            <p className={styles.sameSub}>
              {mileageStatus === 'loading' || mileageStatus === 'idle'
                ? 'つながり情報を読み込んでいます…'
                : mileageStatus === 'error'
                  ? <>つながり情報を読み込めませんでした<button type="button" className={styles.retry} onClick={() => void data.loadMileage()}>もう一度試す</button></>
                  : mileageInsights && mileageInsights.accountCount > 1
                    ? `${mileageInsights.accountCount}件のLINEアカウントで同じ人としてつながっています${mileageConnections.length ? `（${mileageConnections.map((c) => c.accountName).join('・')}）` : ''}。重複候補が見つかると、根拠と確信度を表示します。`
                    : 'このアカウントのみに登録があります。重複候補が見つかると、根拠と確信度を表示します。'}
            </p>
          </div>
          <Button href="/duplicates">重複候補を確認</Button>
        </div>

        <section className={`${styles.section} ${styles.recent}`} aria-labelledby="fdt-recent">
          <div className={styles.secHead}>
            <h2 id="fdt-recent" className={styles.secTitle}>最近の履歴</h2>
            <Link className={styles.secLink} href={`/friends/detail?id=${encodeURIComponent(friendId)}&tab=history`}>すべて見る<ArrowRight size={12} aria-hidden /></Link>
          </div>
          {data.historyStatus === 'loading' || data.historyStatus === 'idle' ? (
            <p className={styles.secNote}>履歴を読み込んでいます…</p>
          ) : data.historyStatus === 'error' ? (
            <p className={styles.secNote}>
              履歴を読み込めませんでした
              <button type="button" className={styles.retry} onClick={() => void data.loadHistory()}>もう一度試す</button>
            </p>
          ) : (
            <div className={styles.recentList}>
              {history.map((item, index) => {
                const src = timelineSourceHref(item, friendId)
                return (
                  <div key={timelineKey(item)} className={styles.recentItem}>
                    <span className={styles.recentLine}>
                      <span className={styles.dot}>{recentIcon(item.type)}</span>
                      {index < history.length - 1 ? <span className={styles.vline} /> : null}
                    </span>
                    <span className={styles.recentText}>
                      {src
                        ? <a className={styles.recentTitle} href={src.href} target={src.external ? '_blank' : undefined} rel="noreferrer" title={item.summary}>{item.summary}</a>
                        : <span className={styles.recentTitle} title={item.summary}>{item.summary}</span>}
                      <span className={styles.recentSub}>{[timelineTypeLabel(item.type), item.lineAccount?.name].filter(Boolean).join('・')}</span>
                    </span>
                    <span className={styles.time}>{formatRelative(item.occurredAt)}</span>
                  </div>
                )
              })}
              {history.length === 0 ? (
                <div className={styles.recentItem}>
                  <span className={styles.recentLine}><span className={styles.dot}><MailOpen size={12} aria-hidden /></span></span>
                  <span className={styles.recentText}>
                    <span className={styles.recentTitle}>友だちに追加されました</span>
                    <span className={styles.recentSub}>{friend.firstTrackedLinkName ?? 'システム'}・ほかの活動履歴はまだありません</span>
                  </span>
                  <span className={styles.time}>{friend.createdAt ? formatDay(friend.createdAt) : '—'}</span>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <div className={styles.ops}>
          <p className={styles.opsTitle}>この友だちに行う操作</p>
          {/* POST /api/scenarios/:id/enroll/:friendId はオーナー・管理者専用。権限が無い人には置かない。 */}
          {perms.manage ? <Button onClick={onEnrollScenario}><Workflow aria-hidden />シナリオに登録する</Button> : null}
          <span className={styles.opsNote}>テンプレートは受信箱で選んで送る</span>
        </div>
        {scenarioNotice ? <p className={styles.success} role="status">{scenarioNotice}</p> : null}
      </div>
    </div>
  )
}
