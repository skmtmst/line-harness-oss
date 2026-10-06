'use client'

/*
 * ★V8 分析「URLクリック」（Pencil `iK4cQ`）。
 * 数の帯 → 道具の段（探す・状態・期間・CSV）→ URLごとの表 → 数え方の注。
 * 呼ぶ口（検索語は API へ・200件まで）・状態の絞り込み・ページ送り・CSV は今の画面（UrlClicksOverviewTab）と同じ。
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, Link2, MousePointerClick, Unlink, Users } from 'lucide-react'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { api, type AnalyticsMetric, type AnalyticsUrlClicksOverview } from '@/lib/api'
import { KpiMenu, RangePickerV8, StatePill } from './common'
import { MetricText } from './reactions'
import { downloadCsv, formatAnalyticsDateTime, periodCaption, rangeFor, shownValue, useOverview, useRegisterExport } from './parts'
import styles from './analytics.module.css'

type Link = AnalyticsUrlClicksOverview['data']['links'][number]

function metricSum(metrics: Array<AnalyticsMetric<number>>): number | null {
  const values = metrics.map(shownValue)
  return values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/** 「一斉配信「秋の…」」を「一斉配信」と「秋の…」に分ける。分けられないときはそのまま。 */
function sourceOf(item: Link): { kind: string; name: string; all: string } {
  const all = item.usageLocations.join('、')
  const first = item.usageLocations[0]
  if (!first) return { kind: '—', name: '', all }
  const match = /^(.+?)「(.+)」$/.exec(first)
  const more = item.usageLocations.length > 1 ? ` ほか${item.usageLocations.length - 1}件` : ''
  return match ? { kind: match[1], name: `${match[2]}${more}`, all } : { kind: first, name: more.trim(), all }
}

