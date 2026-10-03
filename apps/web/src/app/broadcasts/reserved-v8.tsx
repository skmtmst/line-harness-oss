'use client'

/*
 * ★V8 予約したあと（絵 `cdZBf`。再撮の板 `CRtK8` を外枠に付ける）。
 *
 * 予約の読み込み・取消・複製・テスト送信の中身は reserved/page.tsx が持ち、
 * ここは見せ方だけを受け取る。並びは 戻り口 → 題＋札＋1行説明 →
 * 作った5手順（全部済み・押すとその手順へ）→ 左「できた」の箱（真ん中の
 * ボタン）＋送る前の注意 → 右の欄（次にできること → スマホの見本）。
 */
import Link from 'next/link'
import { CalendarCheck2, Copy, Eye, List, Send, TriangleAlert } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import type { ApiBroadcast } from '@/lib/api'
import { messageTypeLabel } from '@/lib/broadcast-summary'
import { formatNumber } from '@/lib/format'
import { formatBroadcastDateTime } from './detail/broadcast-insight-display'
import BroadcastPhoneMock from './phone-mock-v8'
import { CREATION_STEPS } from './broadcast-display'
import styles from './detail-v8.module.css'

type AudienceEstimate = {
  audienceCount: number
  hiddenExcluded: number
  warnings: Array<{ level: 'info' | 'warning'; message: string }>
}

