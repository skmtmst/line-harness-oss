'use client'

/*
 * ★V8 一斉配信の詳細（絵 `cgiGB` 下書き・`pNiUk` 承認待ち・`F3X1Mo` 送信済み。
 * 再撮の板 `dK1aE`（下書き）・`wfHIE`（承認待ち）・`tPm3e`（送った後）は同じ画面の状態として外枠に付ける）。
 *
 * v7 の詳細（detail/page.tsx）とは置き場が違うだけで、読む口・操作の中身は
 * 同じものを受け取る。並びは 見出し（題＋札＋1行説明＋操作）→ 進みの帯
 * → タブ → 左の本文／右の欄（配信した設定 → スマホの見本、380px）。
 * 下書きの進みの帯は「作るときの5手順」、それ以外は「送るまでの6段階」。
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Copy, Download, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import {
  api,
  type ApiBroadcast,
  type BroadcastApprovalCandidate,
  type BroadcastApprovalState,
  type BroadcastInsight,
} from '@/lib/api'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Progress from '@/components/shared/progress'
import { Tabs } from '@/components/shared/tabs'
import {
  ApprovalRequestFields,
  ApprovalStatusSection,
  ApproverSection,
  formatApprovalDateTime,
} from '@/components/broadcasts/broadcast-approval'
import { messageTypeLabel } from '@/lib/broadcast-summary'
import { formatNumber } from '@/lib/format'
import { formatBroadcastDateTime } from './detail/broadcast-insight-display'
import BroadcastRecipients from './detail/broadcast-recipients'
import BroadcastActivity from './detail/broadcast-activity'
import { isApprovalInvolved } from './detail/broadcast-status-rail'
import BroadcastPhoneMock from './phone-mock-v8'
import {
  CREATION_STEPS,
  chaseHref,
  displayStatusOf,
  rateText,
} from './broadcast-display'
import styles from './detail-v8.module.css'

/** 送るまでの6段階。承認が絡まない・予約しない配信はその段を省く。 */
const DELIVERY_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'draft', label: '下書き' },
  { key: 'pending_approval', label: '承認待ち' },
  { key: 'scheduled', label: '予約済み' },
  { key: 'preparing', label: '送信準備' },
  { key: 'sending', label: '送信中' },
  { key: 'sent', label: '送信済み' },
]

const BRANCH_LABELS: Record<string, string> = {
  partial_failed: '一部失敗',
  failed: '失敗',
  stopped: '停止',
  expired: '期限切れ',
}

const BADGE_TONE: Record<string, string> = {
  draft: '',
  pending_approval: styles.statusWarning,
  scheduled: styles.statusInfo,
  preparing: styles.statusInfo,
  sending: styles.statusWarning,
  sent: styles.statusSuccess,
  partial_failed: styles.statusWarning,
  failed: styles.statusDanger,
  stopped: '',
  expired: '',
}

type TabKey = 'overview' | 'recipients' | 'activity'

export interface BroadcastDetailV8Props {
  broadcast: ApiBroadcast
  /** LINE側の集計。まだ無い・取れないは「—」で出す（0 と混ぜない）。 */
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  /** 宛先の条件の要約（一覧と同じ audienceSummary を親で作って渡す）。 */
  audienceLabel: string
  /** スマホ見本の部屋の名。 */
  accountName: string
  tab: TabKey
  onSelectTab: (tab: TabKey) => void
  onExportCsv: () => void
  /** 集計の取り直し・状態の読み直し（reloadToken を進める）。 */
  onReload: () => void
  /**
   * ★V8 `Q28Gb`：ほかの人が更新したときだけ true。この画面は書き換えず、
   * 帯で知らせて読み直しだけ受け付ける。名前・時刻は API に無いので出さない。
   */
  conflict?: boolean
  onConflictReload?: () => void
  /** 閲覧のみ（夕18）：変える操作は押せない形にする。 */
  canEdit: boolean
  contentRef: React.RefObject<HTMLElement | null>
  approval: {
    state: BroadcastApprovalState | null
    busy: boolean
    message: string | null
    requesterName: string | null
    approverName: string | null
    candidates: BroadcastApprovalCandidate[]
    messageSummary: string | null
    canReRequest: boolean
    reApproverId: string
    reApprovalNote: string
    onApproverChange: (id: string) => void
    onNoteChange: (note: string) => void
    onRequest: () => void
    onCancel: () => void
    onRemind: () => void
    onReject: (reason: string) => void
    onApprove: () => void
  }
}