const shortUrl = (url: string) => url.replace(/^https?:\/\//, '')

export default function UrlClicksV8({ accountId }: { accountId: string }) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const [days, setDays] = useState(30)
  const range = useMemo(() => rangeFor(days - 1), [days])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  // 検索語は API へ渡し、200件を超えた URL にも届くようにする。
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])
  const state = useOverview<AnalyticsUrlClicksOverview>(
    () => api.analytics.urlClicksOverview(accountId, { ...range, limit: 200, query: debouncedQuery || undefined }),
    `${accountId}:${range.from}:${range.to}:${debouncedQuery}:url-clicks`,
  )
  const links = (state.data?.data.links ?? []).filter((item) => status === 'all' || item.isActive === (status === 'active'))
  const lastPage = Math.max(0, Math.ceil(links.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visibleLinks = links.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const exportRows = () => downloadCsv('analytics-url-clicks.csv', [
    ['リンク名', 'URL', '押された回数', '押した人', '使われた場所'],
    ...links.map((item) => [item.name, item.originalUrl, shownValue(item.clicks), shownValue(item.knownClickPeople), item.usageLocations.join('、')]),
  ])
  const exportDisabled = !state.data || visibleLinks.length === 0
  useRegisterExport(exportRows, exportDisabled)

  const toolbar = <div className={styles.toolbar}>
    <div className={styles.searchBox}><SearchField id="url-click-search" aria-label="URL・配信名・リンク名で探す" value={query} onChange={(value) => { setQuery(value); setPage(0) }} onClear={() => { setQuery(''); setPage(0) }} placeholder="URL・配信名・リンク名で探す" loading={state.loading} /></div>
    <div className={styles.selectBox}><Select id="url-state" aria-label="URLの状態" value={status} options={[{ value: 'all', label: 'すべての状態' }, { value: 'active', label: '計測中' }, { value: 'stopped', label: '停止中' }]} onChange={(value) => { setStatus(value); setPage(0) }} /></div>
    <RangePickerV8 days={days} onChange={setDays} />
    <span className={styles.spacer} />
    <Button variant="secondary" onClick={exportRows} disabled={exportDisabled}><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
  </div>

  if (!state.data) {
    return <div className={styles.body} data-gap="tab">{toolbar}{state.loading ? <ListState kind="loading" title="分析を読み込んでいます" /> : <ListState kind="error" description={state.error} onRetry={state.retry} />}</div>
  }
  const overview = state.data.data
  const clicks = metricSum(links.map((item) => item.clicks))
  const people = metricSum(links.map((item) => item.knownClickPeople))
  const active = links.filter((item) => item.isActive).length
  const stopped = links.length - active
  const zeroLinks = links.filter((item) => shownValue(item.clicks) === 0).length
  const menu = (title: string) => <KpiMenu title={title} onExport={exportRows} disabled={exportDisabled} />

  return <>
    <KpiBand className={styles.band}>
      <KpiCard presentation="band" title="押された回数" icon={<MousePointerClick size={13} aria-hidden="true" />} menu={menu('押された回数')} value={clicks} unit="回" detail={`この${days}日`} />
      <KpiCard presentation="band" title="押した人（URLごとの合計）" icon={<Users size={13} aria-hidden="true" />} menu={menu('押した人')} value={people} unit="人" detail="同じ人の何度押しは1人" />
      <KpiCard presentation="band" title="計測中のURL" icon={<Link2 size={13} aria-hidden="true" />} menu={menu('計測中のURL')} value={active} unit="件" detail={`止めている ${stopped}`} />
      <KpiCard presentation="band" title="押されていないURL" icon={<Unlink size={13} aria-hidden="true" />} menu={menu('押されていないURL')} value={zeroLinks} unit="件" detail="実測できたURLのうち" />
    </KpiBand>
    <div className={styles.body} data-gap="tab">
      {toolbar}
      {overview.stateReason ? <Notice tone="warn">{overview.stateReason}</Notice> : null}
      {overview.hasMore ? <p className={styles.caption}>条件に合うもののうち200件までを表示しています。探す言葉で絞るとこの中だけではなく全体から探します。CSVの書き出しも、表示している範囲だけが入ります。</p> : null}
      {status !== 'all' ? <p className={styles.caption}>{`取得した範囲から${status === 'active' ? '計測中' : '停止中'}を表示しています。上の件数とCSVも同じ状態で絞り込んでいます。`}</p> : null}
      {debouncedQuery ? <p className={styles.caption}>{`「${debouncedQuery}」で絞り込んでいます。上の件数とCSVの書き出しは、この絞り込みの結果が対象です。`}</p> : null}
      <div className={styles.table} role="table" aria-label="URLごとのクリック">
        <div className={styles.thead} role="row">
          <span role="columnheader" className={styles.colMain}>リンク名・リンク先URL</span>
          <span role="columnheader" className={styles.colType} data-w="170">どこから</span>
          <span role="columnheader" className={styles.num} data-w="100">押された回数</span>
          <span role="columnheader" className={styles.num} data-w="90">押した人</span>
          <span role="columnheader" className={styles.num} data-w="80" title={overview.clickRateDefinition}>クリック率</span>
          <span role="columnheader" className={styles.colState}>状態</span>
        </div>
        {visibleLinks.length === 0
          ? <div className={styles.emptyRow} role="row"><span role="cell">条件に合うURLはありません</span></div>
          : visibleLinks.map((item) => {
            const source = sourceOf(item)
            const actions = [item.actions?.tagName, item.actions?.scenarioName].filter(Boolean).join('・')
            const when = `最初 ${item.firstClickedAt ? formatAnalyticsDateTime(item.firstClickedAt.value) : '—'} ／ 最後 ${item.lastClickedAt ? formatAnalyticsDateTime(item.lastClickedAt.value) : '—'}`
            return <div key={item.trackedLinkId} className={styles.trow} role="row" data-h="two">
              <span role="cell" className={styles.colMain} title={when}><strong className={styles.cellStrong}>{item.name}</strong><span className={styles.cellSub} title={item.originalUrl}>{shortUrl(item.originalUrl)}</span></span>
              <span role="cell" className={styles.colType} data-w="170" title={source.all || undefined}><strong className={styles.cellStrong}>{source.kind}</strong>{source.name ? <span className={styles.cellSub}>{source.name}</span> : null}</span>
              <span role="cell" className={styles.num} data-w="100"><MetricText metric={item.clicks} /></span>
              <span role="cell" className={styles.num} data-w="90" title={`届いた人数 ${shownValue(item.deliveredPeople) ?? '—'}`}><MetricText metric={item.knownClickPeople} /></span>
              <span role="cell" className={styles.num} data-w="80">{shownValue(item.clickRate) === null ? <span className={styles.faint} title={item.clickRate.reason ?? undefined}>—</span> : <span>{shownValue(item.clickRate)}%</span>}</span>
              <span role="cell" className={styles.colState} title={actions ? `押した人へ：${actions}` : undefined}><StatePill tone={item.isActive ? 'ok' : 'neutral'}>{item.isActive ? '計測中' : '停止中'}</StatePill></span>
            </div>
          })}
      </div>
      {links.length > 10 ? <div className={styles.pager}>
        <span>{`${links.length}件中 ${links.length ? currentPage * pageSize + 1 : 0}〜${Math.min((currentPage + 1) * pageSize, links.length)}件（取得した範囲）`}</span>
        <span className={styles.spacer} />
        <Select aria-label="表示件数" value={String(pageSize)} options={[10, 20, 50].map((value) => ({ value: String(value), label: `${value}件` }))} onChange={(value) => { setPageSize(Number(value)); setPage(0) }} />
        <Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</Button>
        <Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>次へ</Button>
      </div> : null}
      <p className={styles.noteBox} title={`${periodCaption(state.data.period.from, state.data.period.to, state.data.dataCutoffAt)}。${overview.clickRateDefinition}`}>数えているのは、こちらで作った中継URLだけです。直接貼ったURLは数えられません。同じURLを同じ人が何度押しても「押した人」は1人と数えます。</p>
    </div>
  </>
}