export interface ReservedV8Props {
  broadcast: ApiBroadcast
  /** 人数の再集計。取れないときは null（0 と混ぜない）。 */
  estimate: AudienceEstimate | null
  /** 宛先の条件の要約（一覧・詳細と同じ audienceSummary を親で作る）。 */
  audienceLabel: string
  /** 承認待ちのときの承認者名（絵 `cdZBf` の「承認：名前」）。取れなければ null。 */
  approverName: string | null
  accountName: string
  notificationText: string
  /** 閲覧のみ（夕18）：変える操作は押せない形にする。 */
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

export default function ReservedV8({
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
}: ReservedV8Props) {
  const scheduledLabel = broadcast.scheduledAt ? formatBroadcastDateTime(broadcast.scheduledAt) : '日時未設定'
  const audienceCount = estimate?.audienceCount ?? null
  const bubbleCount = broadcast.messageBubbles?.length ?? (broadcast.messageContent ? 1 : 0)
  const approverLabel = broadcast.approvalStatus === 'approved'
    ? '（承認済み）'
    : broadcast.approvalStatus === 'pending'
      ? approverName ? `（承認：${approverName}）` : '（承認待ち）'
      : ''

  return (
    <div className={styles.board} data-design-node="CRtK8">
      <Link href="/broadcasts" className="text-action inline-flex text-sm font-semibold hover:underline">
        ← 一斉配信の一覧へ
      </Link>

      <header className={styles.headerMain}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{broadcast.title}</h2>
          <span className={`${styles.statusBadge} ${styles.statusInfo}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            予約中
          </span>
        </div>
        <p className={styles.meta}>
          {scheduledLabel} に、{audienceCount === null ? '対象の友だち' : `${formatNumber(audienceCount)}人`}へ送ります。
          開始の前までは確かめる・取り消すができます。
        </p>
        {/* 作った5手順は全部済み。押すとその手順の作成画面へ戻る。 */}
        <ol className={styles.rail} aria-label="作成の手順">
          {CREATION_STEPS.map((step, index) => (
            <li key={step.key} className={`${styles.railStep} ${styles.railDone}`}>
              {index > 0 ? <span className={styles.railLine} aria-hidden="true" /> : null}
              <Link
                href={`/broadcasts/new?draft=${encodeURIComponent(broadcast.id)}&step=${step.key}`}
                className={styles.railStepLink}
              >
                <span className={styles.railMark} aria-hidden="true">✓</span>
                <span className={styles.railLabel}>{step.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </header>

      <div className={styles.split}>
        <div className={styles.main}>
          {/* 「できた」の箱。ボタンは真ん中（オーナー指摘「こういうのは真ん中」）。 */}
          <section className={styles.doneCard}>
            <div className={styles.doneHead}>
              <span className={styles.doneIcon}>
                <CalendarCheck2 size={20} aria-hidden="true" />
              </span>
              <div>
                <h3 className={styles.doneTitle}>一斉配信を予約しました</h3>
                <p className={styles.doneDesc}>送る前にもう一度、対象の人数を数え直します</p>
              </div>
            </div>
            <dl className={`${styles.sideDl} ${styles.doneTable}`}>
              <div className={styles.sideDlRow}><dt>管理名</dt><dd>{broadcast.title}</dd></div>
              <div className={styles.sideDlRow}>
                <dt>配信対象</dt>
                <dd>
                  {audienceLabel}{audienceCount === null ? '' : ` ${formatNumber(audienceCount)}人`}
                  {estimate && estimate.hiddenExcluded > 0 ? `（除く見込み ${formatNumber(estimate.hiddenExcluded)}人）` : ''}
                </dd>
              </div>
              <div className={styles.sideDlRow}><dt>送る日時</dt><dd>{scheduledLabel}</dd></div>
              <div className={styles.sideDlRow}>
                <dt>メッセージ</dt>
                <dd>{messageTypeLabel(broadcast.messageType)} {bubbleCount}通</dd>
              </div>
              <div className={styles.sideDlRow}><dt>状態</dt><dd>予約中{approverLabel}</dd></div>
            </dl>
            <div className={`${styles.softBox} mt-4 w-full text-left`}>
              <p className="text-ink-faint text-xs leading-relaxed">
                {notificationText || '配信の開始・完了・エラーは、Slack の同じスレッドへ知らせます。'}
              </p>
            </div>
            <div className={styles.doneActions}>
              <Button href="/broadcasts"><List size={16} aria-hidden="true" />一覧へ戻る</Button>
              <Button variant="primary" href={`/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}`}>
                <Eye size={16} aria-hidden="true" />予約の内容を見る
              </Button>
            </div>
          </section>

          {estimate?.warnings.length ? (
            <section className={styles.warnCard}>
              <p className="text-ink flex items-center gap-1.5 text-sm font-bold">
                <TriangleAlert size={15} className="text-warning" aria-hidden="true" />
                送る前に確かめること
              </p>
              <ul>
                {estimate.warnings.map((warning, index) => <li key={`${warning.level}-${index}`}>{warning.message}</li>)}
              </ul>
            </section>
          ) : (
            <section className={styles.warnCard}>
              <p className="text-ink flex items-center gap-1.5 text-sm font-bold">
                <TriangleAlert size={15} className="text-warning" aria-hidden="true" />
                送る前に確かめること
              </p>
              <ul>
                <li>送り始めるときに、対象の人数をもう一度数えます。</li>
              </ul>
            </section>
          )}

          {cancelled && (
            <Notice tone="success" message="予約を取り消しました。内容は下書きとして残っています。" />
          )}
        </div>

        <aside className={styles.side}>
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>次にできること</h3>
            <div className="mt-3 grid gap-2">
              <Button onClick={testSend} disabled={actionBusy !== null || !canEdit} busy={actionBusy === 'test'} busyLabel="テスト送信中…">
                <Send size={15} aria-hidden="true" />テストを送る
              </Button>
              <Button onClick={duplicate} disabled={actionBusy !== null || !canEdit} busy={actionBusy === 'duplicate'} busyLabel="複製中…">
                <Copy size={15} aria-hidden="true" />複製して別の配信を作る
              </Button>
              {broadcast.status === 'scheduled' && !cancelled && (
                <Button variant="danger" onClick={openCancel} disabled={!canEdit}>
                  予約を取り消す
                </Button>
              )}
            </div>
            {actionError ? <Notice tone="danger" message={actionError} onClose={clearActionError} className="mt-3" /> : null}
          </section>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>メッセージ</h3>
            <div className="mt-3">
              <BroadcastPhoneMock
                broadcast={broadcast}
                accountName={accountName}
                chip={broadcast.scheduledAt ? `${scheduledLabel} に届きます` : undefined}
              />
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        designNode="BeNtj"
        title={`「${broadcast.title}」の予約を取り消しますか？`}
        description={`${scheduledLabel}に送る予定の${audienceCount === null ? '対象の友だち' : `${formatNumber(audienceCount)}人`}に送らなくなります。取り消すと下書きに戻り、もう一度予約できます。承認はやり直しになります。`}
        confirmLabel="予約を取り消す"
        cancelLabel="予約のまま残す"
        primaryAction="cancel"
        destructive
        busy={cancelling}
        error={cancelError || undefined}
        onConfirm={confirmCancel}
        onCancel={closeCancel}
      >
        <dl className="text-ink-secondary space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-faint shrink-0">配信日時</dt>
            <dd className="min-w-0">{scheduledLabel}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  )
}
