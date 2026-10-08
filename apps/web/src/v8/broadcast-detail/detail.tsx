'use client'

/*
 * ★V8 一斉配信の詳細（2026-10-06 一から書き直し）。
 * 絵：下書き `cgiGB`（再撮 `dK1aE`）・承認待ち `pNiUk`（`wfHIE`）・送った後 `F3X1Mo`（`tPm3e`）・
 * ほかの人が更新した `Q28Gb`・予約の取り消しの窓 `BeNtj`。
 *
 * 白い板いっぱいに 板の頭（題＋札・1行の説明・進みの帯／右に操作）→（競合の帯）→ タブ →
 * 左の本文（余白 20・28、段の間 22）と右の欄（幅 380、配信した設定 → メッセージのスマホ）。
 * カードで囲まず、線で分ける（絵 `cgiGB` ほか）。
 *
 * 読み込み・承認・集計・競合の見張りは入口（app/broadcasts/detail/page.tsx）が持ち、
 * ここは見せ方と、この画面だけの操作（テスト送信・削除・予約の取り消し）を持つ。
 * 宛先・記録のタブの中身は入口から差し込む（古い画面の部品を import しないため）。
 */
import { useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Download,
  FileClock,
  Pencil,
  RefreshCw,
  Send,
  Stamp,
  Trash2,
} from 'lucide-react'
import { notifyToast } from '@/components/shared/toast'
import {
  api,
  type ApiBroadcast,
  type BroadcastApprovalCandidate,
  type BroadcastApprovalState,
  type BroadcastInsight,
} from '@/lib/api'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Progress from '@/components/shared/progress'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import { ApprovalRequestFields } from '@/components/broadcasts/broadcast-approval'
import { PageFrame } from '@/components/templates/page-frame'
import { Steps } from '@/components/templates'
import { messageTypeLabel } from '@/lib/broadcast-summary'
import { formatNumber } from '@/lib/format'
import BroadcastPhone from './phone'
import {
  CREATION_STEPS,
  chaseHref,
  displayStatusOf,
  formatBroadcastDateTime,
  formatMonthDay,
  formatShortDateTime,
  rateText,
} from './display'
import styles from './detail.module.css'

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

const BADGE_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
  pending_approval: 'warning',
  scheduled: 'info',
  preparing: 'info',
  sending: 'warning',
  sent: 'success',
  partial_failed: 'warning',
  failed: 'danger',
}

type TabKey = 'overview' | 'recipients' | 'activity'

