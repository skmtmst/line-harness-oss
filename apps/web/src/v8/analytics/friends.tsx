'use client'

/*
 * ★V8 分析「友だちの増減」（Pencil `ws9wt`・1152 `eEhYU`・閲覧のみ `L4Uov`）。
 * 数の帯（4つ）→ 左に日ごとの増減の棒、右に「どこから増えたか」「減った友だち」。
 * 1152 では棒が全幅になり、右の2枚はその下に横並び。
 * 呼ぶ口・数の出し方は今の画面（app/analytics/page.tsx の FriendsOverviewTab）と同じ。
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, CircleHelp, UserMinus, Users } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { KpiMenu, RangePickerV8 } from './common'
import { api, type AnalyticsFriendsOverview, type AnalyticsRoutesOverview } from '@/lib/api'
import {
  METRIC_STATE_TEXT,
  analyticsWeekday,
  downloadCsv,
  formatAnalyticsDate,
  metricCardState,
  metricText,
  periodCaption,
  rangeFor,
  shortDate,
  shownValue,
  useOverview,
  useRegisterExport,
} from './parts'
import styles from './analytics.module.css'

type Day = AnalyticsFriendsOverview['data']['days'][number]
type Campaign = AnalyticsFriendsOverview['data']['campaigns'][number]

function DailyBars({ days, campaigns, selected, onSelect }: { days: Day[]; campaigns: Campaign[]; selected: string; onSelect: (date: string) => void }) {
  const max = Math.max(1, ...days.map((day) => Math.max(day.added, day.removed)))
  const ticks = days.length > 1 ? [0, 7, 14, 21].filter((index) => index < days.length - 1).map((index) => days[index].date).concat(days[days.length - 1].date) : days.map((day) => day.date)
  return <>
    <div className={styles.bars} role="list" aria-label="日ごとの増減">
      {days.map((day) => {
        const marks = campaigns.filter((item) => item.date === day.date)
        const label = `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日（${analyticsWeekday(day.date)}） 増加 ${day.added}人・減少 ${day.removed}人・差し引き ${day.net}人${marks.length ? `　${marks.map((item) => item.name).join('、')}` : ''}`
        return <button key={day.date} type="button" role="listitem" className={styles.day} data-selected={selected === day.date || undefined} aria-label={label} title={label} onClick={() => onSelect(selected === day.date ? '' : day.date)}>
          <span className={styles.dayUp}>
            {marks.map((item) => <i key={item.id} className={styles.dayMark} data-kind={item.kind} aria-hidden="true" />)}
            {day.added > 0 ? <span className={styles.barUp} style={{ height: `${day.added / max * 100}%` }} /> : null}
            <span className={styles.baseline} />
          </span>
          <span className={styles.dayDown}>{day.removed > 0 ? <span className={styles.barDown} style={{ height: `${day.removed / max * 100}%` }} /> : null}</span>
        </button>
      })}
    </div>
    <div className={styles.ticks} aria-hidden="true">{ticks.map((date) => <span key={date}>{shortDate(date)}</span>)}</div>
  </>
}

/** 経路の内訳は概要の後に読む（2つの重い集計を同時に走らせない）。 */
function RouteBreakdown({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const state = useOverview<AnalyticsRoutesOverview>(
    () => api.analytics.routesOverview(accountId, { from, to }),
    `${accountId}:${from}:${to}:friends-routes`,
  )
  if (!state.data) {
    if (state.loading) return <ListState kind="loading" title="分析を読み込んでいます" />
    return <ListState kind="error" description={state.error} onRetry={state.retry} />
  }
  // 右の列は人数の多い順に上位5件（全件は「流入と計測で詳しく見る」）。
  const routes = [...state.data.data.routes].sort((a, b) => (shownValue(b.friendAdds) ?? -1) - (shownValue(a.friendAdds) ?? -1)).slice(0, 5)
  const max = Math.max(1, ...routes.map((route) => shownValue(route.friendAdds) ?? 0))
  if (routes.length === 0) return <p className={styles.sideNote}>この期間に流入リンクから増えた友だちはいません</p>
  return <ul className={styles.routeRows}>{routes.map((route) => <li key={route.id} className={styles.routeRow}>
    <div className={styles.sideRow}><span className={styles.sideName} title={route.name}>{route.name}</span><strong className={styles.sideValue}>{`${metricText(route.friendAdds)} 人`}</strong></div>
    <div className={styles.track} title={`現在 ${metricText(route.currentFriends)}人・1人あたり ${metricText(route.costPerFriend)}円`}><span style={{ width: `${(shownValue(route.friendAdds) ?? 0) / max * 100}%` }} /></div>
  </li>)}</ul>
}

export default function FriendsV8({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const [selectedDate, setSelectedDate] = useState('')
  const state = useOverview<AnalyticsFriendsOverview>(
    () => api.analytics.friendsOverview(accountId, range),
    `${accountId}:${range.from}:${range.to}:friends`,
  )
  const overview = state.data?.data ?? null
  const daysShown = overview !== null && (overview.state === 'available' || overview.state === 'partial')
  const exportCsv = () => {
    if (!overview) return
    downloadCsv('analytics-friends.csv', [['日付', '増えた', '減った', '差し引き'], ...overview.days.map((day) => [day.date, day.added, day.removed, day.net])])
  }
  useRegisterExport(exportCsv, !daysShown)

  if (!state.data || !overview) {
    return <div className={styles.body}>
      <div className={styles.periodRow}><RangePickerV8 size="small" days={days} onChange={setDays} /></div>
      {state.loading ? <ListState kind="loading" title="分析を読み込んでいます" /> : <ListState kind="error" description={state.error} onRetry={state.retry} />}
    </div>
  }
  const addedValue = shownValue(overview.metrics.added)
  const removedValue = shownValue(overview.metrics.removed)
  // 差し引きは増加と減少から導いた値。元の2つが出せないなら差し引きも出さない。
  const netValue = addedValue === null || removedValue === null ? null : shownValue(overview.metrics.net)
  const reasonShownInBanner = overview.state !== 'available' && Boolean(overview.stateReason)
  const pendingReason = overview.stateReason ?? '日ごとの集計がまだありません'
  const selectedDay = overview.days.find((day) => day.date === selectedDate) ?? null
  const caption = periodCaption(state.data.period.from, state.data.period.to, state.data.dataCutoffAt)
  const menu = (title: string) => <KpiMenu title={title} label="日ごとの数を CSV で書き出す" onExport={exportCsv} disabled={!daysShown} />

  return <>
    <KpiBand className={styles.band}>
      <KpiCard presentation="band" title="増えた" icon={<Users size={13} aria-hidden="true" />} menu={menu('増えた')} value={addedValue} unit="人" {...metricCardState(overview.metrics.added, { detail: `この${days}日。初回 ${metricText(overview.metrics.firstTime)}人` }, state.retry)} />
      <KpiCard presentation="band" title="減った" icon={<UserMinus size={13} aria-hidden="true" />} menu={menu('減った')} value={removedValue} unit="人" {...metricCardState(overview.metrics.removed, { detail: `この${days}日・解除を含む` }, state.retry)} />
      <KpiCard presentation="band" title="差し引き" icon={<ArrowLeftRight size={13} aria-hidden="true" />} menu={menu('差し引き')} value={netValue} unit="人" signed {...metricCardState(overview.metrics.net, { detail: `友だちは ${metricText(overview.metrics.currentFriends)} 人` }, state.retry)} />
      <KpiCard presentation="band" title="ブロック率" icon={<CircleHelp size={13} aria-hidden="true" />} menu={menu('ブロック率')} value={null} unit="%" detail="ブロックの数は未取得" />
    </KpiBand>
    <div className={styles.body}>
      {reasonShownInBanner ? <Notice tone="warn">{overview.stateReason}</Notice> : null}
      <div className={styles.split}>
        <section className={styles.card} aria-labelledby="friends-daily-title">
          <div className={styles.cardHead}>
            <h2 id="friends-daily-title" className={styles.cardTitle}>{`日ごとの増減（この${days}日）`}</h2>
            <HelpTip label="日ごとの増減の説明">{`棒を選ぶとその日の数と配信・シナリオが出ます。${caption}`}</HelpTip>
            <span className={styles.spacer} />
            <RangePickerV8 size="small" days={days} onChange={(value) => { setDays(value); setSelectedDate('') }} />
          </div>
          <div className={styles.legend}>
            <span data-swatch="up">増えた</span><span data-swatch="down">減った</span><span data-swatch="broadcast">配信した日</span><span data-swatch="scenario">シナリオを始めた日</span>
          </div>
          {daysShown
            ? <DailyBars days={overview.days} campaigns={overview.campaigns} selected={selectedDate} onSelect={setSelectedDate} />
            : <div className={styles.emptyChart} role="status"><p>{reasonShownInBanner ? (METRIC_STATE_TEXT[overview.state] || '未取得') : pendingReason}</p>{overview.state === 'pending' ? <p>日ごとの集計は数分ごとに自動で更新されます。しばらくしても変わらないときは、時間をおいて開き直してください。</p> : null}</div>}
          {daysShown && (selectedDay || overview.campaigns.length > 0) ? <div className={styles.notes}>
            {selectedDay ? <p className={styles.note}><i data-kind="selected" aria-hidden="true" />{`${shortDate(selectedDay.date)}（${analyticsWeekday(selectedDay.date)}） 増加 ${selectedDay.added}人・減少 ${selectedDay.removed}人・差し引き ${selectedDay.net}人`}</p> : null}
            {overview.campaigns.map((item) => <p key={item.id} className={styles.note}><i data-kind={item.kind} aria-hidden="true" />{`${shortDate(item.date)} ${item.kind === 'scenario' ? 'シナリオを始めた' : '一斉配信'}「${item.name}」`}</p>)}
          </div> : null}
        </section>
        <aside className={styles.side}>
          <section className={styles.card} data-gap="routes" aria-labelledby="friends-routes-title">
            <h2 id="friends-routes-title" className={styles.cardTitle}>どこから増えたか</h2>
            <p className={styles.cardSub}>{`流入リンクごと・この${days}日`}</p>
            <RouteBreakdown accountId={accountId} from={range.from} to={range.to} />
            <Link href="/inflow-links" className={styles.more}>流入と計測で詳しく見る →</Link>
          </section>
          <section className={styles.card} data-gap="removed" aria-labelledby="friends-removed-title">
            <div className={styles.cardHead}>
              <h2 id="friends-removed-title" className={styles.cardTitle}>減った友だち</h2>
              <HelpTip label="減った友だちの説明">ブロックと友だち解除を合わせた人数です。ブロックだけの内訳は未取得です。</HelpTip>
            </div>
            <div className={styles.sideRow}><span className={styles.sideName}>ブロック・友だち解除の合計</span><strong className={styles.sideValue}>{`${metricText(overview.metrics.removed)} 人`}</strong></div>
            <p className={styles.sideNote}>{`ブロックの内訳は未取得です。${formatAnalyticsDate(state.data.period.from)}〜${formatAnalyticsDate(state.data.period.to)} の合計を表示します。`}</p>
          </section>
        </aside>
      </div>
    </div>
  </>
}
