'use client'

/*
 * ★V8 一斉配信を予約したあと（絵 `cdZBf`、再撮 `CRtK8`）。2026-10-06 一から書き直し。
 *
 * 白い板いっぱいに 板の頭（← 一覧へ・題＋札・1行の説明）→
 * 左（「できた」の箱：5行の内容・Slack の帯・真ん中のボタン → 送る前に確かめること）と
 * 右の欄（次にできること → メッセージのスマホ）。
 * 予約の読み込み・取消・複製・テスト送信の中身は入口（app/broadcasts/reserved/page.tsx）が持つ。
 */
import { CalendarCheck2, Copy, Eye, Info, Send, TriangleAlert } from 'lucide-react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { PageFrame } from '@/components/templates/page-frame'
import type { ApiBroadcast } from '@/lib/api'
import { messageTypeLabel } from '@/lib/broadcast-summary'
import { formatNumber } from '@/lib/format'
import BroadcastPhone from './phone'
import { CancelReservationDialog } from './detail'
import { formatBroadcastDateTime, formatShortDateTime } from './display'
import styles from './reserved.module.css'

type AudienceEstimate = {
  audienceCount: number
  hiddenExcluded: number
  warnings: Array<{ level: 'info' | 'warning'; message: string }>
}

export interface ReservedProps {
  broadcast: ApiBroadcast
  /** 人数の再集計。取れないときは null（0 と混ぜない）。 */
  estimate: AudienceEstimate | null
  /** 宛先の条件の要約（一覧・詳細と同じ audienceSummary を入口で作る）。 */
  audienceLabel: string
  /** 承認待ちのときの承認者名（「承認：名前」）。取れなければ null。 */
  approverName: string | null
  accountName: string
  notificationText: string
  /** 閲覧のみ：変える操作は置かずに隠す（2026-10-06 オーナー決定）。 */
  canEdit: boolean
  testSend: () => void
  duplicate: () => void
  actionBusy: 'test' | 'duplicate' | null
  actionError: string
  clearActionError: () => void
  /** 予約の取消の窓と実行。 */
  cancelOpen: boolean
  openCancel: () => void
  closeCancel: () => void
  confirmCancel: () => void
  cancelling: boolean
  cancelError: string
  cancelled: boolean
}

