'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import { TimeField } from '@/components/shared/date-time-field'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import VersionCompare from '@/components/shared/version-compare'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './report-v8.module.css'
import ReportHeadV8 from './report-head-v8'
import {
  api,
  ApiError,
  type AnalyticsReportRun,
  type AnalyticsReportSchedule,
  type AnalyticsReportScheduleOptions,
  type AnalyticsReportSection,
} from '@/lib/api'
import {
  deliveryChannelLabel,
  deliveryStatusLabel,
  runErrorLabel,
  runStateLabel,
} from '../../report-run-state'

const SECTION_CHOICES: Array<{ id: AnalyticsReportSection; title: string; detail: string; unavailable?: string }> = [
  { id: 'friends', title: '友だちの増減', detail: '増えた・減った・残っている割合' },
  { id: 'reactions', title: '配信の反応', detail: '押された割合・ブロックされた割合' },
  { id: 'routes', title: '経路と成果', detail: 'どこから来た人がいくらになったか／成果地点ごとの件数／前の期間との比べ' },
  { id: 'usage', title: '使われ方', detail: '作ったのに使っていないもの' },
  // マイルの期間別集計は未接続で、入れてもレポートは「未取得」になるだけ。
  // 新たに選ばせず、既に入っている既存レポートからは外せるようにする。
  { id: 'mileage', title: 'マイルと紹介', detail: 'たまった・使われた・払った', unavailable: 'マイルの期間別集計はまだ接続されていません。入れても「未取得」とだけ届きます' },
]

type AlertRuleDraft = { enabled: boolean; threshold: string; minimumSample: string }

// 変化を知らせる決めごとの雛形。数値はあとから変えられる。裏側の検査と同じ
// metric/operator の組だけを出す(正本: apps/worker/src/routes/analytics.ts の
// parseReportBody と packages/db の AnalyticsReportAlertRule)。
const ALERT_RULE_DEFS: Array<{
  id: 'block_rate' | 'friend_adds' | 'conversions'
  metric: 'block_rate' | 'friend_adds' | 'conversions'
  operator: 'greater_than' | 'decrease_percent' | 'zero_streak_days'
  name: string
  lead: string
  tail: string
  detail?: string
  threshold: string
  minimumSample: string
  step: string
  thresholdLabel: string
  sampleLabel: string
}> = [
  {
    id: 'block_rate', metric: 'block_rate', operator: 'greater_than',
    name: 'ブロック増の条件',
    lead: 'ブロックが ', tail: ' % をこえたら、レポートに含めて知らせる',
    detail: '配信の事故に早く気づけます。',
    threshold: '0.5', minimumSample: '20', step: '0.1',
    thresholdLabel: 'ブロック率のしきい値（%）', sampleLabel: 'ブロック条件の判定に必要な最低件数',
  },
  {
    id: 'friend_adds', metric: 'friend_adds', operator: 'decrease_percent',
    name: '友だち減少の条件',
    lead: '友だちが前の週より ', tail: ' % 減ったら、レポートに含めて知らせる',
    threshold: '20', minimumSample: '20', step: '1',
    thresholdLabel: '友だち減少のしきい値（%）', sampleLabel: '友だち減少条件の判定に必要な最低件数',
  },
  {
    id: 'conversions', metric: 'conversions', operator: 'zero_streak_days',
    name: '成果0件がつづく条件',
    lead: '成果が0件の日が ', tail: ' 日つづいたら、レポートに含めて知らせる',
    detail: '計測が壊れていることに気づけます。',
    threshold: '3', minimumSample: '20', step: '1',
    thresholdLabel: '成果0件がつづく日数のしきい値', sampleLabel: '成果0件条件の判定に必要な最低件数',
  },
]