export interface BroadcastDetailProps {
  broadcast: ApiBroadcast
  /** LINE側の集計。まだ無い・取れないは「—」で出す（0 と混ぜない）。 */
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  /** 宛先の条件の要約（一覧と同じ audienceSummary を入口で作って渡す）。 */
  audienceLabel: string
  /** スマホ見本の部屋の名。 */
  accountName: string
  tab: TabKey
  onSelectTab: (tab: TabKey) => void
  /** 宛先・記録のタブの中身（入口から差し込む）。 */
  recipients: ReactNode
  activity: ReactNode
  onExportCsv: () => void
  /** 集計の取り直し・状態の読み直し（reloadToken を進める）。 */
  onReload: () => void
  /**
   * `Q28Gb`：ほかの人が更新したときだけ true。この画面は書き換えず、
   * 帯で知らせて読み直しだけ受け付ける。
   */
  conflict?: boolean
  onConflictReload?: () => void
  /** 閲覧のみ：変える操作は置かずに隠す（2026-10-06 オーナー決定）。 */
  canEdit: boolean
  contentRef: RefObject<HTMLElement | null>
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

export default function BroadcastDetail({
  broadcast,
  insight,
  insightState,
  audienceLabel,
  accountName,
  tab,
  onSelectTab,
  recipients,
  activity,
  onExportCsv,
  onReload,
  canEdit,
  contentRef,
  approval,
  conflict = false,
  onConflictReload,
}: BroadcastDetailProps) {
  const router = useRouter()
  const { status: displayStatus, label: statusLabel } = displayStatusOf(broadcast)
  const isDraft = broadcast.status === 'draft'
  const isSent = broadcast.status === 'sent'
  const isScheduled = broadcast.status === 'scheduled'
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [testing, setTesting] = useState(false)

  const editHref = `/broadcasts/new?draft=${encodeURIComponent(broadcast.id)}`
  const duplicateHref = `/broadcasts/new?duplicateFrom=${encodeURIComponent(broadcast.id)}`
  /* 下書きの現在地＝ `draft_step`（止まった手順）。なければ1つ目。 */
  const resumeStep = CREATION_STEPS[Math.max(0, CREATION_STEPS.findIndex((step) => step.key === broadcast.draftStep))]

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

  const sendTest = async () => {
    if (testing) return
    setTesting(true)
    try {
      const res = await api.broadcasts.testSend(broadcast.id)
      if (!res.success) throw new Error(res.error)
      notifyToast(`テスト送信が完了しました（成功 ${res.sent ?? 0}件・失敗 ${res.failed ?? 0}件）。`)
    } catch {
      notifyToast('テスト送信できませんでした。テスト送信先の設定と配信内容を確認してください。', { tone: 'error' })
    } finally {
      setTesting(false)
    }
  }

  /* 予約の取り消し。中身は下書きとして残る（予約したあとの画面と同じ決まり）。 */
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

  /* 「…」の中身はすべて変える操作。閲覧のみには「…」ごと置かない。 */
  const menuItems: ActionMenuItem[] = [
    {
      id: 'duplicate',
      label: '複製して作る',
      icon: <Copy size={14} aria-hidden="true" />,
      external: true,
      onSelect: () => router.push(duplicateHref),
    },
  ]
  if (isScheduled) {
    menuItems.push({
      id: 'cancel-reservation',
      label: '予約を取り消す',
      onSelect: () => { setCancelError(''); setCancelOpen(true) },
    })
  }
  menuItems.push({
    id: 'delete',
    label: '削除する',
    tone: 'danger',
    icon: <Trash2 size={14} aria-hidden="true" />,
    dividerBefore: true,
    onSelect: () => { setDeleteError(''); setDeleteOpen(true) },
  })

  const total = broadcast.totalCount
  const bubbleCount = broadcast.messageBubbles?.length ?? (broadcast.messageContent ? 1 : 0)
  const messageText = `${messageTypeLabel(broadcast.messageType)} ${bubbleCount}通`
  const scheduledLabel = broadcast.scheduledAt ? formatBroadcastDateTime(broadcast.scheduledAt) : null
  const approvalStatus = approval.state?.approval.status ?? null

  return (
    <PageFrame kind="detail" boardId="cgiGB pNiUk F3X1Mo Q28Gb dK1aE wfHIE tPm3e">
      <header className={styles.head}>
        <div className={styles.name}>
          <div className={styles.titleRow}>
            <h2 className={styles.title} title={broadcast.title}>{broadcast.title}</h2>
            <span className={styles.badge} data-tone={BADGE_TONE[displayStatus]}>
              <span className={styles.dot} aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <p className={styles.meta}>{metaLine(broadcast, audienceLabel)}</p>
          {isDraft
            ? <DraftStepRail broadcastId={broadcast.id} draftStep={broadcast.draftStep} canEdit={canEdit} />
            : <DeliveryRail broadcast={broadcast} approvalInvolved={approvalInvolved(broadcast, approval.state)} />}
        </div>
        <div className={styles.actions}>
          {canEdit ? (
            <>
              <RowMenu
                className={styles.iconButton}
                label={`配信「${broadcast.title}」の操作`}
                items={menuItems}
              />
            </>
          ) : null}
          {/* CSV は見るだけの操作。閲覧のみにも出す。 */}
          <Button size="field" onClick={onExportCsv}>
            <Download aria-hidden="true" />
            CSVで書き出す
          </Button>
          {canEdit && !isSent && broadcast.status !== 'sending' ? (
            <Button size="field" onClick={() => void sendTest()} disabled={testing} busy={testing} busyLabel="テスト送信中…">
              <Send aria-hidden="true" />
              テストを送る
            </Button>
          ) : null}
          {canEdit && isDraft ? (
            <Button size="field" variant="primary" href={`${editHref}&step=${resumeStep.key}`}>
              <Pencil aria-hidden="true" />
              {resumeStep.order} {resumeStep.label}から続ける
            </Button>
          ) : null}
          {canEdit && isScheduled ? (
            <Button size="field" href={editHref}>
              <Pencil aria-hidden="true" />
              編集を続ける
            </Button>
          ) : null}
          {canEdit && isSent ? (
            <Button size="field" variant="primary" href={duplicateHref}>
              <Copy aria-hidden="true" />
              複製して作る
            </Button>
          ) : null}
        </div>
      </header>

      {conflict ? (
        <div className={styles.conflictWrap} data-design-node="Q28Gb">
          <div className={styles.conflict} role="alert">
            <CircleAlert className={styles.conflictIcon} aria-hidden="true" />
            <div className={styles.conflictText}>
              {/* だれが・いつ更新したかは口（配信の詳細）に無いので出さない。 */}
              <p className={styles.conflictTitle}>{`ほかの人が配信「${broadcast.title}」を更新しました`}</p>
              <p className={styles.conflictDesc}>
                この画面は古い内容です。読み直すと最新の設定と見本が出ます（この画面では書き換えません）。
              </p>
            </div>
            <Button size="field" variant="primary" onClick={onConflictReload}>
              <RefreshCw aria-hidden="true" />
              読み直す
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.tabs}>
        <Tabs
          label="配信の詳細"
          items={[
            { label: '概要', current: tab === 'overview', onClick: () => onSelectTab('overview') },
            { label: `宛先 ${formatNumber(total)}`, current: tab === 'recipients', onClick: () => onSelectTab('recipients') },
            { label: '記録', current: tab === 'activity', onClick: () => onSelectTab('activity') },
          ]}
        />
      </div>

      <div className={styles.split}>
        <div className={styles.main}>
          {tab === 'recipients' ? recipients : tab === 'activity' ? activity : (
            <Overview
              broadcast={broadcast}
              insight={insight}
              insightState={insightState}
              approval={approval}
              canEdit={canEdit}
              messageText={messageText}
              scheduledLabel={scheduledLabel}
              resumeLabel={`${resumeStep.order} ${resumeStep.label}から続ける`}
              onReload={onReload}
              onChase={() => router.push(chaseHref(broadcast.id))}
            />
          )}
        </div>

        <aside className={styles.side} aria-label="配信した設定とメッセージ">
          <h3 className={styles.secTitle}>配信した設定</h3>
          <dl className={styles.rows}>
            <Row label="対象" value={`${audienceLabel} ${formatNumber(total)}人`} />
            <Row
              label={isSent ? '送った日時' : '送る日時'}
              value={
                isSent
                  ? formatBroadcastDateTime(broadcast.sentAt)
                  : scheduledLabel ? `${scheduledLabel} に送る予定` : '未設定（すぐに送る）'
              }
            />
            <Row label="送り方" value={isSent ? 'すぐに全員へ（分けて送らない）' : 'すぐに全員へ'} />
            <Row label="メッセージ" value={messageText} />
            <Row label="承認" value={approvalRowText(approvalStatus, approval)} />
            <Row
              label="作成者"
              value={broadcast.createdAt ? `${formatBroadcastDateTime(broadcast.createdAt)} 作成` : '記録していません'}
            />
          </dl>
          <h3 className={styles.secTitle} id="broadcast-phone">メッセージ</h3>
          <div ref={contentRef as RefObject<HTMLDivElement>}>
            <BroadcastPhone
              broadcast={broadcast}
              accountName={accountName}
              chip={
                isDraft
                  ? '送る前の見本'
                  : isSent
                    ? formatShortDateTime(broadcast.sentAt)
                    : broadcast.scheduledAt ? `${formatShortDateTime(broadcast.scheduledAt)} に届く予定` : '届く予定'
              }
              time={timeOf(isSent ? broadcast.sentAt : broadcast.scheduledAt)}
            />
          </div>
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
      <CancelReservationDialog
        open={cancelOpen}
        title={broadcast.title}
        description={broadcast.scheduledAt
          ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送る予定の ${formatNumber(total)}人 に送らなくなります。取り消すと下書きに戻り、もう一度予約できます。${approvalStatus && approvalStatus !== 'none' ? '承認はやり直しになります。' : ''}`
          : '予約が取り消され、この配信は送られなくなります。書いた内容は下書きとして残るので、作り直しにはなりません。'}
        busy={cancelling}
        error={cancelError}
        onConfirm={() => void cancelReservation()}
        onClose={() => { if (!cancelling) setCancelOpen(false) }}
      />
    </PageFrame>
  )
}

/**
 * 予約を取り消す（確かめ）の窓（絵 `BeNtj`：幅480・題16/700・説明13/21・
 * ボタンは 取り消す（赤）・やめる・← 予約のまま残す（主）の順に左から）。
 */
export function CancelReservationDialog({
  open,
  title,
  description,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      title={`「${title}」の予約を取り消しますか？`}
      description={description}
      designNode="BeNtj"
      designWidth={480}
      designHeaderPadding="24px 24px 0"
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className={`${styles.dialogButtons} ${styles.cancelButtons}`}>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={busy} busy={busy} busyLabel="取り消しています…">
            予約を取り消す
          </Button>
          <Button type="button" className={styles.cancelKeep} onClick={onClose} disabled={busy}>
            やめる
          </Button>
          <Button type="button" variant="primary" onClick={onClose} disabled={busy}>
            <ArrowLeft aria-hidden="true" />
            予約のまま残す
          </Button>
        </div>
      }
    />
  )
}

/** 見出しの下の1行：種類・対象（人数）・送る/送った日時。 */
function metaLine(broadcast: ApiBroadcast, audienceLabel: string): string {
  const kind = messageTypeLabel(broadcast.messageType)
  const audience = broadcast.status === 'sent' ? audienceLabel : `${audienceLabel}（${formatNumber(broadcast.totalCount)}人）`
  const when = broadcast.status === 'sent'
    ? (broadcast.sentAt ? `${formatBroadcastDateTime(broadcast.sentAt)} に送信` : '送信済み')
    : broadcast.status === 'sending'
      ? 'いま送っています'
      : broadcast.scheduledAt
        ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に送る予定`
        : 'まだ送っていません'
  return `${kind}・${audience}・${when}`
}

function timeOf(value: string | null | undefined): string {
  const short = formatShortDateTime(value)
  return short ? short.slice(short.indexOf('）') + 1) : '—'
}

/** 承認が絡む配信か（承認の段を進みの帯に出すか）。 */
function approvalInvolved(broadcast: ApiBroadcast, state: BroadcastApprovalState | null): boolean {
  const status = state?.approval.status ?? broadcast.approvalStatus ?? 'none'
  return status !== 'none' && status !== 'cancelled'
}

function approvalRowText(status: string | null, approval: BroadcastDetailProps['approval']): string {
  if (status === 'pending') return `${approval.approverName ?? 'スタッフ'}さんの承認待ち`
  if (status === 'approved') {
    const decided = approval.state?.approval.decidedAt
    return `${approval.approverName ?? 'スタッフ'}（${decided ? formatMonthDay(decided) : '承認済み'}）`
  }
  if (status === 'rejected') return '差し戻し'
  if (status === 'expired') return '期限切れ'
  return '要らない'
}

/**
 * 下書きの進み：作るときの5手順（`draft_step` で現在地）。型の共通部品 Steps（Fa8ED）で題と説明のすぐ下に1行。
 * 済んだ手順を押すとその手順の作成画面へ戻る（閲覧のみは押せる形にしない）。
 */
function DraftStepRail({ broadcastId, draftStep, canEdit }: { broadcastId: string; draftStep: string | null | undefined; canEdit: boolean }) {
  const router = useRouter()
  const currentIndex = Math.max(0, CREATION_STEPS.findIndex((step) => step.key === draftStep))
  return (
    <div className={styles.draftSteps}>
      <Steps
        label="作成の進み"
        currentKey={CREATION_STEPS[currentIndex]?.key}
        steps={CREATION_STEPS.map((step, index) => ({
          key: step.key,
          label: step.label,
          order: step.order,
          state: index < currentIndex ? 'done' as const : 'todo' as const,
          onSelect: canEdit && index < currentIndex
            ? () => router.push(`/broadcasts/new?draft=${encodeURIComponent(broadcastId)}&step=${step.key}`)
            : undefined,
        }))}
      />
    </div>
  )
}

/**
 * 送るまでの6段階（絵 `F3X1Mo`・`pNiUk`）。承認が絡まない・予約しない
 * 配信はその段を省く。分かれ道（失敗・停止・期限切れ）は札で添える。
 */
function DeliveryRail({ broadcast, approvalInvolved: withApproval }: { broadcast: ApiBroadcast; approvalInvolved: boolean }) {
  const { status: displayStatus } = displayStatusOf(broadcast)
  const scheduled = broadcast.status === 'scheduled' || broadcast.scheduledAt != null
  const steps = DELIVERY_STEPS.filter((step) => {
    if (step.key === 'pending_approval') return withApproval
    if (step.key === 'scheduled') return scheduled
    return true
  })
  const progressKey = displayStatus === 'partial_failed' || displayStatus === 'failed' ? 'sent'
    : displayStatus === 'stopped' ? 'sending'
    : displayStatus === 'expired' ? (withApproval ? 'pending_approval' : 'draft')
    : displayStatus
  const currentIndex = Math.max(0, steps.findIndex((step) => step.key === progressKey))
  const branchLabel = BRANCH_LABELS[displayStatus]
  return (
    <ol className={styles.rail} aria-label="配信の状態">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        return (
          <li key={step.key} className={styles.railItem} data-state={state} data-kind="delivery">
            {index > 0 ? <span className={styles.railLine} data-done={index <= currentIndex || undefined} aria-hidden="true" /> : null}
            <span className={styles.railStep}>
              <span className={styles.railMark} aria-hidden="true">{state === 'done' ? <Check size={11} strokeWidth={3} /> : null}</span>
              <span className={styles.railLabel} aria-current={state === 'current' ? 'step' : undefined}>{step.label}</span>
            </span>
          </li>
        )
      })}
      {branchLabel ? (
        <li className={styles.railItem}>
          <span className={styles.railLine} aria-hidden="true" />
          <span className={styles.badge} data-tone={BADGE_TONE[displayStatus]}>{branchLabel}</span>
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
  approval,
  canEdit,
  messageText,
  scheduledLabel,
  resumeLabel,
  onReload,
  onChase,
}: {
  broadcast: ApiBroadcast
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  approval: BroadcastDetailProps['approval']
  canEdit: boolean
  messageText: string
  scheduledLabel: string | null
  resumeLabel: string
  onReload: () => void
  onChase: () => void
}) {
  const total = broadcast.totalCount
  const isSent = broadcast.status === 'sent'
  const delivered = insight?.delivered ?? broadcast.successCount
  const opened = insight?.opens?.count ?? insight?.uniqueImpression ?? null
  const openRate = insight?.opens?.rate ?? insight?.openRate ?? null
  const failedCount = Math.max(0, total - broadcast.successCount)
  const insightReady = insightState === 'ready'
  const waiting = insightState === 'loading' ? '読み込んでいます' : insightState === 'error' ? '読み込めませんでした' : null
  const unclicked = insight?.uniqueClick != null ? Math.max(0, delivered - insight.uniqueClick) : null
  const state = approval.state

  return (
    <>
      {broadcast.status === 'draft' ? (
        <section className={styles.softBox}>
          <FileClock className={styles.boxIcon} aria-hidden="true" />
          <div className={styles.boxText}>
            <p className={styles.boxTitle}>まだ送っていません</p>
            <p className={styles.desc}>
              まだ送っていません。送ると、届いた・開いた・押した数がここに出ます。
              {canEdit ? `「${resumeLabel}」で作るのを続けられます。` : ''}
            </p>
          </div>
        </section>
      ) : null}

      {state ? (
        <ApprovalBox
          state={state}
          approval={approval}
          canEdit={canEdit}
          messageText={messageText}
          scheduledLabel={scheduledLabel}
        />
      ) : null}
      {state?.approval.status === 'pending' ? (
        <p className={styles.deadline}>
          承認されないまま {scheduledLabel ?? '送る時刻'} を過ぎると、送らずに期限切れになります。
        </p>
      ) : null}

      {canEdit && approval.canReRequest && state ? (
        <section aria-label="承認の依頼" className={styles.section}>
          <h3 className={styles.secTitle}>承認を依頼する</h3>
          <p className={styles.desc}>
            {formatNumber(state.gate.recipientCount)}人への配信です。承認されるまで送られません。
          </p>
          <ApprovalRequestFields
            recipientCount={state.gate.recipientCount}
            threshold={state.gate.threshold}
            candidates={approval.candidates}
            candidatesState={approval.candidates.length > 0 ? 'ready' : 'loading'}
            approverId={approval.reApproverId}
            onApproverChange={approval.onApproverChange}
            note={approval.reApprovalNote}
            onNoteChange={approval.onNoteChange}
          />
          {approval.message ? <p className={styles.error}>{approval.message}</p> : null}
          <div>
            <Button onClick={approval.onRequest} disabled={approval.busy}>承認を依頼する</Button>
          </div>
        </section>
      ) : null}

      <h3 className={styles.secTitle}>{isSent ? '配信結果' : '送信の進み具合'}</h3>
      {broadcast.status === 'sending' ? (
        <Progress
          state="active"
          title="送信中"
          percent={total > 0 ? (broadcast.successCount / total) * 100 : 0}
          countText={`${formatNumber(broadcast.successCount)} / ${formatNumber(total)} 件`}
        />
      ) : null}
      <div className={styles.stats}>
        {isSent ? (
          <>
            <Stat label="届いた" value={delivered} unit="人" detail={`送信成功 ${rateText(total > 0 ? delivered / total : null)}`} />
            <Stat label="開いた" value={insightReady ? opened : null} unit="人" detail={waiting ?? `開封 ${rateText(openRate)}`} />
            <Stat label="押した" value={insightReady ? insight?.uniqueClick ?? null : null} unit="人" detail={waiting ?? `クリック ${rateText(insight?.clickRate)}`} />
            {/* ブロックは単独では取れない。届かなかった数（送信失敗を含む）を出し、内訳は下の「エラー」に書く。 */}
            <Stat label="ブロック" value={failedCount} unit="人" detail={rateText(total > 0 ? failedCount / total : null)} />
          </>
        ) : (
          <>
            <Stat
              label="送信"
              value={broadcast.successCount}
              unit="件"
              detail={scheduledLabel ? `${scheduledLabel} に送り始めます` : 'まだ送っていません'}
            />
            <Stat label="届いた" value={broadcast.successCount} unit="人" detail="送る前のため、まだありません" />
            <Stat label="開いた" value={null} unit="" detail={insightState === 'error' ? '読み込めませんでした' : '—'} />
            <Stat label="押した" value={null} unit="" detail={insightState === 'error' ? '読み込めませんでした' : '—'} />
          </>
        )}
      </div>
      {isSent ? (
        <p className={styles.note}>
          配信から 14 日間の数。開いた・押したは人数（同じ人は 1 人）。20 人に満たないときは「—」で出します（少なすぎる数は出さない）。率は届いた人数で割った値。
        </p>
      ) : null}
      {insightState === 'error' ? (
        <div className={styles.inlineRow}>
          <p className={styles.desc}>開封・クリックを読み込めませんでした。送信の件数は上のとおりです。</p>
          <Button onClick={onReload}>集計を再読み込み</Button>
        </div>
      ) : null}

      {isSent ? (
        <>
          <section className={styles.section}>
            <div className={styles.secHead}>
              <h3 className={styles.secTitle}>反応</h3>
              <Link href="/inflow-links" className={styles.secLink}>流入経路で見る<ArrowRight aria-hidden="true" /></Link>
            </div>
            {insight?.links?.length ? (
              <ul className={styles.linkList}>
                {insight.links.map((link) => (
                  <li key={link.id} className={styles.linkRow}>
                    <div className={styles.linkTop}>
                      <div className={styles.linkText}>
                        <p className={styles.linkTitle} title={link.label}>{link.label}</p>
                        <p className={styles.linkUrl} title={link.url}>{link.url}</p>
                      </div>
                      <p className={styles.linkCount}>
                        {`押した ${formatNumber(link.uniqueClickCount)}人（${rateText(link.clickRate)}）`}
                        {link.clickCount != null ? `・押された回数 ${formatNumber(link.clickCount)}回` : ''}
                      </p>
                    </div>
                    <progress
                      className={styles.bar}
                      max={100}
                      value={Math.min(100, Math.max(0, (link.clickRate ?? 0) <= 1 ? (link.clickRate ?? 0) * 100 : (link.clickRate ?? 0)))}
                      aria-label={`${link.label}を押した割合`}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.desc}>計測したボタン・リンクはありません。</p>
            )}
          </section>
          {insight?.links?.length && canEdit ? (
            <section className={styles.chase}>
              <p className={styles.boxTitle}>リンクを押していない人へ追送</p>
              <p className={styles.desc}>
                {`届いたのにリンクを押していない${unclicked != null ? ` ${formatNumber(unclicked)} 人` : '人'}だけを宛先にして、同じ文面で作り直します。作成画面で人数を確かめてから送ります。`}
              </p>
              <div>
                <Button size="field" onClick={onChase}>
                  <Send aria-hidden="true" />
                  追送する配信を作る
                </Button>
              </div>
            </section>
          ) : null}
          <section className={styles.section}>
            <h3 className={styles.secTitle}>エラー</h3>
            <p className={styles.plain}>
              {failedCount > 0 ? `送信に失敗した人がいます（${formatNumber(failedCount)} 人）。` : '送信に失敗した人はいません（0 人）。'}
            </p>
          </section>
        </>
      ) : null}

      <section className={styles.section}>
        <h3 className={styles.secTitle}>アカウント別の内訳</h3>
        <p className={styles.faint}>
          アカウントごとの送信・届いた・開いた数は記録していません。複数のアカウントに送った場合も、上の数は合計です。
        </p>
      </section>

      {isSent ? null : (
        <section className={styles.section}>
          <div className={styles.secHead}>
            <h3 className={styles.secTitle}>押されたリンク</h3>
            <Link href="/inflow-links" className={styles.secLink}>流入経路で見る<ArrowRight aria-hidden="true" /></Link>
          </div>
          <p className={styles.faint}>
            配信ごとのリンク別の押された数はまだ出せません。リンク全体は「分析 → URL クリック」で見られます。
          </p>
        </section>
      )}
    </>
  )
}

/**
 * 承認の箱（絵 `pNiUk`）。承認待ちは緑の箱に 依頼・要点・差し戻す理由・操作。
 * 頼まれた人だけが 差し戻す／承認して送る を押せる。頼んだ人には 取り消す／もう一度知らせる。
 * 差し戻し・期限切れは理由だけを出す。承認済みは右の欄の「承認」に出す（箱は出さない）。
 */
function ApprovalBox({
  state,
  approval,
  canEdit,
  messageText,
  scheduledLabel,
}: {
  state: BroadcastApprovalState
  approval: BroadcastDetailProps['approval']
  canEdit: boolean
  messageText: string
  scheduledLabel: string | null
}) {
  const [reason, setReason] = useState('')
  const { status, note, requestedAt, rejectReason } = state.approval
  if (status === 'rejected' || status === 'expired') {
    return (
      <section className={styles.softBox} aria-label={status === 'rejected' ? '差し戻し' : '期限切れ'}>
        <CircleAlert className={styles.boxIcon} aria-hidden="true" />
        <div className={styles.boxText}>
          <p className={styles.boxTitle}>{status === 'rejected' ? '差し戻されました' : '期限切れです'}</p>
          <p className={styles.desc}>
            {status === 'rejected'
              ? `理由：${rejectReason || '—'}。内容を直して、もう一度承認を依頼してください。`
              : '承認されないまま予約の時刻を過ぎたため、送っていません。送るには作り直してください。'}
          </p>
        </div>
      </section>
    )
  }
  if (status !== 'pending') return null
  const mine = state.viewer.isApprover
  const request = [
    `依頼：${approval.requesterName ?? '—'}・${formatBroadcastDateTime(requestedAt)}`,
    note ? `ひとこと「${note}」` : '',
  ].filter(Boolean).join('　')
  return (
    <section className={styles.approval} aria-label="承認待ち">
      <p className={styles.approvalTitle}>
        <Stamp className={styles.approvalIcon} aria-hidden="true" />
        {mine ? 'あなたの承認を待っています' : approval.approverName ? `${approval.approverName}さんの承認を待っています` : '承認を待っています'}
      </p>
      <p className={styles.approvalRequest}>{request}</p>
      <dl className={styles.facts}>
        <div className={styles.fact}><dt>送る相手</dt><dd>{formatNumber(state.gate.recipientCount)}人</dd></div>
        <div className={styles.fact}><dt>送る日時</dt><dd>{scheduledLabel ?? '今すぐ送る'}</dd></div>
        <div className={styles.fact}><dt>メッセージ</dt><dd>{`${messageText}（右のスマホ）`}</dd></div>
      </dl>
      {mine ? (
        <>
          <div className={styles.field}>
            <label htmlFor="approval-reject-reason" className={styles.fieldLabel}>差し戻すときの理由</label>
            <TextField
              id="approval-reject-reason"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例：日時を 10 月にずらしてください"
            />
          </div>
          {approval.message ? <p className={styles.error}>{approval.message}</p> : null}
          <div className={styles.approvalButtons}>
            <Button
              onClick={() => approval.onReject(reason)}
              disabled={approval.busy || reason.trim() === ''}
              title={reason.trim() === '' ? '差し戻すときは理由が要ります' : undefined}
            >
              <ArrowLeft aria-hidden="true" />
              差し戻す
            </Button>
            <Button variant="primary" onClick={approval.onApprove} disabled={approval.busy}>
              <Check aria-hidden="true" />
              承認して送る
            </Button>
          </div>
        </>
      ) : state.viewer.isRequester && canEdit ? (
        <>
          {approval.message ? <p className={styles.error}>{approval.message}</p> : null}
          <div className={styles.approvalButtons}>
            <Button onClick={approval.onCancel} disabled={approval.busy}>依頼を取り消す</Button>
            <Button onClick={approval.onRemind} disabled={approval.busy}>もう一度知らせる</Button>
          </div>
        </>
      ) : null}
    </section>
  )
}

function Stat({ label, value, unit, detail }: { label: string; value: number | null; unit: string; detail: string }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>
        <span className={styles.statNum}>{value == null ? '—' : formatNumber(value)}</span>
        {unit ? <span className={styles.statUnit}>{unit}</span> : null}
      </p>
      {/* 数字だけの補足は絵どおり欧文の書体（Inter）。 */}
      <p className={styles.statDetail} data-numeric={/^[\d.,%—-]+$/.test(detail) || undefined}>{detail}</p>
    </div>
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