export default function BroadcastDetailV8({
  broadcast,
  insight,
  insightState,
  audienceLabel,
  accountName,
  tab,
  onSelectTab,
  onExportCsv,
  onReload,
  canEdit,
  contentRef,
  approval,
  conflict = false,
  onConflictReload,
}: BroadcastDetailV8Props) {
  const router = useRouter()
  const { status: displayStatus, label: statusLabel } = displayStatusOf(broadcast)
  const isDraft = broadcast.status === 'draft'
  const isSent = broadcast.status === 'sent'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const editHref = `/broadcasts/new?draft=${encodeURIComponent(broadcast.id)}`
  const duplicateHref = `/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcast.id)}`

  /* 下書きの現在地＝ `draft_step`（止まった手順）。なければ1つ目。 */
  const draftStepIndex = Math.max(0, CREATION_STEPS.findIndex((step) => step.key === broadcast.draftStep))
  const resumeStep = CREATION_STEPS[draftStepIndex]

  const deleteBroadcast = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.broadcasts.delete(broadcast.id)
      if (!res.success) throw new Error(res.error)
      router.push('/broadcasts')
    } catch {
      setDeleteError('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  /* 予約の取り消し。中身は下書きとして残る（予約完了画面と同じ決まり）。 */
  const cancelReservation = async () => {
    if (cancelling) return
    setCancelling(true)
    setCancelError('')
    try {
      const res = await api.broadcasts.cancelReservation(broadcast.id)
      if (!res.success) throw new Error(res.error)
      setCancelOpen(false)
      onReload()
    } catch {
      setCancelError('予約を取り消せませんでした。すでに送信が始まっているかもしれません。状態を読み直してから、もう一度お試しください。')
    } finally {
      setCancelling(false)
    }
  }

  const readonlyReason = '閲覧のみのため変更できません'
  const menuItems: ActionMenuItem[] = [
    {
      id: 'duplicate',
      label: '複製して作る',
      icon: <Copy size={14} aria-hidden="true" />,
      external: true,
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => router.push(duplicateHref),
    },
  ]
  if (broadcast.status === 'scheduled') {
    menuItems.push({
      id: 'cancel-reservation',
      label: '予約を取り消す',
      disabled: !canEdit,
      disabledReason: canEdit ? undefined : readonlyReason,
      onSelect: () => { setCancelError(''); setCancelOpen(true) },
    })
  }
  menuItems.push({
    id: 'delete',
    label: '削除する',
    tone: 'danger',
    icon: <Trash2 size={14} aria-hidden="true" />,
    dividerBefore: true,
    disabled: !canEdit,
    disabledReason: canEdit ? undefined : readonlyReason,
    onSelect: () => { setDeleteError(''); setDeleteOpen(true) },
  })

  const meta = metaLine(broadcast, audienceLabel)
  const delivered = insight?.delivered ?? broadcast.successCount
  const opened = insight?.opens?.count ?? insight?.uniqueImpression ?? null
  const openRate = insight?.opens?.rate ?? insight?.openRate ?? null
  const failedCount = Math.max(0, broadcast.totalCount - broadcast.successCount)
  const bubbleCount = broadcast.messageBubbles?.length ?? (broadcast.messageContent ? 1 : 0)

  return (
    <div className={styles.board} data-design-node="dK1aE wfHIE tPm3e">
      {/* 見出し：題＋状態の札＋1行の説明＋進みの帯。右に操作。 */}
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{broadcast.title}</h2>
            <span className={`${styles.statusBadge} ${BADGE_TONE[displayStatus] ?? ''}`}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <p className={styles.meta}>{meta}</p>
          {isDraft
            ? <DraftStepRail broadcastId={broadcast.id} draftStep={broadcast.draftStep} />
            : <DeliveryRail broadcast={broadcast} approval={approval.state} />}
        </div>
        <div className={styles.headerActions}>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-label={`配信「${broadcast.title}」の操作`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          <ActionMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            ariaLabel={`配信「${broadcast.title}」の操作`}
            items={menuItems}
            anchorRef={menuButtonRef}
          />
          {/* CSVは送った配信だけ（v7 と同じ出し分け）。下書き・予約には出さない。 */}
          {isSent && (
            <Button size="field" onClick={onExportCsv}>
              <Download size={14} aria-hidden="true" />
              CSVで書き出す
            </Button>
          )}
          {isDraft && (
            <Button size="field" variant="primary" onClick={() => router.push(`${editHref}&step=${resumeStep.key}`)} disabled={!canEdit}>
              {resumeStep.order} {resumeStep.label}から続ける
            </Button>
          )}
          {(displayStatus === 'pending_approval' || broadcast.status === 'scheduled') && (
            <Button size="field" onClick={() => router.push(editHref)} disabled={!canEdit}>
              編集を続ける
            </Button>
          )}
          {isSent && (
            <Button size="field" variant="primary" onClick={() => router.push(duplicateHref)} disabled={!canEdit}>
              <Copy size={14} aria-hidden="true" />
              複製して作る
            </Button>
          )}
        </div>
      </header>

      {conflict && (
        <div className={styles.conflictBar} data-design-node="Q28Gb" role="alert">
          <div>
            <p className={styles.conflictTitle}>ほかの人がこの配信を更新しました</p>
            <p className={styles.conflictBody}>
              この画面は古い内容です。読み直すと最新の設定と見本が出ます（この画面では書き換えません）。
            </p>
          </div>
          <Button size="field" variant="primary" onClick={onConflictReload}>
            <RefreshCw size={14} aria-hidden="true" />
            読み直す
          </Button>
        </div>
      )}

      <Tabs
        label="配信の詳細"
        items={[
          { label: '概要', current: tab === 'overview', onClick: () => onSelectTab('overview') },
          { label: '宛先', count: broadcast.totalCount, current: tab === 'recipients', onClick: () => onSelectTab('recipients') },
          { label: '記録', current: tab === 'activity', onClick: () => onSelectTab('activity') },
        ]}
      />

      <div className={styles.split}>
        <div className={styles.main}>
          {tab === 'recipients' ? (
            <BroadcastRecipients broadcastId={broadcast.id} total={broadcast.totalCount} version={broadcast.version ?? 1} />
          ) : tab === 'activity' ? (
            <BroadcastActivity broadcastId={broadcast.id} formatDateTime={formatBroadcastDateTime} />
          ) : (
            <Overview
              broadcast={broadcast}
              insight={insight}
              insightState={insightState}
              delivered={delivered}
              opened={opened}
              openRate={openRate}
              failedCount={failedCount}
              approval={approval}
              canEdit={canEdit}
              onReload={onReload}
              onChase={() => router.push(chaseHref(broadcast.id))}
            />
          )}
        </div>

        <aside className={styles.side}>
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>配信した設定</h3>
            <dl className={`${styles.sideDl} mt-3`}>
              <SideRow label="対象" value={`${audienceLabel} ${formatNumber(broadcast.totalCount)}人`} />
              <SideRow
                label={isSent ? '送った日時' : '送る日時'}
                value={
                  isSent
                    ? formatBroadcastDateTime(broadcast.sentAt)
                    : broadcast.scheduledAt
                      ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送る予定`
                      : '未定（すぐに送る）'
                }
              />
              <SideRow label="送り方" value={broadcast.scheduledAt ? '予約して送る' : 'すぐに全員へ（分けて送らない）'} />
              <SideRow label="メッセージ" value={`${messageTypeLabel(broadcast.messageType)} ${bubbleCount}通`} />
              <SideRow
                label="承認"
                value={
                  approval.state == null
                    ? (approval.requesterName ? '—' : '要らない')
                    : approval.state.approval.status === 'pending'
                      ? `${approval.approverName ?? '担当者'}さんの承認待ち`
                      : approval.state.approval.status === 'approved'
                        ? `${approval.approverName ?? '担当者'}（承認済み）`
                        : '要らない'
                }
              />
              <SideRow
                label="作成者"
                value={broadcast.createdAt ? `${formatBroadcastDateTime(broadcast.createdAt)} 作成` : '記録していません'}
              />
            </dl>
          </section>

          <section className={styles.card} id="broadcast-phone">
            <h3 className={styles.cardTitle}>メッセージ</h3>
            <div className="mt-3" ref={contentRef as React.RefObject<HTMLDivElement>}>
              <BroadcastPhoneMock
                broadcast={broadcast}
                accountName={accountName}
                chip={
                  isDraft
                    ? '送る前の見本'
                    : broadcast.status === 'scheduled'
                      ? (broadcast.scheduledAt ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に届く予定` : '届く予定')
                      : isSent && broadcast.sentAt
                        ? formatBroadcastDateTime(broadcast.sentAt)
                        : undefined
                }
              />
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={`「${broadcast.title}」を削除しますか？`}
        description="削除すると配信設定と確認画面から消えます。予約中の配信は中止され、この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError || undefined}
        onConfirm={() => void deleteBroadcast()}
        onCancel={() => { if (!deleting) setDeleteOpen(false) }}
      />
      <ConfirmDialog
        open={cancelOpen}
        designNode="BeNtj"
        title={`「${broadcast.title}」の予約を取り消しますか？`}
        description={broadcast.scheduledAt
          ? `${formatBroadcastDateTime(broadcast.scheduledAt)}に送る予定の${formatNumber(broadcast.totalCount)}人に送らなくなります。取り消すと下書きに戻り、もう一度予約できます。承認はやり直しになります。`
          : '予約が取り消され、この配信は送られなくなります。書いた内容は下書きとして残るので、作り直しにはなりません。送信が始まったあとは取り消せません。'}
        confirmLabel="予約を取り消す"
        cancelLabel="予約のまま残す"
        primaryAction="cancel"
        destructive
        busy={cancelling}
        error={cancelError || undefined}
        onConfirm={() => void cancelReservation()}
        onCancel={() => { if (!cancelling) setCancelOpen(false) }}
      />
    </div>
  )
}

/** 見出しの下の1行：種類・対象・送る/送った日時。 */
function metaLine(broadcast: ApiBroadcast, audienceLabel: string): string {
  const kind = messageTypeLabel(broadcast.messageType)
  const audience = broadcast.status === 'sent'
    ? audienceLabel
    : `${audienceLabel}（${formatNumber(broadcast.totalCount)}人）`
  const when = broadcast.status === 'sent'
    ? (broadcast.sentAt ? `${formatBroadcastDateTime(broadcast.sentAt)} に送信` : '送信済み')
    : broadcast.status === 'sending'
      ? 'いま送っています'
      : broadcast.scheduledAt
        ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送る予定`
        : 'まだ送っていません'
  return `${kind} ・ ${audience} ・ ${when}`
}

/**
 * 下書きの進みの帯：作るときの5手順（`draft_step` で現在地）。
 * 済んだ手順を押すとその手順の作成画面へ戻る（絵 `cgiGB`）。
 */
function DraftStepRail({ broadcastId, draftStep }: { broadcastId: string; draftStep: string | null | undefined }) {
  const currentIndex = Math.max(0, CREATION_STEPS.findIndex((step) => step.key === draftStep))
  return (
    <ol className={styles.rail} aria-label="作成の進み">
      {CREATION_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        const href = `/broadcasts/new?draft=${encodeURIComponent(broadcastId)}&step=${step.key}`
        return (
          <li key={step.key} className={`${styles.railStep} ${state === 'done' ? styles.railDone : state === 'current' ? styles.railCurrent : ''}`}>
            {index > 0 ? <span className={styles.railLine} aria-hidden="true" /> : null}
            {state === 'done' ? (
              <Link href={href} className={styles.railStepLink}>
                <span className={styles.railMark} aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                <span className={styles.railLabel}>{step.order} {step.label}</span>
              </Link>
            ) : (
              <>
                <span className={styles.railMark} aria-hidden="true">{state === 'current' ? '' : step.order}</span>
                <span className={styles.railLabel} aria-current={state === 'current' ? 'step' : undefined}>{step.order} {step.label}</span>
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 送るまでの6段階（絵 `F3X1Mo`・`pNiUk`）。承認が絡まない・予約しない
 * 配信はその段を省く。分かれ道（失敗・停止・期限切れ）は札で添える。
 */
function DeliveryRail({ broadcast, approval }: { broadcast: ApiBroadcast; approval: BroadcastApprovalState | null }) {
  const { status: displayStatus } = displayStatusOf(broadcast)
  const approvalInvolved = isApprovalInvolved(broadcast.approvalStatus, approval)
  const scheduled = broadcast.status === 'scheduled' || broadcast.scheduledAt != null
  const steps = DELIVERY_STEPS.filter((step) => {
    if (step.key === 'pending_approval') return approvalInvolved
    if (step.key === 'scheduled') return scheduled
    return true
  })
  const progressKey = displayStatus === 'partial_failed' || displayStatus === 'failed' ? 'sent'
    : displayStatus === 'stopped' ? 'sending'
    : displayStatus === 'expired' ? (approvalInvolved ? 'pending_approval' : 'draft')
    : displayStatus
  const currentIndex = Math.max(0, steps.findIndex((step) => step.key === progressKey))
  const branchLabel = BRANCH_LABELS[displayStatus]

  return (
    <ol className={styles.rail} aria-label="配信の状態">
      {/*
        終わった状態でも「いまの段」は輪のまま（絵 F3X1Mo：送信済みは
        最後の段が ✓ ではなく今いる場所の印）。
      */}
      {steps.map((step, index) => {
        const done = index < currentIndex
        const current = index === currentIndex
        return (
          <li key={step.key} className={`${styles.railStep} ${done ? styles.railDone : current ? styles.railCurrent : ''}`}>
            {index > 0 ? <span className={styles.railLine} aria-hidden="true" /> : null}
            <span className={styles.railMark} aria-hidden="true">{done ? <Check size={11} strokeWidth={3} /> : null}</span>
            <span className={styles.railLabel} aria-current={current ? 'step' : undefined}>{step.label}</span>
          </li>
        )
      })}
      {branchLabel ? (
        <li className={`${styles.railStep} ${displayStatus === 'failed' ? styles.statusDanger : ''}`}>
          <span className={styles.railLine} aria-hidden="true" />
          <span className={`${styles.statusBadge} ${BADGE_TONE[displayStatus] ?? ''}`}>{branchLabel}</span>
        </li>
      ) : null}
    </ol>
  )
}

/** 概要タブの本文（左の列）。状態ごとに見せる段を変える。 */
function Overview({
  broadcast,
  insight,
  insightState,
  delivered,
  opened,
  openRate,
  failedCount,
  approval,
  canEdit,
  onReload,
  onChase,
}: {
  broadcast: ApiBroadcast
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  delivered: number
  opened: number | null
  openRate: number | null
  failedCount: number
  approval: BroadcastDetailV8Props['approval']
  canEdit: boolean
  onReload: () => void
  onChase: () => void
}) {
  const total = broadcast.totalCount
  const isSent = broadcast.status === 'sent'
  const scheduledLabel = broadcast.scheduledAt ? formatApprovalDateTime(broadcast.scheduledAt) : null

  return (
    <>
      {/* 下書き：止まっている手順から開ける案内（絵 `cgiGB` の知らせ）。 */}
      {broadcast.status === 'draft' ? (() => {
        const stoppedStep = CREATION_STEPS[Math.max(0, CREATION_STEPS.findIndex((s) => s.key === broadcast.draftStep))]
        return (
          <section className={styles.card}>
            <p className={styles.cardTitle}>まだ送っていません</p>
            <p className={styles.cardDesc}>
              下書きです。{stoppedStep.label}の途中で止まっています。
              「{stoppedStep.order} {stoppedStep.label}から続ける」でその手順から開きます。済んだ手順（✓）を押すと、その手順へ戻ります。
            </p>
          </section>
        )
      })() : null}

      {/* 二者承認：帯と、承認する人の操作（中身は v7 と同じ部品）。 */}
      {approval.state ? (
        <ApprovalStatusSection
          approval={approval.state.approval}
          scheduledLabel={scheduledLabel}
          approverName={approval.approverName}
          requesterName={approval.requesterName}
          viewer={approval.state.viewer}
          onCancel={approval.onCancel}
          onRemind={approval.onRemind}
          busy={approval.busy}
          message={approval.message}
        />
      ) : null}
      {approval.state ? (
        <ApproverSection
          approval={approval.state.approval}
          viewer={approval.state.viewer}
          requesterName={approval.requesterName}
          recipientCount={approval.state.gate.recipientCount}
          scheduledLabel={scheduledLabel}
          messageSummary={approval.messageSummary}
          messageHref="#broadcast-phone"
          onApprove={approval.onApprove}
          onReject={approval.onReject}
          busy={approval.busy}
          message={approval.message}
        />
      ) : null}
      {approval.canReRequest && approval.state ? (
        <section aria-label="承認の依頼" className={styles.card}>
          <p className={styles.cardTitle}>承認を依頼する</p>
          <p className={styles.cardDesc}>
            {formatNumber(approval.state.gate.recipientCount)}人への配信です。承認されるまで送られません。
          </p>
          <div className="mt-3">
            <ApprovalRequestFields
              recipientCount={approval.state.gate.recipientCount}
              threshold={approval.state.gate.threshold}
              candidates={approval.candidates}
              candidatesState={approval.candidates.length > 0 ? 'ready' : 'loading'}
              approverId={approval.reApproverId}
              onApproverChange={approval.onApproverChange}
              note={approval.reApprovalNote}
              onNoteChange={approval.onNoteChange}
            />
          </div>
          {approval.message ? <p className="text-danger mt-2 text-xs">{approval.message}</p> : null}
          <div className="mt-3">
            <Button variant="secondary" onClick={approval.onRequest} disabled={approval.busy || !canEdit}>
              承認を依頼する
            </Button>
          </div>
        </section>
      ) : null}

      {/* 送信の進み具合／配信結果の数の帯。 */}
      <section className={styles.card}>
        <p className={styles.cardTitle}>{isSent ? '配信結果' : '送信の進み具合'}</p>
        {broadcast.status === 'sending' ? (
          <Progress
            state="active"
            title="送信中"
            percent={total > 0 ? (broadcast.successCount / total) * 100 : 0}
            countText={`${formatNumber(broadcast.successCount)} / ${formatNumber(total)} 件`}
            className="mt-3"
          />
        ) : null}
        <div className={`${styles.statBand} mt-3`}>
          {isSent ? (
            <>
              <StatCell label="届いた" value={delivered} unit="人" detail={`送信成功 ${rateText(total > 0 ? delivered / total : null)}`} />
              <StatCell
                label="開いた"
                value={insightState === 'ready' ? opened : null}
                unit="人"
                detail={insightState === 'loading' ? '読み込んでいます' : insightState === 'error' ? '読み込めませんでした' : `開封 ${rateText(openRate)}`}
              />
              <StatCell
                label="押した"
                value={insightState === 'ready' ? insight?.uniqueClick ?? null : null}
                unit="人"
                detail={insightState === 'loading' ? '読み込んでいます' : insightState === 'error' ? '読み込めませんでした' : `クリック ${rateText(insight?.clickRate)}`}
              />
              {/*
                ブロックは単独では取れない。届かなかった数（送信失敗を含む）を
                出し、内訳は下の「エラー」の段に書く。
              */}
              <StatCell label="ブロック" value={failedCount} unit="人" detail={rateText(total > 0 ? failedCount / total : null)} />
            </>
          ) : (
            <>
              <StatCell
                label="送信"
                value={total}
                unit="件"
                detail={broadcast.scheduledAt ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送り始めます` : 'まだ送っていません'}
              />
              <StatCell label="届いた" value={broadcast.successCount} unit="人" detail="送る前のため、まだありません" />
              <StatCell
                label="開いた"
                value={null}
                unit=""
                detail={insightState === 'error' ? '読み込めませんでした' : '—'}
              />
              <StatCell
                label="押した"
                value={null}
                unit=""
                detail={insightState === 'error' ? '読み込めませんでした' : '—'}
              />
            </>
          )}
        </div>
        {isSent ? (
          <p className={styles.cardDesc}>
            配信から14日間の数。開いた・押したは人数（同じ人は1人）。20人に満たないときは「—」で出します（少なすぎる数は出さない）。率は届いた人数で割った値。
          </p>
        ) : null}
        {insightState === 'error' ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className={styles.cardDesc}>開封・クリックを読み込めませんでした。送信の件数は上のとおりです。</p>
            <Button onClick={onReload}>集計を再読み込み</Button>
          </div>
        ) : null}
      </section>

      {isSent ? (
        <section className={styles.card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={styles.cardTitle}>反応</p>
            <Link href="/inflow-links" className="text-action text-xs font-semibold hover:underline">
              流入経路で見る →
            </Link>
          </div>
          {insight?.links?.length ? (
            <div className="mt-3 space-y-2">
              {insight.links.map((link) => (
                <div key={link.id} className={styles.linkRow}>
                  <div className={styles.linkRowTop}>
                    <div className="min-w-0">
                      <p className={styles.linkTitle} title={link.label}>{link.label}</p>
                      <p className={styles.linkUrl} title={link.url}>{link.url}</p>
                    </div>
                    <p className={styles.linkCount}>
                      押した {formatNumber(link.uniqueClickCount)}人（{rateText(link.clickRate)}）
                      {link.clickCount != null ? ` ・ 押された回数 ${formatNumber(link.clickCount)}回` : ''}
                    </p>
                  </div>
                  <div className={styles.linkBarTrack} aria-hidden="true">
                    <div
                      className={styles.linkBar}
                      style={{ width: `${Math.min(100, Math.max(0, ((link.clickRate ?? 0) <= 1 ? (link.clickRate ?? 0) * 100 : (link.clickRate ?? 0))))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={`${styles.cardDesc} mt-3`}>計測したボタン・リンクはありません。</p>
          )}
          {insight?.links?.length ? (
            <div className={`${styles.softBox} mt-3`}>
              <p className={styles.cardTitle}>リンクを押していない人へ追送</p>
              <p className={styles.cardDesc}>
                届いたのにリンクを押していない人だけを宛先にして、同じ文面で作り直します。対象は作成画面で人数を確かめてから送ってください。
              </p>
              <div className="mt-2">
                <Button size="field" onClick={onChase} disabled={!canEdit}>
                  追送する配信を作る
                </Button>
              </div>
            </div>
          ) : null}
          <div className={`${styles.softBox} mt-3`}>
            <p className={styles.cardTitle}>エラー</p>
            <p className={styles.cardDesc}>
              {failedCount > 0 ? `送信に失敗した人がいます（${formatNumber(failedCount)}人）。` : '送信に失敗した人はいません（0人）。'}
            </p>
          </div>
        </section>
      ) : null}

      <section className={styles.card}>
        <p className={styles.cardTitle}>アカウント別の内訳</p>
        <p className={styles.cardDesc}>
          アカウントごとの送信・届いた・開いた数は記録していません。複数のアカウントに送った場合も、上の数は合計です。
        </p>
      </section>

      {isSent ? null : (
        <section className={styles.card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={styles.cardTitle}>押されたリンク</p>
            <Link href="/inflow-links" className="text-action text-xs font-semibold hover:underline">
              流入経路で見る →
            </Link>
          </div>
          <p className={`${styles.cardDesc} mt-2`}>
            配信ごとのリンク別の押された数はまだ出せません。リンク全体は「分析 → URLクリック」で見られます。
          </p>
        </section>
      )}

      {/* 数え方の注（送ったあとだけ）。 */}
      {isSent ? (
        <section className={styles.card}>
          <p className={styles.cardTitle}>数え方</p>
          <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
            <li>・開封は LINE の集計値です。個人単位では取れないため「誰が読んだか」は分かりません</li>
            <li>・配信対象が20人未満のときは、LINE側の仕様で開封数・クリック数が表示されません</li>
            <li>・クリックも LINE の集計値で、母数は開封ではなく到達です。短縮URL（/t/…）の実測とは数字がずれることがあります</li>
          </ul>
        </section>
      ) : null}

    </>
  )
}

function StatCell({ label, value, unit, detail }: { label: string; value: number | null; unit: string; detail: string }) {
  return (
    <div className={styles.statCell}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>
        {value == null ? '—' : formatNumber(value)}
        {unit ? <span className={styles.statUnit}>{unit}</span> : null}
      </p>
      <p className={styles.statDetail}>{detail}</p>
    </div>
  )
}

function SideRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.sideDlRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
