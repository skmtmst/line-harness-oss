'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type AnalyticsReportScheduleOptions,
  type AnalyticsReportSection,
} from '@/lib/api'

const SECTION_CHOICES: Array<{ id: AnalyticsReportSection; title: string; detail: string }> = [
  { id: 'friends', title: '友だちの増減', detail: '増えた・減った・残っている割合' },
  { id: 'reactions', title: '配信の反応', detail: '押された割合・ブロックされた割合' },
  { id: 'routes', title: '経路と成果', detail: 'どこから来た人がいくらになったか／成果地点ごとの件数／前の期間との比べ' },
  { id: 'usage', title: '使われ方', detail: '作ったのに使っていないもの' },
  { id: 'mileage', title: 'マイルと紹介', detail: 'たまった・使われた・払った' },
]

const ROLE_LABEL = { owner: '統括', admin: '管理者', staff: '運用担当' } as const

export default function AnalyticsReportNewPage() {
  usePageTitle('定期レポートをつくる')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [options, setOptions] = useState<AnalyticsReportScheduleOptions | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('週次まとめ')
  const [sections, setSections] = useState<AnalyticsReportSection[]>(['friends', 'reactions', 'routes', 'usage'])
  const [savedAnalysisIds, setSavedAnalysisIds] = useState<string[]>([])
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly')
  const [weekday, setWeekday] = useState('1')
  const [monthDay, setMonthDay] = useState('1')
  const [sendTime, setSendTime] = useState('09:00')
  const [periodDays, setPeriodDays] = useState('7')
  const [staffIds, setStaffIds] = useState<string[]>([])
  const [email, setEmail] = useState('report@example.com')
  const [lineEnabled, setLineEnabled] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(true)

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (active && response.success) setCanManage(response.data.role === 'owner' || response.data.role === 'admin')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setNotice('')
    setOptions(null)
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
        setStaffIds(response.data.options.recipients.slice(0, 2).map((item) => item.id))
      }
      setLoading(false)
    }).catch(() => {
      if (active) { setError('定期レポートの設定を読み込めませんでした'); setLoading(false) }
    })
    return () => { active = false }
  }, [selectedAccountId])

  const nextLabel = useMemo(() => cadence === 'weekly'
    ? `${['日', '月', '火', '水', '木', '金', '土'][Number(weekday)]}曜 ${sendTime}`
    : `毎月${monthDay}日 ${sendTime}`, [cadence, monthDay, sendTime, weekday])

  const toggleSection = (id: AnalyticsReportSection) => {
    setSections((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const submit = async (sendOnce: boolean) => {
    if (!selectedAccountId || !options || !canManage) return
    setSaving(true)
    setError('')
    setNotice('')
    const recipients = [
      ...options.recipients.filter((item) => staffIds.includes(item.id)).map((item) => ({
        kind: 'staff' as const, staffId: item.id, label: item.name,
      })),
      ...(email.trim() ? [{ kind: 'email' as const, email: email.trim(), label: email.trim() }] : []),
    ]
    try {
      const response = await api.analytics.reportSchedules.create(selectedAccountId, {
        name: name.trim(), sections, savedAnalysisIds, cadence,
        weekday: cadence === 'weekly' ? Number(weekday) : null,
        monthDay: cadence === 'monthly' ? Number(monthDay) : null,
        sendTime, timeZone: options.timeZone, periodDays: Number(periodDays), recipients,
        channels: ['dashboard', ...(email.trim() ? ['email' as const] : []), ...(lineEnabled ? ['line' as const] : [])],
        alertRules: alertsEnabled ? [
          { metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 },
          { metric: 'friend_adds', operator: 'decrease_percent', threshold: 20, minimumSample: 20 },
          { metric: 'conversions', operator: 'zero_streak_days', threshold: 3, minimumSample: 20 },
        ] : [],
        sendOnce,
      })
      if (!response.success) throw new Error(response.error)
      setNotice(sendOnce ? '1回だけ送る依頼を受け付けました。送信結果は運用状態に残ります。' : `${nextLabel}から届く定期レポートを作りました。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '定期レポートを作れませんでした')
    } finally {
      setSaving(false)
    }
  }

  if (accountLoading || loading) return <div className="text-ink-secondary grid min-h-96 place-content-center justify-items-center gap-4">定期レポートを読み込んでいます</div>
  if (!selectedAccountId) return <div className="text-ink-secondary grid min-h-96 place-content-center justify-items-center gap-4">LINE公式アカウントを選んでください</div>
  if (error && !options) return <div className="text-ink-secondary grid min-h-96 place-content-center justify-items-center gap-4"><p>{error}</p><Button onClick={() => location.reload()}>もう一度読み込む</Button></div>
  if (!options || options.recipients.length === 0) return (
    <div className="text-ink-secondary grid min-h-96 place-content-center justify-items-center gap-4">
      <p>受け取るログインユーザーがいません。</p>
      <Link href="/staff">ログインユーザーを確認する</Link>
    </div>
  )

  return (
    <div className="text-ink mx-auto max-w-screen-2xl pb-24" data-design-node="URqOA">
      <PageHeader
        breadcrumb={[{ label: '分析', href: '/analytics' }, { label: '定期レポートをつくる' }]}
        title="定期レポートをつくる"
        description="決まった曜日と時刻に、必要な数字だけを担当者へ届けます。"
      />
      {!canManage && <div className="bg-canvas-sunken mb-4 rounded-control px-4 py-3 text-sm">運用担当は内容を確認できます。作成は統括または管理者が行います。</div>}
      {error && <div className="bg-danger-bg text-danger mb-4 rounded-control px-4 py-3 text-sm" role="alert">{error}</div>}
      {notice && <div className="bg-success-bg text-success mb-4 rounded-control px-4 py-3 text-sm" role="status">{notice}</div>}

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <main className="grid gap-4 xl:col-span-2">
          <section className="border-hairline bg-canvas rounded-card border p-6">
            <h2 className="text-lg font-semibold">何を入れますか</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">チェックしたものが、この順にレポートへ並びます。</p>
            <div className="border-hairline border-t">
              {SECTION_CHOICES.map((choice) => (
                <label className="border-hairline flex cursor-pointer items-start gap-3 border-b px-1 py-4" key={choice.id}>
                  <input className="accent-accent mt-0.5 size-5" type="checkbox" checked={sections.includes(choice.id)} onChange={() => toggleSection(choice.id)} />
                  <span className="grid gap-1"><strong className="text-sm">{choice.title}</strong><small className="text-ink-secondary text-xs font-normal">{choice.detail}</small></span>
                </label>
              ))}
            </div>
            {options.savedAnalyses.length > 0 && (
              <div className="mt-5 grid gap-3">
                <h3 className="text-sm font-semibold">保存した分析</h3>
                {options.savedAnalyses.map((item) => (
                  <label className="flex items-center gap-2 text-sm" key={item.id}>
                    <input className="accent-accent size-5" type="checkbox" checked={savedAnalysisIds.includes(item.id)} onChange={() => setSavedAnalysisIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
                    {item.name}
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-6">
            <h2 className="mb-4 text-lg font-semibold">いつ送りますか</h2>
            <div className="grid items-end gap-4 md:grid-cols-4">
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold md:col-span-4">レポート名<input className="border-hairline text-ink bg-canvas h-10 rounded-control border px-3 text-sm" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">間かく<SelectField value={cadence} onChange={(event) => setCadence(event.target.value as 'weekly' | 'monthly')} options={[{ value: 'weekly', label: '毎週' }, { value: 'monthly', label: '毎月' }]} /></label>
              {cadence === 'weekly' ? (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">曜日<SelectField value={weekday} onChange={(event) => setWeekday(event.target.value)} options={['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'].map((label, value) => ({ value: String(value), label }))} /></label>
              ) : (
                <label className="text-ink-secondary grid gap-2 text-xs font-semibold">日<SelectField value={monthDay} onChange={(event) => setMonthDay(event.target.value)} options={Array.from({ length: 28 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}日` }))} /></label>
              )}
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">時刻<input className="border-hairline text-ink bg-canvas h-10 rounded-control border px-3 text-sm" type="time" value={sendTime} onChange={(event) => setSendTime(event.target.value)} /></label>
              <label className="text-ink-secondary grid gap-2 text-xs font-semibold">集計する期間<SelectField value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} options={[{ value: '7', label: '前の7日間' }, { value: '30', label: '前の30日間' }, { value: '90', label: '前の90日間' }]} /></label>
            </div>
            <p className="text-ink-secondary mb-0 mt-4 text-xs">時刻は {options.timeZone} で計算します。</p>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-6">
            <h2 className="mb-4 text-lg font-semibold">だれに送りますか</h2>
            <div className="grid gap-2">
              {options.recipients.map((person) => (
                <label className="border-hairline rounded-control flex items-center gap-3 border px-4 py-3" key={person.id}>
                  <input className="accent-accent size-5" type="checkbox" checked={staffIds.includes(person.id)} onChange={() => setStaffIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                  <span className="grid flex-1 gap-1"><strong className="text-sm">{person.name}</strong><small className="text-ink-secondary text-xs font-normal">ログインユーザー ／ {ROLE_LABEL[person.role]}</small></span>
                  <em className="text-ink-faint text-xs not-italic">{person.lineLinked ? 'LINE連携済み' : 'LINE未連携'}</em>
                </label>
              ))}
              <label className="text-ink-secondary mt-2 grid max-w-md gap-2 text-xs font-semibold">メールだけ<input className="border-hairline text-ink bg-canvas h-10 rounded-control border px-3 text-sm" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="report@example.com" /></label>
            </div>
            <label className="border-hairline mt-5 flex items-start gap-3 border-t pt-4">
              <input className="accent-accent mt-0.5 size-5" type="checkbox" checked={lineEnabled} onChange={(event) => setLineEnabled(event.target.checked)} />
              <span className="grid gap-1"><strong className="text-sm">LINEでも同じ内容を送る</strong><small className="text-ink-secondary text-xs font-normal">ログインユーザーのLINEに、要点だけを短くまとめて送ります。</small></span>
            </label>
          </section>

          <section className="border-hairline bg-canvas rounded-card border p-6">
            <h2 className="text-lg font-semibold">知らせの決めごと</h2>
            <p className="text-ink-secondary mb-4 mt-1 text-sm">数字がふだんと大きくちがうときだけ、待たずに知らせます。</p>
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold"><input className="accent-accent size-5" type="checkbox" checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} />大きな変化を知らせる</label>
            <ul className="grid list-none gap-2 p-0">
              <li className="bg-canvas-sunken rounded-control grid gap-1 px-3 py-2 text-xs"><strong>ブロックが 0.5% をこえたら、その場で知らせる</strong><span className="text-ink-secondary">配信の事故に早く気づけます。</span></li>
              <li className="bg-canvas-sunken rounded-control grid gap-1 px-3 py-2 text-xs"><strong>友だちが前の週より 20% 減ったら、その場で知らせる</strong></li>
              <li className="bg-canvas-sunken rounded-control grid gap-1 px-3 py-2 text-xs"><strong>成果が0件の日が3日つづいたら、その場で知らせる</strong><span className="text-ink-secondary">計測が壊れていることに気づけます。</span></li>
            </ul>
          </section>
        </main>

        <aside className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section className="border-success bg-success-bg rounded-card border p-5 md:col-span-2 xl:col-span-1">
            <h2 className="mb-3 text-sm font-semibold">{nextLabel} に、こう届きます</h2>
            <div className="border-success rounded-card bg-canvas p-4 shadow-sm">
              <strong className="text-sm">【週次】8/18〜8/24 のまとめ</strong>
              <div className="mt-3 grid grid-cols-3 gap-2"><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">友だち<b className="text-ink text-base">＋112</b></span><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">成果<b className="text-ink text-base">118件</b></span><span className="bg-canvas-sunken rounded-control text-ink-secondary grid gap-1 p-2 text-xs">売上<b className="text-ink text-base">¥312,400</b></span></div>
              <p className="text-ink-secondary my-3 text-xs leading-relaxed">先週いちばん効いたのは「店頭POPのQRコード」でした（38件）。Facebookフィードは費用のほうが多くなっています（－¥36,000）。</p>
              <span className="text-accent text-xs font-semibold">くわしく見る</span>
            </div>
          </section>
          <section className="border-hairline bg-canvas rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">レポートが見ているもの</h3><ul className="grid list-none gap-3 p-0 text-xs"><li className="flex justify-between gap-3 font-semibold">流入と計測 <span className="text-ink-faint text-right font-normal">経路ごとの人数</span></li><li className="flex justify-between gap-3 font-semibold">コンバージョン <span className="text-ink-faint text-right font-normal">成果地点の件数</span></li><li className="flex justify-between gap-3 font-semibold">一斉配信 <span className="text-ink-faint text-right font-normal">押された割合</span></li><li className="flex justify-between gap-3 font-semibold">成果とアフィリエイト <span className="text-ink-faint text-right font-normal">報酬と支払い</span></li><li className="flex justify-between gap-3 font-semibold">ログインユーザー <span className="text-ink-faint text-right font-normal">宛先になる人</span></li></ul></section>
          <section className="border-hairline bg-canvas rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">つながる先</h3><ul className="grid list-none gap-3 p-0 text-xs"><li className="flex justify-between gap-3 font-semibold">ログインユーザー <span className="text-ink-faint text-right font-normal">受け取る人と見える範囲</span></li><li className="flex justify-between gap-3 font-semibold">分析 <span className="text-ink-faint text-right font-normal">もとになる数字</span></li><li className="flex justify-between gap-3 font-semibold">LINE通知 <span className="text-ink-faint text-right font-normal">知らせの届き方</span></li><li className="flex justify-between gap-3 font-semibold">機能設定 <span className="text-ink-faint text-right font-normal">出していない機能は入りません</span></li></ul></section>
          <section className="border-warning bg-warning-bg rounded-card border p-5"><h3 className="mb-3 text-sm font-semibold">気をつけること</h3><p className="text-ink-secondary mt-2 text-xs leading-relaxed">宛先が多いと気にしなくなります。ふだん見る人だけに送るのがおすすめです。</p><p className="text-ink-secondary mt-2 text-xs leading-relaxed">権限のない機能の数字は入りません。受け取る人ごとに、見える範囲だけが入ります。</p></section>
        </aside>
      </div>

      <StickyBar
        status={<>まだ動いていません。つくると、次の{nextLabel}から届きはじめます。</>}
        actions={<><Link className="text-ink-secondary p-3 text-sm no-underline" href="/analytics">キャンセル</Link><Button variant="secondary" disabled={saving || !canManage} onClick={() => void submit(true)}>いますぐ1回だけ送ってみる</Button><Button disabled={saving || !canManage} onClick={() => void submit(false)}>{saving ? '作っています' : 'つくって動かす'}</Button></>}
      />
    </div>
  )
}
