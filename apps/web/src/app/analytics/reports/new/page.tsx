'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import { TimeField } from '@/components/shared/date-time-field'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import PageHeader from '@/components/shared/page-header'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type AnalyticsReportSchedule,
  type AnalyticsReportScheduleOptions,
  type AnalyticsReportSection,
} from '@/lib/api'

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
    lead: 'ブロックが ', tail: ' % をこえたら、その場で知らせる',
    detail: '配信の事故に早く気づけます。',
    threshold: '0.5', minimumSample: '20', step: '0.1',
    thresholdLabel: 'ブロック率のしきい値（%）', sampleLabel: 'ブロック条件の判定に必要な最低件数',
  },
  {
    id: 'friend_adds', metric: 'friend_adds', operator: 'decrease_percent',
    name: '友だち減少の条件',
    lead: '友だちが前の週より ', tail: ' % 減ったら、その場で知らせる',
    threshold: '20', minimumSample: '20', step: '1',
    thresholdLabel: '友だち減少のしきい値（%）', sampleLabel: '友だち減少条件の判定に必要な最低件数',
  },
  {
    id: 'conversions', metric: 'conversions', operator: 'zero_streak_days',
    name: '成果0件がつづく条件',
    lead: '成果が0件の日が ', tail: ' 日つづいたら、その場で知らせる',
    detail: '計測が壊れていることに気づけます。',
    threshold: '3', minimumSample: '20', step: '1',
    thresholdLabel: '成果0件がつづく日数のしきい値', sampleLabel: '成果0件条件の判定に必要な最低件数',
  },
]

function defaultAlertDrafts(enabled: boolean): Record<string, AlertRuleDraft> {
  return Object.fromEntries(ALERT_RULE_DEFS.map((def) => [def.id, { enabled, threshold: def.threshold, minimumSample: def.minimumSample }]))
}

const ROLE_LABEL = { owner: '統括', admin: '管理者', staff: '運用担当' } as const