function defaultAlertDrafts(enabled: boolean): Record<string, AlertRuleDraft> {
  return Object.fromEntries(ALERT_RULE_DEFS.map((def) => [def.id, { enabled, threshold: def.threshold, minimumSample: def.minimumSample }]))
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

const CHANNEL_LABEL: Record<string, string> = {
  dashboard: '管理画面のお知らせ',
  email: 'メール',
  line: 'LINE',
}

function sectionTitleOf(id: string): string {
  return SECTION_CHOICES.find((choice) => choice.id === id)?.title ?? id
}

/*
 * G83vi「違いを比べる」の比べる文。版の本文ではなく設定の要約。
 * 最新と入力中の2つを作り、VersionCompare（行ごとの比べる）へ渡す。
 */
type ReportSummaryInput = {
  name: string
  sections: string[]
  savedAnalysisIds: string[]
  cadence: string
  weekday: string
  monthDay: string
  sendTime: string
  periodDays: string
  staffIds: string[]
  emails: string[]
  channels: string[]
  alertRules: Array<{ metric: string; operator: string; threshold: number; minimumSample: number }>
  staffName: (id: string) => string
  savedName: (id: string) => string
}

function describeReportSummary(input: ReportSummaryInput): string {
  const sections = input.sections.map(sectionTitleOf)
  const saved = input.savedAnalysisIds.map(input.savedName)
  const recipients = [
    ...input.staffIds.map(input.staffName),
    ...input.emails,
  ]
  const schedule = input.cadence === 'monthly'
    ? `毎月（${input.monthDay}日 ${input.sendTime}）`
    : `毎週（${WEEKDAY_JA[Number(input.weekday)] ?? input.weekday}曜 ${input.sendTime}）`
  const channels = input.channels.map((channel) => CHANNEL_LABEL[channel] ?? channel)
  const alerts = input.alertRules.map((rule) => {
    const def = ALERT_RULE_DEFS.find((item) => item.metric === rule.metric && item.operator === rule.operator)
    return def ? `${def.name}（${rule.threshold}・最低${rule.minimumSample}件）` : 'その他の条件'
  })
  return [
    `名前: ${input.name || '（名前なし）'}`,
    `入れるもの: ${sections.length > 0 ? sections.join('、') : '（なし）'}`,
    `保存した分析: ${saved.length > 0 ? saved.join('、') : 'なし'}`,
    `宛先: ${recipients.length > 0 ? recipients.join('、') : '（なし）'}`,
    `送る間かく: ${schedule}`,
    `集計する期間: 前の${input.periodDays}日間`,
    `通知方法: ${channels.length > 0 ? channels.join('、') : '（なし）'}`,
    `知らせる条件: ${alerts.length > 0 ? alerts.join('、') : 'なし'}`,
  ].join('\n')
}

/*
 * 作るときの未保存の基準。初期値そのままの署名。空の宛先行（文字なし）は
 * 未保存に数えない（下の署名と同じく空欄を外す）。なおすときは読み直した
 * 値で基準を作り直す（読み直し効果の中）。
 */
const NEW_BASELINE = JSON.stringify([
  '週次まとめ', ['friends', 'reactions', 'routes', 'usage'], [], 'weekly', '1', '1', '09:00', '7',
  [], [], true, false, false, true, defaultAlertDrafts(true), [],
])

const ROLE_LABEL = { owner: '統括', admin: '管理者', staff: '運用担当' } as const

/*
 * メールアドレスの形の検査。裏側（apps/worker/src/routes/analytics.ts の
 * isEmail）と同じ式で、同じ行を同じ理由で止める。以前は画面で止めずに
 * 裏側が黙って落としていたので、1件でも不備があれば送信しない。
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}

/*
 * R454: 1回送信の結果を見る画面。しまうと一覧から消えるため、
 * 依頼ID（この画面のURL）から失敗理由・宛先別結果へ到達させる。
 * 全部失敗の確定分だけ、ここから送り直せる。
 */
function OneTimeResultView({ accountId, schedule, runs, canManage, onRetryDone }: {
  accountId: string
  schedule: AnalyticsReportSchedule
  runs: AnalyticsReportRun[]
  canManage: boolean
  onRetryDone: () => void
}) {
  usePageTitle('1回送信の結果')
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const latest = runs[0] ?? null
  const sentAny = runs.some((run) => run.deliveryResults.some((item) => item.status === 'sent'))
  const canRetry = canManage && latest !== null && latest.state !== 'running' && !sentAny

  const retry = async () => {
    if (!canRetry || retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      const response = await api.analytics.reportSchedules.retry(accountId, schedule.id)
      if (!response.success) throw new Error(response.error)
      notifyToast('送り直しを受け付けました。結果はこの画面で確認できます。')
      onRetryDone()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : '送り直しを受け付けられませんでした')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="text-ink mx-auto flex max-w-screen-2xl flex-col gap-4 pb-24" data-design-node="URqOA">
      <PageHeader
        breadcrumb={[{ label: '分析', href: '/analytics' }, { label: '1回送信の結果' }]}
        title="1回送信の結果"
        description=""
      />
      <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
        <h2 className="truncate text-lg font-semibold" title={schedule.name}>{schedule.name}</h2>
        {!latest && (
          <p className="text-ink-secondary mt-2 text-sm">まだ送信されていません。送信が終わるとここに結果が出ます。</p>
        )}
        {latest && (
          <div className="mt-3 grid gap-2 text-sm">
            <p className="text-ink-secondary">結果: <strong className="text-ink">{runStateLabel(latest.state)}</strong></p>
            {runErrorLabel(latest.errorCode, latest.state) && (
              <Notice tone="info" message={runErrorLabel(latest.errorCode, latest.state) ?? ''} />
            )}
            <ul className="grid list-none gap-2 p-0">
              {latest.deliveryResults.map((item, index) => (
                <li key={index} className="border-hairline rounded-control border px-3 py-2 text-xs">
                  <span className="font-semibold">{deliveryChannelLabel(item.channel)}</span> ／ {item.recipient}
                  {' ／ '}{deliveryStatusLabel(item.status)}
                  {item.reason && <span className="text-ink-secondary">（{item.reason}）</span>}
                </li>
              ))}
              {latest.deliveryResults.length === 0 && (
                <li className="text-ink-secondary text-xs">宛先別の結果はまだありません。</li>
              )}
            </ul>
            {sentAny && (
              <p className="text-ink-secondary text-xs">一部は届いているため、送り直しはできません。</p>
            )}
          </div>
        )}
        {retryError && <Notice tone="danger" message={retryError} onClose={() => setRetryError('')} className="mt-3" />}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRetryDone}>もう一度確認</Button>
          {canRetry && (
            <Button disabled={retrying} onClick={() => void retry()} busy={retrying} busyLabel="送り直しています">届いていない分を送り直す
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

function AnalyticsReportFormPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const editId = searchParams.get('id')
  usePageTitle(editId ? '定期レポートを直す' : '定期レポートをつくる')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [options, setOptions] = useState<AnalyticsReportScheduleOptions | null>(null)
  const [editing, setEditing] = useState<AnalyticsReportSchedule | null>(null)
  const [editMissing, setEditMissing] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // レポート名は変えられるようにする(点検#508軽12)。固定だと複数作ったときに区別できない。
  const [name, setName] = useState('週次まとめ')
  const [sections, setSections] = useState<AnalyticsReportSection[]>(['friends', 'reactions', 'routes', 'usage'])
  const [savedAnalysisIds, setSavedAnalysisIds] = useState<string[]>([])
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly')
  const [weekday, setWeekday] = useState('1')
  const [monthDay, setMonthDay] = useState('1')
  const [sendTime, setSendTime] = useState('09:00')
  const [periodDays, setPeriodDays] = useState('7')
  // 宛先の初期値は空にする。例のアドレスが入ったまま作ると、選んでいない
  // 相手へ数字の入ったレポートが送られる。受信者の自動チェックもしない。
  const [staffIds, setStaffIds] = useState<string[]>([])
  const [emails, setEmails] = useState<string[]>([])
  // R453: 通知方法は独立した選択にする。新規は従来どおり
  // （管理画面のお知らせあり・メールは宛先ありのみ・LINEなし）。
  // 編集時は保存済みの通知方法をそのまま読み込む。
  const [dashboardEnabled, setDashboardEnabled] = useState(true)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [lineEnabled, setLineEnabled] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  // 知らせの決めごとは件の条件ごとに on/off と数値を持つ。固定表示だったものを
  // 編集できるようにする(点検のN-285)。
  const [alertDrafts, setAlertDrafts] = useState<Record<string, AlertRuleDraft>>(() => defaultAlertDrafts(true))
  // 画面に出せない決めごと(将来増えた種類など)は、消さずにそのまま保存へ回す。
  const [extraAlertRules, setExtraAlertRules] = useState<AnalyticsReportSchedule['alertRules']>([])
  // なおすときは読み直すまで基準なし。作るときは初期値が基準。
  const [baseline, setBaseline] = useState<string | null>(editId ? null : NEW_BASELINE)
  useEffect(() => {
    setBaseline(editId ? null : NEW_BASELINE)
  }, [editId])

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (active && response.success) setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => { active = false }
  }, [])

  // 読み直し用の数え直し。入力の状態には触らない(点検#508軽8)。
  const [reloadSeq, setReloadSeq] = useState(0)
  // R454: 1回送信の履歴（しまった依頼も依頼IDで結果へ到達させる）。
  const [oneTime, setOneTime] = useState<{ schedule: AnalyticsReportSchedule; runs: AnalyticsReportRun[] } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setConflictId(null)
    setUpdateConflict(false)
    setConflictLatest(null)
    setCompareOpen(false)
    setCompareError('')
    setNameError('')
    setOptions(null)
    // id が外れた/変わったとき前の編集対象が残ると、新規作成のつもりが旧レポートへ
    // PUT してしまう。取り直すたびに編集状態も初期化する。
    setEditing(null)
    setEditMissing(false)
    setOneTime(null)
    if (!selectedAccountId) {
      setLoading(false)
      return () => { active = false }
    }
    void api.analytics.reportSchedules.list(selectedAccountId).then(async (response) => {
      if (!active) return
      if (!response.success) {
        setError(response.error || '定期レポートの設定を読み込めませんでした')
        setLoading(false)
        return
      }
      setOptions(response.data.options)
      if (editId) {
        const schedule = response.data.items.find((item) => item.id === editId)
        if (schedule && !schedule.isOneTime) {
          setEditing(schedule)
          setName(schedule.name)
          setSections(schedule.sections)
          setSavedAnalysisIds(schedule.savedAnalysisIds)
          setCadence(schedule.cadence)
          setWeekday(String(schedule.weekday ?? 1))
          setMonthDay(String(schedule.monthDay ?? 1))
          setSendTime(schedule.sendTime)
          setPeriodDays(String(schedule.periodDays))
          setStaffIds(schedule.recipients.filter((item) => item.kind === 'staff' && item.staffId).map((item) => item.staffId as string))
          setEmails(schedule.recipients.filter((item) => item.kind === 'email' && item.email).map((item) => item.email as string))
          // R453: 保存済みの通知方法をそのまま読み込む。宛先の有無から
          // 組み直さない（変えない保存で通知方法が変わる原因）。
          setDashboardEnabled(schedule.channels.includes('dashboard'))
          setEmailEnabled(schedule.channels.includes('email'))
          setLineEnabled(schedule.channels.includes('line'))
          setAlertsEnabled(schedule.alertRules.length > 0)
          // 保存済みの決めごとを雛形へ戻す。画面に無い種類は別棚へ避けて、
          // 保存するときにそのまま付け直す(編集するたびに消えないように)。
          const drafts = defaultAlertDrafts(false)
          const extras: AnalyticsReportSchedule['alertRules'] = []
          for (const rule of schedule.alertRules) {
            const def = ALERT_RULE_DEFS.find((item) => item.metric === rule.metric && item.operator === rule.operator)
            if (def) drafts[def.id] = { enabled: true, threshold: String(rule.threshold), minimumSample: String(rule.minimumSample) }
            else extras.push(rule)
          }
          setAlertDrafts(drafts)
          setExtraAlertRules(extras)
          // なおし時の未保存の基準は、読み直した値そのまま。
          setBaseline(JSON.stringify([
            schedule.name, schedule.sections, schedule.savedAnalysisIds, schedule.cadence,
            String(schedule.weekday ?? 1), String(schedule.monthDay ?? 1), schedule.sendTime, String(schedule.periodDays),
            schedule.recipients.filter((item) => item.kind === 'staff' && item.staffId).map((item) => item.staffId as string),
            schedule.recipients.filter((item) => item.kind === 'email' && item.email).map((item) => (item.email as string).trim()).filter(Boolean),
            schedule.channels.includes('dashboard'), schedule.channels.includes('email'), schedule.channels.includes('line'),
            schedule.alertRules.length > 0, drafts, extras,
          ]))
          setLoading(false)
          return
        }
        // R454: 一覧に無い・1回送信の依頼は履歴の口で引く。
        // しまった1回送信もここで結果へ到達させる。
        try {
          const detail = await api.analytics.reportSchedules.runs(selectedAccountId, editId)
          if (!active) return
          if (detail.success && detail.data.schedule.isOneTime) {
            setOneTime(detail.data)
          } else {
            setEditMissing(true)
          }
        } catch {
          if (active) setEditMissing(true)
        }
      }
      setLoading(false)
    }).catch(() => {
      if (active) { setError('定期レポートの設定を読み込めませんでした'); setLoading(false) }
    })
    return () => { active = false }
  }, [selectedAccountId, reloadSeq, editId])

  const nextLabel = useMemo(() => cadence === 'weekly'
    ? `${['日', '月', '火', '水', '木', '金', '土'][Number(weekday)]}曜 ${sendTime}`
    : `毎月${monthDay}日 ${sendTime}`, [cadence, monthDay, sendTime, weekday])

  const toggleSection = (id: AnalyticsReportSection) => {
    setSections((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  // 宛先が0件のときは作れない。裏側も「受け取る人を選んでください」で止める。
  const hasRecipient = staffIds.length > 0 || emails.some((item) => item.trim() !== '')
  // R228: 形が合わない宛先行をその場で示す。空行は送信前に外すので対象外。
  const invalidEmails = emails.map((item) => {
    const trimmed = item.trim()
    return trimmed !== '' && !isEmail(trimmed) ? trimmed : null
  })
  const hasInvalidEmail = invalidEmails.some(Boolean)

  // R455: 保存応答が遅れて戻ったとき、別の依頼・別アカウントへ移って
  // いたらその応答を捨てる。応答のたびに「いま見ている対象」と比べる。
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const editIdRef = useRef(editId)
  editIdRef.current = editId
  /*
   * R526: 別アカウント・別編集対象へ移ったら、前の保存の進行表示を
   * 残さない。終わらない作成をAに残したままBへ移ると、Bの保存ボタンが
   * 「作っています」のまま押せなくなる（finally の setSaving(false) は
   * sameTarget の内側なので、移った後の決着では戻らない）。
   * 遅れて戻るAの応答は R455 の sameTarget が捨てるので、ここで戻しても
   * Aの結果がBの画面を上書きしない。読み直し（reloadSeq）では戻さない。
   * 読み直しは同じ対象の再取得であり、進行中の保存と競わせないため。
   */
  const saveTargetRef = useRef<{ accountId: string | null; editId: string | null } | null>(null)
  /*
   * R526・ABA: 保存の試行の世代と、その試行の中身（キー＋内容の署名）。
   * 新しく押すたびに世代が進む。保存の対象（アカウント・編集ID）が
   * 切り替わっても世代を進め、切替前の試行の応答を永続無効化する
   * （読み直し reloadSeq とは別。要求キー自体は残すので、押し直しは
   * 同じキー・同じ内容なら既にある予約へ戻る＝再送の意味は維持）。
   * 古い試行の応答は捨てるのが基本だが、同じキー・同じ内容の正当な
   * 再送の応答だけは受け付ける（同じ行に戻るだけなので害がない）。
   * 下の submit 内の isFresh が比べる。
   */
  const saveSeqRef = useRef(0)
  const latestAttemptRef = useRef<{ seq: number; key: string; signature: string } | null>(null)
  /*
   * R526・ABA: 保存の対象（アカウント・編集ID）の世代。対象が切り替わる
   * たびに進む。試行は始まったときの対象世代を掴み、切替後に戻った古い
   * 応答は内容が同じでも受け付けない（下の isFresh）。
   */
  const switchSeqRef = useRef(0)
  useEffect(() => {
    const prev = saveTargetRef.current
    saveTargetRef.current = { accountId: selectedAccountId, editId }
    if (prev && (prev.accountId !== selectedAccountId || prev.editId !== editId)) {
      setSaving(false)
      /*
       * R526・ABA: 対象を移ったら切替前の保存の応答を永続無効化する。
       * 戻ってきても古い応答は受け付けない。古い作成が成功して古い予約の
       * 画面へ飛ぶと、未送信の編集（新しい保存の内容）が消えるため。
       * 要求キーは残すので、押し直しは再送として効く。
       */
      switchSeqRef.current += 1
    }
  }, [selectedAccountId, editId])
  /*
   * R526: アカウントごとの作成試行の要求キー。応答消失後の押し直しは
   * 同じアカウントの同じキーで送り、サーバは既にある予約を返す。
   * 成功・作り直しではそのアカウントの分だけ捨てる（別アカウントの
   * 試行は残す）。1枠だと、Aで応答を失いBで作るとBがAを上書きし、
   * Aへ戻った押し直しが別物として二重予約になる。
   * 裏側はキーをそのまま行の主キーにする（全アカウントで1つ）ため、
   * アカウントが違えば新しい試行にする。
   */
  const createKeysRef = useRef<Record<string, string>>({})
  /*
   * R526: 同じキーで内容の違う予約が既にあるときの、その予約の番号。
   * 2件目を黙って作らず、既にある予約への案内を出す。
   */
  const [conflictId, setConflictId] = useState<string | null>(null)
  const theme = useAdminTheme()
  const v8 = theme === 'v8'
  /*
   * G83vi: なおし中にほかの人が先に保存した（409）。
   * 入力は残したまま、板の頭の下に琥珀色の帯を出す。
   * 最新の取り直しができたら比べる文に使い、できなくても帯は出す。
   */
  const [updateConflict, setUpdateConflict] = useState(false)
  const [conflictLatest, setConflictLatest] = useState<AnalyticsReportSchedule | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  // H5UoIu: 名前は必須。空のまま押したらお知らせに加えて欄の下にも出す。
  const [nameError, setNameError] = useState('')

  /*
   * 保存する中身の検査と組み立て。submit（つくる・なおす）と
   * saveOverLatest（G83vi「この内容で保存する」）の両方から使う。
   * 文言・順番はそのまま。画面への表示は呼ぶ側が行う。
   */
  type ReportPayload = {
    name: string
    sections: AnalyticsReportSection[]
    savedAnalysisIds: string[]
    cadence: 'weekly' | 'monthly'
    weekday: number | null
    monthDay: number | null
    sendTime: string
    timeZone: string
    periodDays: number
    recipients: Array<
      | { kind: 'staff'; staffId: string; label: string }
      | { kind: 'email'; email: string; label: string }
    >
    channels: AnalyticsReportSchedule['channels']
    alertRules: AnalyticsReportSchedule['alertRules']
  }
  const buildReportPayload = (
    scheduleOptions: AnalyticsReportScheduleOptions,
  ): { ok: true; payload: ReportPayload } | { ok: false; error: string } => {
    if (!name.trim()) {
      return { ok: false, error: 'レポートの名前を入力してください' }
    }
    if (hasInvalidEmail) {
      return { ok: false, error: 'メールアドレスの形が正しくない宛先があります。該当の行を直すか消してください。' }
    }
    // R453: 通知方法は選んだとおりに送る。1つも選ばれていない・
    // 受け取れる宛先が無い組み合わせはここで止める（裏側と同じ文）。
    if (!dashboardEnabled && !emailEnabled && !lineEnabled) {
      return { ok: false, error: '通知方法を1つ以上選んでください' }
    }
    const emailRecipients = emails.map((item) => item.trim()).filter(Boolean)
    const staffById = new Map(scheduleOptions.recipients.map((item) => [item.id, item]))
    const emailCapable = emailRecipients.length > 0
      || staffIds.some((id) => staffById.get(id)?.email)
    if (emailEnabled && !emailCapable) {
      return { ok: false, error: 'メールを受け取れる宛先がありません' }
    }
    const lineCapable = staffIds.some((id) => staffById.get(id)?.lineLinked)
    if (lineEnabled && !lineCapable) {
      return { ok: false, error: 'LINE連携済みの宛先がありません' }
    }
    // 画面の数値を裏側が受け取れる形へ直す。変な数はここで止める
    // (裏側は不備のある条件を捨てるので、黙って無効になる前に知らせる)。
    const parsedAlertRules: AnalyticsReportSchedule['alertRules'] = []
    if (alertsEnabled) {
      for (const def of ALERT_RULE_DEFS) {
        const draft = alertDrafts[def.id]
        if (!draft?.enabled) continue
        const threshold = Number(draft.threshold)
        const minimumSample = Number(draft.minimumSample)
        if (!Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(minimumSample) || minimumSample < 1) {
          return { ok: false, error: '知らせる条件は、0以上の数と1以上の件数で入力してください' }
        }
        parsedAlertRules.push({ metric: def.metric, operator: def.operator, threshold, minimumSample })
      }
      parsedAlertRules.push(...extraAlertRules)
      if (parsedAlertRules.length === 0) {
        return { ok: false, error: '知らせる条件を1つ以上えらぶか、「大きな変化を知らせる」を外してください' }
      }
    }
    const recipients: ReportPayload['recipients'] = [
      ...scheduleOptions.recipients.filter((item) => staffIds.includes(item.id)).map((item) => ({
        kind: 'staff' as const, staffId: item.id, label: item.name,
      })),
      ...emailRecipients.map((email) => ({ kind: 'email' as const, email, label: email })),
    ]
    return {
      ok: true,
      payload: {
        name: name.trim(), sections, savedAnalysisIds, cadence,
        weekday: cadence === 'weekly' ? Number(weekday) : null,
        monthDay: cadence === 'monthly' ? Number(monthDay) : null,
        sendTime, timeZone: scheduleOptions.timeZone, periodDays: Number(periodDays), recipients,
        // R453: 選んだ通知方法をそのまま送る。宛先の有無からの組み直しや
        // dashboard の必須追加はしない（変えない保存で変わる原因）。
        channels: [
          ...(dashboardEnabled ? ['dashboard' as const] : []),
          ...(emailEnabled ? ['email' as const] : []),
          ...(lineEnabled ? ['line' as const] : []),
        ] as AnalyticsReportSchedule['channels'],
        alertRules: parsedAlertRules,
      },
    }
  }

  const submit = async (sendOnce: boolean) => {
    if (!selectedAccountId || !options || !canManage || !hasRecipient) return
    const built = buildReportPayload(options)
    if (!built.ok) {
      setError(built.error)
      // H5UoIu: 名前の未入力は欄の下にも出す（V8だけ）。
      setNameError(built.error === 'レポートの名前を入力してください' ? built.error : '')
      return
    }
    const { payload } = built
    setSaving(true)
    setError('')
    setNameError('')
    // R455: この保存が「どの依頼・どのアカウントへ向けたものか」を
    // 応答時に比べる。移っていたら編集先・文・保存中表示を変えない。
    const wantAccount = selectedAccountId
    const wantEditId = editId
    const sameTarget = () => accountRef.current === wantAccount && editIdRef.current === wantEditId
    /*
     * R526・ABA: 同じ依頼・同じアカウントへ戻って作り直すと、sameTarget
     * だけでは切替前の古い応答が通過する。古い作成が成功すると古い予約の
     * 画面へ飛び、新しい保存の状態と要求キーが消える。失敗でも新しい保存
     * の文を汚し、保存中の表示を落とす。保存の試行ごとに世代を数え、
     * 新しい試行が始まったら古い応答（成功・失敗とも）を捨てる。ただし
     * 同じキー・同じ内容の再送（正当な再送）の応答は受け付ける。
     */
    const mySeq = (saveSeqRef.current += 1)
    // R526・ABA: 試行が始まったときの対象世代。切替後に戻った古い応答は
    // 内容が同じでも受け付けない（対象切替で永続無効化）。
    const mySwitchSeq = switchSeqRef.current
    const myAttempt: { current: { key: string; signature: string } | null } = { current: null }
    const isFresh = () => {
      if (!sameTarget() || mySwitchSeq !== switchSeqRef.current) return false
      const latest = latestAttemptRef.current
      if (!latest || latest.seq === mySeq) return true
      // 対象を移らない新しい試行がある。同じキー・同じ内容の再送なら
      // 同じ行の結果なので受ける。
      const mine = myAttempt.current
      if (!mine) return false
      return latest.key === mine.key && latest.signature === mine.signature
    }
    try {
      if (editing) {
        myAttempt.current = { key: `update:${editing.id}`, signature: JSON.stringify(payload) }
        latestAttemptRef.current = { seq: mySeq, ...myAttempt.current }
        let response
        try {
          response = await api.analytics.reportSchedules.update(selectedAccountId, editing.id, {
            ...payload, expectedUpdatedAt: editing.updatedAt,
          })
        } catch (caught) {
          /*
           * G83vi: ほかの人が先に保存した（409）。入力は残したまま、
           * 板の頭の下に琥珀色の帯を出す（V8だけ。v7 は裏側の文のまま）。
           * 最新を取り直せたら「違いを比べる」の比べる文に使う。
           */
          if (!(caught instanceof ApiError) || caught.status !== 409) throw caught
          if (!isFresh()) return
          setUpdateConflict(true)
          setCompareOpen(false)
          setCompareError('')
          try {
            const latest = await api.analytics.reportSchedules.list(selectedAccountId)
            if (!isFresh()) return
            if (latest.success) {
              setConflictLatest(latest.data.items.find((item) => item.id === editing.id) ?? null)
            }
          } catch {
            // 取り直しに失敗しても帯は出す。比べる文は出さない。
          }
          setError(caught.message)
          return
        }
        if (!isFresh()) return
        if (!response.success) throw new Error(response.error)
        setUpdateConflict(false)
        setConflictLatest(null)
        setEditing(response.data)
        notifyToast(response.data.status === 'paused'
          ? '定期レポートを更新しました。止まっている間は届きません。再開すると次の予定から届きます。'
          : `定期レポートを更新しました。次は${nextLabel}に届きます。`)
      } else {
        // R526: 作成試行の要求キー。応答消失後の押し直しは同じアカウントの
        // 同じキーで送り、既にある予約へ戻す（2件目を作らない）。
        // 別アカウントの試行は別のキーにする（使い回すと裏側の主キーが
        // 衝突して500になる）。Aへ戻ればAのキーが残っているので再送が効く。
        const requestKey = createKeysRef.current[selectedAccountId]
          ?? (createKeysRef.current[selectedAccountId] = crypto.randomUUID())
        myAttempt.current = { key: `create:${requestKey}`, signature: JSON.stringify(payload) }
        latestAttemptRef.current = { seq: mySeq, ...myAttempt.current }
        let response
        try {
          response = await api.analytics.reportSchedules.create(selectedAccountId, {
            ...payload, sendOnce,
          }, { idempotencyKey: requestKey })
        } catch (caught) {
          // 失敗後に内容を変えて押し直すと、同じキーで内容の違う予約が
          // 既にある。2件目を黙って作らず、既にある予約への案内を出す。
          if (caught instanceof ApiError && caught.status === 409) {
            const existingId = (caught.data as { existingId?: unknown } | undefined)?.existingId
            if (typeof existingId === 'string' && existingId && isFresh()) {
              setConflictId(existingId)
              setError('')
              return
            }
          }
          throw caught
        }
        if (!isFresh()) return
        if (!response.success) throw new Error(response.error)
        // R526: 解決したのはこの保存の試行だけ。別アカウントの試行は残す。
        delete createKeysRef.current[wantAccount]
        setConflictId(null)
        /*
          R76。作ったあとも新規のまま残すと、時刻を直してもう一度押したときに
          更新ではなく別の定期配信が増える。作りたての編集画面へ移せば、
          次の保存は更新（PUT）になる。
          R454: 1回だけ送る場合も、その依頼の結果画面へ移す。
          一覧からは消えるため、結果の行き先をここで渡す。
        */
        if (sendOnce) {
          notifyToast(response.replayed
            ? '依頼は既に受け付けられていました。作り直さず、既にある依頼の結果を開きました。'
            : '1回だけ送る依頼を受け付けました。結果はこの画面で確認できます。')
          router.push(`/analytics/reports/new?id=${response.data.id}`)
        } else {
          notifyToast(response.replayed
            ? '予約は既に作られていました。作り直さず、既にある予約を開きました。内容を確認してください。'
            : `${nextLabel}から届く定期レポートを作りました。`)
          router.push(`/analytics/reports/new?id=${response.data.id}`)
        }
      }
    } catch (caught) {
      if (!isFresh()) return
      setError(caught instanceof Error ? caught.message : editing ? '定期レポートを更新できませんでした' : '定期レポートを作れませんでした')
    } finally {
      if (isFresh()) setSaving(false)
    }
  }

  /*
   * G83vi「最新を読み込んで続ける」。取り直せた最新があればそのまま
   * 画面へ戻し、なければ読み直す。どちらも入力中の内容は最新で置き換わる。
   */
  const applySchedule = (schedule: AnalyticsReportSchedule) => {
    setEditing(schedule)
    setName(schedule.name)
    setSections(schedule.sections)
    setSavedAnalysisIds(schedule.savedAnalysisIds)
    setCadence(schedule.cadence)
    setWeekday(String(schedule.weekday ?? 1))
    setMonthDay(String(schedule.monthDay ?? 1))
    setSendTime(schedule.sendTime)
    setPeriodDays(String(schedule.periodDays))
    setStaffIds(schedule.recipients.filter((item) => item.kind === 'staff' && item.staffId).map((item) => item.staffId as string))
    setEmails(schedule.recipients.filter((item) => item.kind === 'email' && item.email).map((item) => item.email as string))
    setDashboardEnabled(schedule.channels.includes('dashboard'))
    setEmailEnabled(schedule.channels.includes('email'))
    setLineEnabled(schedule.channels.includes('line'))
    setAlertsEnabled(schedule.alertRules.length > 0)
    const drafts = defaultAlertDrafts(false)
    const extras: AnalyticsReportSchedule['alertRules'] = []
    for (const rule of schedule.alertRules) {
      const def = ALERT_RULE_DEFS.find((item) => item.metric === rule.metric && item.operator === rule.operator)
      if (def) drafts[def.id] = { enabled: true, threshold: String(rule.threshold), minimumSample: String(rule.minimumSample) }
      else extras.push(rule)
    }
    setAlertDrafts(drafts)
    setExtraAlertRules(extras)
    setBaseline(JSON.stringify([
      schedule.name, schedule.sections, schedule.savedAnalysisIds, schedule.cadence,
      String(schedule.weekday ?? 1), String(schedule.monthDay ?? 1), schedule.sendTime, String(schedule.periodDays),
      schedule.recipients.filter((item) => item.kind === 'staff' && item.staffId).map((item) => item.staffId as string),
      schedule.recipients.filter((item) => item.kind === 'email' && item.email).map((item) => (item.email as string).trim()).filter(Boolean),
      schedule.channels.includes('dashboard'), schedule.channels.includes('email'), schedule.channels.includes('line'),
      schedule.alertRules.length > 0, drafts, extras,
    ]))
    setUpdateConflict(false)
    setConflictLatest(null)
    setCompareOpen(false)
    setCompareError('')
    setError('')
  }

  const reloadLatest = () => {
    if (conflictLatest) {
      applySchedule(conflictLatest)
      return
    }
    setCompareOpen(false)
    setReloadSeq((n) => n + 1)
  }

  /*
   * G83vi「比べてから保存」→比べる窓の「この内容で保存する」。
   * 比べたうえで、取り直した最新の版つきで保存し直す（相手の変更のうえに
   * 重ねる危ない操作なので、比べる窓の中からだけ押せる）。入力は残す。
   * 失敗したら窓は閉じず、その場で理由を出してもう一度押せる。
   */
  const saveOverLatest = async () => {
    if (!selectedAccountId || !options || !editing || !updateConflict || compareBusy) return
    const built = buildReportPayload(options)
    if (!built.ok) {
      setCompareError(built.error)
      return
    }
    setCompareBusy(true)
    setCompareError('')
    try {
      const latest = await api.analytics.reportSchedules.list(selectedAccountId)
      const found = latest.success
        ? latest.data.items.find((item) => item.id === editing.id)
        : undefined
      if (!found) {
        setCompareError('最新の内容を読み込めませんでした。窓を閉じて「最新を読み込んで続ける」を押してください。')
        return
      }
      const mySeq = (saveSeqRef.current += 1)
      const mySwitchSeq = switchSeqRef.current
      const key = `update:${editing.id}`
      const signature = JSON.stringify(built.payload)
      latestAttemptRef.current = { seq: mySeq, key, signature }
      const response = await api.analytics.reportSchedules.update(selectedAccountId, editing.id, {
        ...built.payload, expectedUpdatedAt: found.updatedAt,
      })
      if (accountRef.current !== selectedAccountId || editIdRef.current !== editId || mySwitchSeq !== switchSeqRef.current) return
      const current = latestAttemptRef.current
      if (current.seq !== mySeq) return
      if (!response.success) throw new Error(response.error)
      setEditing(response.data)
      setUpdateConflict(false)
      setConflictLatest(null)
      setCompareOpen(false)
      setBaseline(JSON.stringify([
        name, sections, savedAnalysisIds, cadence, weekday, monthDay, sendTime, periodDays,
        staffIds.filter(Boolean),
        emails.map((item) => item.trim()).filter(Boolean),
        dashboardEnabled, emailEnabled, lineEnabled, alertsEnabled, alertDrafts, extraAlertRules,
      ]))
      notifyToast(`定期レポートを更新しました。次は${nextLabel}に届きます。`)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const retry = await api.analytics.reportSchedules.list(selectedAccountId)
          if (retry.success) {
            setConflictLatest(retry.data.items.find((item) => item.id === editing.id) ?? null)
          }
        } catch {
          // 取り直しに失敗しても窓は閉じない。
        }
        setCompareError('ほかの人がさらに先に保存しました。比べ直してから、もう一度お試しください。')
        return
      }
      setCompareError(caught instanceof Error ? caught.message : '定期レポートを更新できませんでした')
    } finally {
      setCompareBusy(false)
    }
  }

  /*
   * G83vi「違いを比べる」の2つの文。最新が取れていないときは比べる窓を出さない。
   */
  const staffNameOf = (id: string) => options?.recipients.find((item) => item.id === id)?.name ?? id
  const savedNameOf = (id: string) => options?.savedAnalyses.find((item) => item.id === id)?.name ?? id
  const latestSummary = conflictLatest ? describeReportSummary({
    name: conflictLatest.name,
    sections: conflictLatest.sections,
    savedAnalysisIds: conflictLatest.savedAnalysisIds,
    cadence: conflictLatest.cadence,
    weekday: String(conflictLatest.weekday ?? 1),
    monthDay: String(conflictLatest.monthDay ?? 1),
    sendTime: conflictLatest.sendTime,
    periodDays: String(conflictLatest.periodDays),
    staffIds: conflictLatest.recipients.filter((item) => item.kind === 'staff' && item.staffId).map((item) => item.staffId as string),
    emails: conflictLatest.recipients.filter((item) => item.kind === 'email' && item.email).map((item) => item.email as string),
    channels: conflictLatest.channels,
    alertRules: conflictLatest.alertRules,
    staffName: staffNameOf,
    savedName: savedNameOf,
  }) : ''
  const parsedDraftAlerts = (): ReportSummaryInput['alertRules'] => {
    const rules: ReportSummaryInput['alertRules'] = []
    if (alertsEnabled) {
      for (const def of ALERT_RULE_DEFS) {
        const draft = alertDrafts[def.id]
        if (!draft?.enabled) continue
        const threshold = Number(draft.threshold)
        const minimumSample = Number(draft.minimumSample)
        if (!Number.isFinite(threshold) || !Number.isInteger(minimumSample)) continue
        rules.push({ metric: def.metric, operator: def.operator, threshold, minimumSample })
      }
      for (const rule of extraAlertRules) rules.push(rule)
    }
    return rules
  }
  const draftSummary = describeReportSummary({
    name, sections, savedAnalysisIds, cadence, weekday, monthDay, sendTime, periodDays,
    staffIds, emails: emails.map((item) => item.trim()).filter(Boolean),
    channels: [
      ...(dashboardEnabled ? ['dashboard'] : []),
      ...(emailEnabled ? ['email'] : []),
      ...(lineEnabled ? ['line'] : []),
    ],
    alertRules: parsedDraftAlerts(),
    staffName: staffNameOf,
    savedName: savedNameOf,
  })

  /*
   * つくる・なおし途中の離脱確認。基準（初期値または読み直した値）から
   * 変わっていたら、キャンセルや左メニューで確認窓を出す。空の宛先行は
   * 数えない。保存・送信が終わると別画面へ router.push するので、
   * 成功後に警告は出ない。
   */
  const signature = JSON.stringify([
    name, sections, savedAnalysisIds, cadence, weekday, monthDay, sendTime, periodDays,
    staffIds.filter(Boolean),
    emails.map((item) => item.trim()).filter(Boolean),
    dashboardEnabled, emailEnabled, lineEnabled, alertsEnabled, alertDrafts, extraAlertRules,
  ])
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: baseline !== null && signature !== baseline,
    busy: saving,
  })

  if (accountLoading || loading) return <ListState kind="loading" title="定期レポートを読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="上のバーで、レポートを作るLINE公式アカウントを選んでください。" />
  // 一覧の取得失敗を「見つかりません」へ化けさせない。一時障害はやり直せる画面を先に出す。
  if (error && !options) return <ListState kind="error" title="定期レポートを表示できませんでした" description={error} onRetry={() => setReloadSeq((n) => n + 1)} />
  // R454: 1回送信の依頼は結果の表示にする（しまうと一覧から消えるため）。
  if (oneTime && selectedAccountId) {
    return (
      <OneTimeResultView
        accountId={selectedAccountId}
        schedule={oneTime.schedule}
        runs={oneTime.runs}
        canManage={canManage}
        onRetryDone={() => setReloadSeq((n) => n + 1)}
      />
    )
  }
  if (editMissing || (editing === null && editId)) return <ListState kind="error" title="定期レポートが見つかりませんでした" description="一覧から選び直してください。" />
  if (editing?.isOneTime) return <ListState kind="empty" title="1回だけ送る依頼は変更できません" description="同じ内容が必要なときは、新しく作ってください。" />
  if (!options || options.recipients.length === 0) return (
    <ListState
      kind="empty"
      title="受け取るログインユーザーがいません"
      description="先に、受け取る人をログインユーザーへ追加してください。"
      action={<Button href="/staff">ログインユーザーを確認する</Button>}
    />
  )

  return (
    // U054: 左右の余白は app-shell が持つ（16px/24px/40px）。
    // ここで px-6 を重ねるとスマホで入力幅が二重に削られる。
    <div className={`text-ink mx-auto flex max-w-screen-2xl flex-col gap-4 pb-24 ${styles.page}`} data-design-node={v8 ? (updateConflict ? 'G83vi' : 'H5UoIu') : 'URqOA'}>
      {v8 && <ReportHeadV8 editing={Boolean(editing)} />}
      <div className={styles.legacyHead}>
        <PageHeader
          breadcrumb={[{ label: '分析', href: '/analytics' }, { label: editing ? '定期レポートを直す' : '定期レポートをつくる' }]}
          title={editing ? '定期レポートを直す' : '定期レポートをつくる'}
          description=""
        />
      </div>
      {v8 && updateConflict && (
        <div className={styles.conflict} role="alert">
          <div>
            <p className={styles.conflictTitle}>ほかの人がこのレポートを先に保存しました</p>
            <p className={styles.conflictSub}>このまま保存すると、相手の変更が消えます</p>
          </div>
          <div className={styles.conflictActions}>
            {conflictLatest && (
              <Button variant="secondary" onClick={() => { setCompareError(''); setCompareOpen(true) }}>違いを比べる</Button>
            )}
            <Button variant="secondary" onClick={() => reloadLatest()}>最新を読み込んで続ける</Button>
          </div>
        </div>
      )}
      {!canManage && <div className="bg-canvas-sunken mb-4 rounded-control px-4 py-3 text-sm">運用担当は内容を確認できます。作成は統括または管理者が行います。</div>}
      {error && <Notice tone="danger" message={error} onClose={() => setError('')} className="mb-4" />}
      {/*
        R526: 失敗後に内容を変えて押し直すと、同じ操作の予約が既にある。
        2件目を黙って作らず、既にある予約への案内を出す。別の新規として
        作り直すときだけ、要求キーを捨てて新しい試行にする（明示の選択）。
      */}
      {conflictId && (
        <Notice
          tone="warn"
          className="mb-4"
          onClose={() => setConflictId(null)}
          action={(
            <>
              <Button variant="secondary" href={`/analytics/reports/new?id=${encodeURIComponent(conflictId)}`}>既にある予約を確認</Button>
              <Button variant="secondary" onClick={() => { delete createKeysRef.current[selectedAccountId]; setConflictId(null) }}>内容を変えた新しい予約として作り直す</Button>
            </>
          )}
        >
          同じ操作で作った予約が既にあります。内容を変えて送り直したため、新しい予約は作りませんでした。
        </Notice>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="grid gap-4 xl:col-span-2">
          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">名前を付けます{v8 && <span className={styles.required}>必須</span>}</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">複数作るときに区別できる名前を付けてください。</p>
            <label className="text-ink-secondary grid gap-2 text-xs font-semibold">レポートの名前
              <input
                className="border-hairline text-ink bg-canvas h-10 max-w-md rounded-control border px-3 text-sm"
                type="text"
                value={name}
                onChange={(event) => { setName(event.target.value); setNameError('') }}
                placeholder="例: 週次まとめ"
                aria-invalid={v8 && nameError ? true : undefined}
              />
            </label>
            {v8 && nameError && <p className={styles.fieldError} role="alert">{nameError}</p>}
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">何を入れますか</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">チェックしたものが、この順にレポートへ並びます。</p>
            <div className={`grid gap-x-8 gap-y-3 md:grid-cols-2 ${styles.sectionCards}`}>
              {SECTION_CHOICES.map((choice) => {
                const checked = sections.includes(choice.id)
                // 数字を出せない節は新たに選ばせない。既存レポートに入っている
                // ものは外せる向きだけ残す(点検のN-284)。
                const locked = Boolean(choice.unavailable) && !checked
                return (
                  <Checkbox key={choice.id} checked={checked} disabled={locked} onCheckedChange={() => toggleSection(choice.id)} description={<>{choice.detail}{choice.unavailable && <>（{choice.unavailable}）</>}</>}>
                    <strong>{choice.title}</strong>
                  </Checkbox>
                )
              })}
            </div>
          </section>

          {options.savedAnalyses.length > 0 && (
            <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
              <h2 className="text-lg font-semibold">保存した分析を添えます</h2>
              <p className="text-ink-secondary mb-4 mt-1 text-sm">チェックした分析の最新の結果を、レポートに添えます。無くても作れます。</p>
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                {options.savedAnalyses.map((item) => (
                  <Checkbox
                    key={item.id}
                    checked={savedAnalysisIds.includes(item.id)}
                    onCheckedChange={() => setSavedAnalysisIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                    description={item.kind === 'cross' ? 'クロス分析' : 'ファネル'}
                  >
                    <strong>{item.name}</strong>
                  </Checkbox>
                ))}
              </div>
            </section>
          )}

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">いつ送りますか{v8 && <span className={styles.required}>必須</span>}</h2>
            {/* R229: 標準幅(176px)固定にすると、中間幅で隣の欄に重なる。列の幅に合わせる。 */}
            <div className={`grid items-end gap-4 md:grid-cols-4 ${styles.scheduleGrid}`}>
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">間かく<Select aria-label="間かく" value={cadence} onChange={(value) => setCadence(value as 'weekly' | 'monthly')} options={[{ value: 'weekly', label: '毎週' }, { value: 'monthly', label: '毎月' }]} size="full" /></label>
              {cadence === 'weekly' ? (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">曜日<Select aria-label="送る曜日" value={weekday} onChange={(value) => setWeekday(value)} options={['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'].map((label, value) => ({ value: String(value), label }))} size="full" /></label>
              ) : (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">日<Select aria-label="送る日" value={monthDay} onChange={(value) => setMonthDay(value)} options={Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}日` }))} size="full" /></label>
              )}
              <span className="text-ink-secondary grid gap-2 text-xs font-semibold">時刻<TimeField value={sendTime} onChange={setSendTime} aria-label="送る時刻" /></span>
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">集計する期間<Select aria-label="集計する期間" value={periodDays} onChange={(value) => setPeriodDays(value)} options={[{ value: '7', label: '前の7日間' }, { value: '30', label: '前の30日間' }, { value: '90', label: '前の90日間' }]} size="full" /></label>
            </div>
            <p className="text-ink-secondary mb-0 mt-4 text-xs">時刻は {options.timeZone} で計算します。</p>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">だれに送りますか{v8 && <span className={styles.required}>必須</span>}</h2>
            {(() => {
              // R449: 保存後に受け取れなくなった担当者を編集画面で知らせる。
              // 候補に出ない人を黙って外さない。
              if (!editing || !options) return null
              const invalid = editing.recipients.filter((item) => item.kind === 'staff' && item.staffId
                && !options.recipients.some((person) => person.id === item.staffId))
              if (invalid.length === 0) return null
              return (
                <Notice
                  tone="warn"
                  message={`前に選んでいた${invalid.map((item) => `「${item.label}」`).join('・')}は、いまは受け取れません（利用停止・閲覧範囲外の可能性があります）。このまま保存すると宛先から外れます。`}
                  className="mb-4"
                />
              )
            })()}
            {/*
             * #975 U064: 長い氏名・役割を細いチップに押し込まない。
             * 390pxでも誰を選んだか分かるよう、1人1行の行リストにする。
             */}
            <ul className="border-hairline divide-hairline divide-y rounded-card border" aria-label="レポートを受け取る人">
              {options.recipients.map((person) => {
                const checked = staffIds.includes(person.id)
                return (
                  <li key={person.id} className={`min-h-11 px-4 py-2.5 ${checked ? 'bg-accent-soft' : ''}`}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => setStaffIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])}
                      description={<span className="text-ink-secondary">ログインユーザー ／ {ROLE_LABEL[person.role]}</span>}
                    >
                      <strong className="block truncate text-sm" title={person.name}>{person.name}</strong>
                    </Checkbox>
                  </li>
                )
              })}
              {emails.map((email, index) => {
                const invalid = invalidEmails[index]
                return (
                  <li key={index} className="px-4 py-2.5">
                    <div className="flex min-h-11 items-center gap-3">
                      <span className="text-ink-secondary shrink-0 text-xs font-semibold">メールだけ</span>
                      <input
                        className="text-ink min-w-0 flex-1 bg-transparent text-sm outline-none"
                        type="email"
                        value={email}
                        onChange={(event) => setEmails((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                        placeholder="report@example.com"
                        aria-label={`宛先のメールアドレス ${index + 1}行目`}
                        aria-invalid={invalid ? true : undefined}
                      />
                      <button
                        type="button"
                        className="text-ink-faint hover:text-ink-secondary shrink-0 text-xs"
                        onClick={() => setEmails((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`${index + 1}行目の宛先を消す`}
                      >
                        消す
                      </button>
                    </div>
                    {invalid && (
                      <p className="text-danger mt-1 text-xs" role="alert">
                        「{invalid}」はメールアドレスの形になっていません。この宛先だけ外れないよう、直すか消してください。
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="mt-2"><Button variant="secondary" onClick={() => setEmails((current) => [...current, ''])}>宛先を足す</Button></div>
            {!hasRecipient && <p className="text-ink-secondary mt-3 text-xs">受け取る人を1人以上選んでください。選ぶまで作れません。</p>}
            {hasInvalidEmail && <p className="text-danger mt-3 text-xs">形が正しくない宛先があるため、いまのままでは作れません。</p>}
            {/*
              R453: 通知方法は3つとも独立した選択にする。担当者の宛先を
              選んでもメールが外れないし、指定しなかった管理画面の
              お知らせも勝手に付かない。未変更の保存はそのまま残る。
            */}
            <div className="border-hairline mt-5 grid gap-3 border-t pt-4" role="group" aria-label="通知方法">
              <Checkbox checked={dashboardEnabled} onCheckedChange={setDashboardEnabled} description="運用状態のお知らせに残します。">
                <strong>管理画面のお知らせにも出す</strong>
              </Checkbox>
              <Checkbox checked={emailEnabled} onCheckedChange={setEmailEnabled} description="宛先のメールアドレスへ送ります。担当者のメールもここで送ります。">
                <strong>メールでも送る</strong>
              </Checkbox>
              <Checkbox checked={lineEnabled} onCheckedChange={setLineEnabled} description="ログインユーザーのLINEに、要点だけを短くまとめて送ります。">
                <strong>LINEでも同じ内容を送る</strong>
              </Checkbox>
            </div>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">知らせの決めごと</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">レポートを作るときに前の期間と比べ、条件に合えばレポートに含めて知らせます。</p>
            <Checkbox className="mb-3" checked={alertsEnabled} onCheckedChange={setAlertsEnabled}>大きな変化を知らせる</Checkbox>
            <ul className="grid list-none gap-3 p-0">
              {ALERT_RULE_DEFS.map((def) => {
                const draft = alertDrafts[def.id]
                const fieldsDisabled = !alertsEnabled || !draft.enabled
                return (
                  <li className="flex items-start gap-2 text-xs" key={def.id}>
                    <Checkbox
                      checked={draft.enabled}
                      disabled={!alertsEnabled}
                      aria-label={`${def.name}を使う`}
                      onCheckedChange={(checked) => setAlertDrafts((current) => ({ ...current, [def.id]: { ...current[def.id], enabled: checked } }))}
                    />
                    <span className="grid gap-1">
                      <strong>
                        {def.lead}
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={def.step}
                          aria-label={def.thresholdLabel}
                          className="border-hairline text-ink bg-canvas mx-1 h-8 w-20 rounded-control border px-2 text-xs"
                          value={draft.threshold}
                          disabled={fieldsDisabled}
                          onChange={(event) => setAlertDrafts((current) => ({ ...current, [def.id]: { ...current[def.id], threshold: event.target.value } }))}
                        />
                        {def.tail}
                      </strong>
                      {def.detail && <span className="text-ink-secondary">{def.detail}</span>}
                      <span className="text-ink-faint">
                        集計できた件数が
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          aria-label={def.sampleLabel}
                          className="border-hairline text-ink bg-canvas mx-1 h-8 w-16 rounded-control border px-2 text-xs"
                          value={draft.minimumSample}
                          disabled={fieldsDisabled}
                          onChange={(event) => setAlertDrafts((current) => ({ ...current, [def.id]: { ...current[def.id], minimumSample: event.target.value } }))}
                        />
                        件以上のときだけ判定します
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="text-ink-faint mt-3 text-xs">集計待ちや一部だけ取れた期間は比べず、知らせません。</p>
          </section>
        </div>

        {v8 ? (
          <aside className={styles.rail} aria-label="届き方の見本と注意">
            <section className={styles.railCard}>
              <h2 className={styles.railTitle}>{nextLabel}に、こう届きます</h2>
              <p className={styles.railSub}>見本</p>
              <div className={styles.preview}>
                <p className={styles.previewTitle}>{name.trim() || '（名前なし）'}（前の{periodDays}日間）</p>
                <div className={styles.previewRows}>
                  <p className={styles.previewRow}>入れるもの <strong>{sections.length > 0 ? sections.map(sectionTitleOf).join('・') : '（なし）'}</strong></p>
                  <p className={styles.previewRow}>宛先 <strong>{staffIds.length + emails.map((item) => item.trim()).filter(Boolean).length}人</strong></p>
                  <p className={styles.previewRow}>知らせる条件 <strong>{alertsEnabled ? `${ALERT_RULE_DEFS.filter((def) => alertDrafts[def.id]?.enabled).length + extraAlertRules.length}件` : 'なし'}</strong></p>
                </div>
                <p className={styles.previewMore}>くわしくは分析で見る</p>
              </div>
            </section>
            <section className={styles.railCard}>
              <h2 className={styles.railTitle}>レポートが見ているもの</h2>
              <ul className={styles.kvList}>
                <li className={styles.kvRow}>集計する期間 <strong>前の{periodDays}日間</strong></li>
                <li className={styles.kvRow}>保存した分析 <strong>{savedAnalysisIds.length}件</strong></li>
              </ul>
            </section>
            <section className={styles.railCard}>
              <h2 className={styles.railTitle}>気をつけること</h2>
              <ul className={styles.notes}>
                <li>数は送る時刻の時点で集めます</li>
                <li>宛先がブロックしていると、LINEでは届きません</li>
              </ul>
            </section>
          </aside>
        ) : (
        <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section className="border-success bg-success-bg rounded-card border p-5 md:col-span-2 xl:col-span-1">
            <h2 className="mb-3 text-sm font-semibold">{nextLabel} に、こう届きます(見本)</h2>
            <div className="border-success rounded-card bg-canvas p-4 shadow-card">
              <strong className="text-sm">【週次】8/18〜8/24 のまとめ</strong>
              <p className="text-ink-faint mt-1 text-xs">数字はイメージです。</p>
              <div className="mt-3 grid grid-cols-3 gap-2"><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">友だち<b className="text-ink text-base">＋112</b></span><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">成果<b className="text-ink text-base">118件</b></span><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">売上<b className="text-ink text-base">¥312,400</b></span></div>
              <p className="text-ink-secondary my-3 text-xs leading-relaxed">先週いちばん効いたのは「店頭POPのQRコード」でした（38件）。Facebookフィードは費用のほうが多くなっています（－¥36,000）。</p>
              <span className="text-action text-xs font-semibold">くわしく見る</span>
            </div>
          </section>
          <section className="border-hairline bg-canvas rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">レポートが見ているもの</h3><ul className="grid list-none gap-3 p-0 text-xs"><li className="flex justify-between gap-3 font-semibold">流入と計測 <span className="text-ink-faint text-right font-normal">経路ごとの人数</span></li><li className="flex justify-between gap-3 font-semibold">コンバージョン <span className="text-ink-faint text-right font-normal">成果地点の件数</span></li><li className="flex justify-between gap-3 font-semibold">一斉配信 <span className="text-ink-faint text-right font-normal">押された割合</span></li><li className="flex justify-between gap-3 font-semibold">成果とアフィリエイト <span className="text-ink-faint text-right font-normal">報酬と支払い</span></li><li className="flex justify-between gap-3 font-semibold">ログインユーザー <span className="text-ink-faint text-right font-normal">宛先になる人</span></li></ul></section>
          <section className="border-hairline bg-canvas rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">つながる先</h3><ul className="grid list-none gap-3 p-0 text-xs"><li className="flex justify-between gap-3 font-semibold">ログインユーザー <span className="text-ink-faint text-right font-normal">受け取る人と見える範囲</span></li><li className="flex justify-between gap-3 font-semibold">分析 <span className="text-ink-faint text-right font-normal">もとになる数字</span></li><li className="flex justify-between gap-3 font-semibold">LINE通知 <span className="text-ink-faint text-right font-normal">知らせの届き方</span></li><li className="flex justify-between gap-3 font-semibold">機能設定 <span className="text-ink-faint text-right font-normal">出していない機能は入りません</span></li></ul></section>
          <section className="border-warning bg-warning-bg rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">気をつけること</h3><p className="text-ink-secondary mt-2 text-xs leading-relaxed">宛先が多いと気にしなくなります。ふだん見る人だけに送るのがおすすめです。</p><p className="text-ink-secondary mt-2 text-xs leading-relaxed">権限のない機能の数字は入りません。受け取る人ごとに、見える範囲だけが入ります。</p></section>
        </aside>
        )}
      </div>

      {/*
        m22c: 下の3つの操作は1440pxで1行に収める。試し送りは言葉を短くし
        （今すぐ1回だけ送る）、キャンセルは隣のボタンと同じ高さ40にそろえる。
        行の中で高さが違うと、同じ1行でも上端がずれて2行に見える
        （見た目の自動点検 k=5）。
      */}
      <StickyBar
        status={v8 ? null : (editing
          ? <>「{editing.name}」を直しています。保存すると、次の{nextLabel}から新しい内容で届きます。</>
          : <>まだ動いていません。つくると、次の{nextLabel}から届きはじめます。</>)}
        actions={<><Link className="text-ink-secondary inline-flex h-10 items-center px-3 text-sm no-underline" href="/analytics">キャンセル</Link>{!editing && <Button variant="secondary" disabled={saving || !canManage || !hasRecipient || hasInvalidEmail} onClick={() => void submit(true)}>今すぐ1回だけ送る</Button>}<Button disabled={saving || !canManage || !hasRecipient || hasInvalidEmail} onClick={() => { if (editing && v8 && updateConflict) { setCompareError(''); setCompareOpen(true) } else void submit(false) }} busy={saving} busyLabel={(editing ? '保存しています' : '作っています')}>{(editing ? (v8 && updateConflict ? '比べてから保存' : '変更を保存する') : 'つくって動かす')}</Button></>}
      />
      {v8 && (
        <Dialog
          open={compareOpen}
          title="違いを比べる"
          description="「－」が相手の最新の内容から消える行、「＋」があなたの入力で増える行です。このまま保存すると、相手の変更のうえに重ねて保存します。"
          onCancel={() => { if (!compareBusy) setCompareOpen(false) }}
          footer={(
            <>
              <Button variant="secondary" disabled={compareBusy} onClick={() => reloadLatest()}>最新を読み込んで続ける</Button>
              <Button disabled={compareBusy} onClick={() => void saveOverLatest()} busy={compareBusy} busyLabel="保存しています">この内容で保存する</Button>
            </>
          )}
          error={compareError || undefined}
          busy={compareBusy}
        >
          <VersionCompare before={latestSummary} after={draftSummary} />
        </Dialog>
      )}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した定期レポート" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function AnalyticsReportNewPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AnalyticsReportFormPage />
    </Suspense>
  )
}