export default function Reserved({
  broadcast,
  estimate,
  audienceLabel,
  approverName,
  accountName,
  notificationText,
  canEdit,
  testSend,
  duplicate,
  actionBusy,
  actionError,
  clearActionError,
  cancelOpen,
  openCancel,
  closeCancel,
  confirmCancel,
  cancelling,
  cancelError,
  cancelled,
}: ReservedProps) {
  const scheduledLabel = broadcast.scheduledAt ? formatBroadcastDateTime(broadcast.scheduledAt) : '日時未設定'
  const audienceCount = estimate?.audienceCount ?? null
  const bubbleCount = broadcast.messageBubbles?.length ?? (broadcast.messageContent ? 1 : 0)
  const approverLabel = broadcast.approvalStatus === 'approved'
    ? '（承認済み）'
    : broadcast.approvalStatus === 'pending'
      ? approverName ? `（承認：${approverName}）` : '（承認待ち）'
      : ''
  const warnings = estimate?.warnings.length
    ? estimate.warnings.map((warning) => warning.message)
    : ['送り始めるときに、対象の人数をもう一度数えます。']
  const canCancel = canEdit && broadcast.status === 'scheduled' && !cancelled
  const shortTime = formatShortDateTime(broadcast.scheduledAt)

  return (
    <PageFrame kind="detail" boardId="cdZBf CRtK8">
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <h2 className={styles.title} title={broadcast.title}>{broadcast.title}</h2>
          <span className={styles.badge}>
            <span className={styles.dot} aria-hidden="true" />
            予約中
          </span>
        </div>
        <p className={styles.desc}>
          {`${scheduledLabel} に、${audienceCount === null ? '対象の友だち' : `${formatNumber(audienceCount)}人`}へ送ります。開始の前までは確かめる・取り消すができます。`}
        </p>
      </header>

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.done}>
            <div className={styles.doneHead}>
              <span className={styles.doneIcon}><CalendarCheck2 aria-hidden="true" /></span>
              <div className={styles.doneText}>
                <h3 className={styles.doneTitle}>一斉配信を予約しました</h3>
                <p className={styles.doneDesc}>送る前にもう一度、対象の人数を数え直します</p>
              </div>
            </div>
            <dl className={styles.rows}>
              <Row label="管理名" value={broadcast.title} />
              <Row
                label="配信対象"
                value={`${audienceLabel}${audienceCount === null ? '' : ` ${formatNumber(audienceCount)}人`}${estimate && estimate.hiddenExcluded > 0 ? `（除く見込み ${formatNumber(estimate.hiddenExcluded)}人）` : ''}`}
              />
              <Row label="送る日時" value={scheduledLabel} />
              <Row label="メッセージ" value={`${messageTypeLabel(broadcast.messageType)} ${bubbleCount}通`} />
              <Row label="状態" value={`予約中${approverLabel}`} />
            </dl>
            <p className={styles.slack}>
              <Info className={styles.slackIcon} aria-hidden="true" />
              <span>{notificationText || '配信の開始・完了・エラーは、Slack の同じスレッドへ知らせます。'}</span>
            </p>
            <div className={styles.doneButtons}>
              <Button href="/broadcasts">一覧へ戻る</Button>
              <Button variant="primary" href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`}>
                <Eye aria-hidden="true" />
                予約の内容を見る
              </Button>
            </div>
          </section>

          <section className={styles.warn}>
            <p className={styles.warnTitle}>
              <TriangleAlert className={styles.warnIcon} aria-hidden="true" />
              送る前に確かめること
            </p>
            {warnings.map((message, index) => <p key={index} className={styles.warnItem}>{`・${message}`}</p>)}
          </section>

          {cancelled ? (
            <Notice tone="success" message="予約を取り消しました。内容は下書きとして残っています。" />
          ) : null}
        </div>

        <aside className={styles.side} aria-label="次にできることとメッセージ">
          {canEdit ? (
            <>
              <h3 className={styles.secTitle}>次にできること</h3>
              <div className={styles.nextActions}>
                <Button onClick={testSend} disabled={actionBusy !== null} busy={actionBusy === 'test'} busyLabel="テスト送信中…">
                  <Send aria-hidden="true" />
                  テストを送る
                </Button>
                <Button onClick={duplicate} disabled={actionBusy !== null} busy={actionBusy === 'duplicate'} busyLabel="複製中…">
                  <Copy aria-hidden="true" />
                  複製して別の配信を作る
                </Button>
                {canCancel ? (
                  <>
                    <span className={styles.rule} aria-hidden="true" />
                    <div className={styles.cancelRow}>
                      <Button variant="text" className={styles.cancelButton} onClick={openCancel}>
                        予約を取り消す…
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
              {actionError ? <Notice tone="danger" message={actionError} onClose={clearActionError} /> : null}
            </>
          ) : null}
          <h3 className={styles.secTitle}>メッセージ</h3>
          <BroadcastPhone
            broadcast={broadcast}
            accountName={accountName}
            chip={shortTime ? `${shortTime} に届きます` : undefined}
            time={shortTime ? shortTime.slice(shortTime.indexOf('）') + 1) : '—'}
          />
        </aside>
      </div>

      <CancelReservationDialog
        open={cancelOpen}
        title={broadcast.title}
        description={broadcast.scheduledAt
          ? `${scheduledLabel} に送る予定の ${audienceCount === null ? '対象の友だち' : `${formatNumber(audienceCount)}人`} に送らなくなります。取り消すと下書きに戻り、もう一度予約できます。${broadcast.approvalStatus && broadcast.approvalStatus !== 'none' ? '承認はやり直しになります。' : ''}`
          : '予約が取り消され、この配信は送られなくなります。書いた内容は下書きとして残るので、作り直しにはなりません。'}
        busy={cancelling}
        error={cancelError}
        onConfirm={confirmCancel}
        onClose={closeCancel}
      />
    </PageFrame>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}