function AnalyticsReportFormPage() {
  const searchParams = useSearchParams()
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
  const [lineEnabled, setLineEnabled] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  // 知らせの決めごとは件の条件ごとに on/off と数値を持つ。固定表示だったものを
  // 編集できるようにする(点検のN-285)。
  const [alertDrafts, setAlertDrafts] = useState<Record<string, AlertRuleDraft>>(() => defaultAlertDrafts(true))
  // 画面に出せない決めごと(将来増えた種類など)は、消さずにそのまま保存へ回す。
  const [extraAlertRules, setExtraAlertRules] = useState<AnalyticsReportSchedule['alertRules']>([])

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (active && response.success) setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => { active = false }
  }, [])

  // 読み直し用の数え直し。入力の状態には触らない(点検#508軽8)。
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setOptions(null)
    // id が外れた/変わったとき前の編集対象が残ると、新規作成のつもりが旧レポートへ
    // PUT してしまう。取り直すたびに編集状態も初期化する。
    setEditing(null)
    setEditMissing(false)
    if (!selectedAccountId) {
      setLoading(false)
      return () => { active = false }
    }
    void api.analytics.reportSchedules.list(selectedAccountId).then((response) => {
      if (!active) return
      if (!response.success) {
        setError(response.error || '定期レポートの設定を読み込めませんでした')
      } else {
        setOptions(response.data.options)
        if (editId) {
          const schedule = response.data.items.find((item) => item.id === editId)
          if (!schedule) {
            setEditMissing(true)
          } else {
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
          }
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

  const submit = async (sendOnce: boolean) => {
    if (!selectedAccountId || !options || !canManage || !hasRecipient) return
    if (!name.trim()) {
      setError('レポートの名前を入力してください')
      return
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
          setError('知らせる条件は、0以上の数と1以上の件数で入力してください')
          return
        }
        parsedAlertRules.push({ metric: def.metric, operator: def.operator, threshold, minimumSample })
      }
      parsedAlertRules.push(...extraAlertRules)
      if (parsedAlertRules.length === 0) {
        setError('知らせる条件を1つ以上えらぶか、「大きな変化を知らせる」を外してください')
        return
      }
    }
    setSaving(true)
    setError('')
    const emailRecipients = emails.map((item) => item.trim()).filter(Boolean)
    const recipients = [
      ...options.recipients.filter((item) => staffIds.includes(item.id)).map((item) => ({
        kind: 'staff' as const, staffId: item.id, label: item.name,
      })),
      ...emailRecipients.map((email) => ({ kind: 'email' as const, email, label: email })),
    ]
    const payload = {
      name: name.trim(), sections, savedAnalysisIds, cadence,
      weekday: cadence === 'weekly' ? Number(weekday) : null,
      monthDay: cadence === 'monthly' ? Number(monthDay) : null,
      sendTime, timeZone: options.timeZone, periodDays: Number(periodDays), recipients,
      channels: ['dashboard', ...(emailRecipients.length ? ['email' as const] : []), ...(lineEnabled ? ['line' as const] : [])] as AnalyticsReportSchedule['channels'],
      alertRules: parsedAlertRules,
    }
    try {
      if (editing) {
        const response = await api.analytics.reportSchedules.update(selectedAccountId, editing.id, {
          ...payload, expectedUpdatedAt: editing.updatedAt,
        })
        if (!response.success) throw new Error(response.error)
        setEditing(response.data)
        notifyToast(response.data.status === 'paused'
          ? '定期レポートを更新しました。止まっている間は届きません。再開すると次の予定から届きます。'
          : `定期レポートを更新しました。次は${nextLabel}に届きます。`)
      } else {
        const response = await api.analytics.reportSchedules.create(selectedAccountId, {
          ...payload, sendOnce,
        })
        if (!response.success) throw new Error(response.error)
        notifyToast(sendOnce ? '1回だけ送る依頼を受け付けました。送信結果は運用状態に残ります。' : `${nextLabel}から届く定期レポートを作りました。`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : editing ? '定期レポートを更新できませんでした' : '定期レポートを作れませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (accountLoading || loading) return <ListState kind="loading" title="定期レポートを読み込んでいます" />
  if (!selectedAccountId) return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="上のバーで、レポートを作るLINE公式アカウントを選んでください。" />
  // 一覧の取得失敗を「見つかりません」へ化けさせない。一時障害はやり直せる画面を先に出す。
  if (error && !options) return <ListState kind="error" title="定期レポートを表示できませんでした" description={error} onRetry={() => setReloadSeq((n) => n + 1)} />
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
    <div className="text-ink mx-auto max-w-screen-2xl pb-24" data-design-node="URqOA">
      <PageHeader
        breadcrumb={[{ label: '分析', href: '/analytics' }, { label: editing ? '定期レポートを直す' : '定期レポートをつくる' }]}
        title={editing ? '定期レポートを直す' : '定期レポートをつくる'}
        description=""
      />
      {!canManage && <div className="bg-canvas-sunken mb-4 rounded-control px-4 py-3 text-sm">運用担当は内容を確認できます。作成は統括または管理者が行います。</div>}
      {error && <Notice tone="danger" message={error} onClose={() => setError('')} className="mb-4" />}

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="grid gap-4 xl:col-span-2">
          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">名前を付けます</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">複数作るときに区別できる名前を付けてください。</p>
            <label className="text-ink-secondary grid gap-2 text-xs font-semibold">レポートの名前
              <input
                className="border-hairline text-ink bg-canvas h-10 max-w-md rounded-control border px-3 text-sm"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例: 週次まとめ"
              />
            </label>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">何を入れますか</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">チェックしたものが、この順にレポートへ並びます。</p>
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
              {SECTION_CHOICES.map((choice) => {
                const checked = sections.includes(choice.id)
                // 数字を出せない節は新たに選ばせない。既存レポートに入っている
                // ものは外せる向きだけ残す(点検のN-284)。
                const locked = Boolean(choice.unavailable) && !checked
                return (
                  <label className={`flex items-start gap-3 ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} key={choice.id}>
                    <input className="accent-accent mt-0.5 size-5" type="checkbox" checked={checked} disabled={locked} onChange={() => toggleSection(choice.id)} />
                    <span className="grid gap-1">
                      <strong className="text-sm">{choice.title}</strong>
                      <small className="text-ink-secondary text-xs font-normal">{choice.detail}</small>
                      {choice.unavailable && <small className="text-ink-faint text-xs font-normal">{choice.unavailable}</small>}
                    </span>
                  </label>
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
                  <label className="flex cursor-pointer items-start gap-3" key={item.id}>
                    <input
                      className="accent-accent mt-0.5 size-5"
                      type="checkbox"
                      checked={savedAnalysisIds.includes(item.id)}
                      onChange={() => setSavedAnalysisIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                    />
                    <span className="grid gap-1"><strong className="text-sm">{item.name}</strong><small className="text-ink-secondary text-xs font-normal">{item.kind === 'cross' ? 'クロス分析' : 'ファネル'}</small></span>
                  </label>
                ))}
              </div>
            </section>
          )}

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">いつ送りますか</h2>
            <div className="grid items-end gap-4 md:grid-cols-4">
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">間かく<SelectField value={cadence} onChange={(event) => setCadence(event.target.value as 'weekly' | 'monthly')} options={[{ value: 'weekly', label: '毎週' }, { value: 'monthly', label: '毎月' }]} /></label>
              {cadence === 'weekly' ? (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">曜日<SelectField value={weekday} onChange={(event) => setWeekday(event.target.value)} options={['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'].map((label, value) => ({ value: String(value), label }))} /></label>
              ) : (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">日<SelectField value={monthDay} onChange={(event) => setMonthDay(event.target.value)} options={Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}日` }))} /></label>
              )}
              <span className="text-ink-secondary grid gap-2 text-xs font-semibold">時刻<TimeField value={sendTime} onChange={setSendTime} aria-label="送る時刻" /></span>
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">集計する期間<SelectField value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} options={[{ value: '7', label: '前の7日間' }, { value: '30', label: '前の30日間' }, { value: '90', label: '前の90日間' }]} /></label>
            </div>
            <p className="text-ink-secondary mb-0 mt-4 text-xs">時刻は {options.timeZone} で計算します。</p>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">だれに送りますか</h2>
            {/*
             * #975 U064: 長い氏名・役割を細いチップに押し込まない。
             * 390pxでも誰を選んだか分かるよう、1人1行の行リストにする。
             */}
            <ul className="border-hairline divide-hairline divide-y rounded-card border" aria-label="レポートを受け取る人">
              {options.recipients.map((person) => {
                const checked = staffIds.includes(person.id)
                return (
                  <li key={person.id}>
                    <label className={`flex min-h-11 cursor-pointer items-start gap-3 px-4 py-2.5 ${checked ? 'bg-accent-soft' : ''}`}>
                      <input className="accent-accent mt-1 size-4 shrink-0" type="checkbox" checked={checked} onChange={() => setStaffIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                      <span className="min-w-0">
                        <strong className="text-ink block truncate text-sm" title={person.name}>{person.name}</strong>
                        <span className="text-ink-secondary block text-xs">ログインユーザー ／ {ROLE_LABEL[person.role]}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
              {emails.map((email, index) => (
                <li key={index}>
                  <label className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                    <span className="text-ink-secondary shrink-0 text-xs font-semibold">メールだけ</span>
                    <input
                      className="text-ink min-w-0 flex-1 bg-transparent text-sm outline-none"
                      type="email"
                      value={email}
                      onChange={(event) => setEmails((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                      placeholder="report@example.com"
                    />
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-2"><Button variant="secondary" onClick={() => setEmails((current) => [...current, ''])}>宛先を足す</Button></div>
            {!hasRecipient && <p className="text-ink-secondary mt-3 text-xs">受け取る人を1人以上選んでください。選ぶまで作れません。</p>}
            <label className="border-hairline mt-5 flex items-start gap-3 border-t pt-4">
              <input className="accent-accent mt-0.5 size-5" type="checkbox" checked={lineEnabled} onChange={(event) => setLineEnabled(event.target.checked)} />
              <span className="grid gap-1"><strong className="text-sm">LINEでも同じ内容を送る</strong><small className="text-ink-secondary text-xs font-normal">ログインユーザーのLINEに、要点だけを短くまとめて送ります。</small></span>
            </label>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-4 sm:p-6">
            <h2 className="text-lg font-semibold">知らせの決めごと</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">数字がふだんと大きくちがうときだけ、待たずに知らせます。</p>
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold"><input className="accent-accent size-5" type="checkbox" checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} />大きな変化を知らせる</label>
            <ul className="grid list-none gap-3 p-0">
              {ALERT_RULE_DEFS.map((def) => {
                const draft = alertDrafts[def.id]
                const fieldsDisabled = !alertsEnabled || !draft.enabled
                return (
                  <li className="flex items-start gap-2 text-xs" key={def.id}>
                    <input
                      type="checkbox"
                      className="accent-accent size-4 shrink-0"
                      checked={draft.enabled}
                      disabled={!alertsEnabled}
                      aria-label={`${def.name}を使う`}
                      onChange={(event) => setAlertDrafts((current) => ({ ...current, [def.id]: { ...current[def.id], enabled: event.target.checked } }))}
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

        <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section className="border-success bg-success-bg rounded-card border p-5 md:col-span-2 xl:col-span-1">
            <h2 className="mb-3 text-sm font-semibold">{nextLabel} に、こう届きます(見本)</h2>
            <div className="border-success rounded-card bg-canvas p-4 shadow-sm">
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
      </div>

      <StickyBar
        status={editing
          ? <>「{editing.name}」を直しています。保存すると、次の{nextLabel}から新しい内容で届きます。</>
          : <>まだ動いていません。つくると、次の{nextLabel}から届きはじめます。</>}
        actions={<><Link className="text-ink-secondary p-3 text-sm no-underline" href="/analytics">キャンセル</Link>{!editing && <Button variant="secondary" disabled={saving || !canManage || !hasRecipient} onClick={() => void submit(true)}>いますぐ1回だけ送ってみる</Button>}<Button disabled={saving || !canManage || !hasRecipient} onClick={() => void submit(false)}>{saving ? (editing ? '保存しています' : '作っています') : (editing ? '変更を保存する' : 'つくって動かす')}</Button></>}
      />
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
