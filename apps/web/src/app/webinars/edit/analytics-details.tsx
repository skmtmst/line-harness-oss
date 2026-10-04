import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import { TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import type { WebinarAnalytics } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { fmtSec, percent } from './participants-shared'

/** 以前から確認できた詳細の数字を、主なグラフの下へ残す。 */
export default function AnalyticsDetails({ analytics }: { analytics: WebinarAnalytics }) {
  const funnel = analytics.formFunnel
  return <Disclosure size="compact" title="回別・日別とフォームの詳しい数字">
    <div className="min-w-0 space-y-5">
      <div>
        <h3 className="text-ink text-sm font-semibold">開催回ごとの結果<HelpTip label="開催回ごとの結果の説明">参加人数・平均視聴時間・CTAを押した人数です。CTAの割合は、その開催回の参加人数を分母にしています。</HelpTip></h3>
        {analytics.sessions.length === 0 ? <p className="text-ink-faint mt-2 text-xs">まだ開催回の視聴データがありません。</p> : <table className="mt-2 w-full table-fixed">
          <colgroup><col className="w-2/5" /><col className="w-1/6" /><col className="w-1/5" /><col /></colgroup>
          <thead><TableHeadRow><Th>開催日時</Th><Th align="right">参加</Th><Th align="right">平均視聴</Th><Th align="right">CTA</Th></TableHeadRow></thead>
          <tbody>{analytics.sessions.map((session) => {
            const date = formatDateTime(session.sessionStartAt * 1000)
            return <Tr key={session.sessionStartAt}><Td><span className="block truncate text-xs" title={date}>{date}</span></Td><Td align="right">{formatNumber(session.viewers)}人</Td><Td align="right"><span className="whitespace-nowrap">{fmtSec(session.avgWatchedSeconds)}</span></Td><Td align="right"><span className="whitespace-nowrap">{formatNumber(session.ctaClicks)}人（{percent(session.ctaClicks, session.viewers)}）</span></Td></Tr>
          })}</tbody>
        </table>}
      </div>
      <div>
        <h3 className="text-ink text-sm font-semibold">日別の結果<HelpTip label="日別の結果の説明">サーバーの集計日（UTC）ごとに集計しています。参加とCTAはその日の人数、フォームは送信件数です。同じ人が複数の日に含まれることがあります。</HelpTip></h3>
        {analytics.daily.length === 0 ? <p className="text-ink-faint mt-2 text-xs">まだ日別のデータがありません。</p> : <table className="mt-2 w-full table-fixed">
          <colgroup><col className="w-1/4" /><col /><col /><col /><col /></colgroup>
          <thead><TableHeadRow><Th>日付</Th><Th align="right">申込</Th><Th align="right">参加</Th><Th align="right">CTA</Th><Th align="right">送信</Th></TableHeadRow></thead>
          <tbody>{analytics.daily.map((day) => <Tr key={day.date}><Td><span className="block truncate text-xs" title={day.date}>{day.date}</span></Td><Td align="right">{formatNumber(day.reservations)}</Td><Td align="right">{formatNumber(day.viewers)}</Td><Td align="right">{formatNumber(day.ctaClicks)}</Td><Td align="right">{formatNumber(day.formSubmissions)}</Td></Tr>)}</tbody>
        </table>}
      </div>
      <div>
        <h3 className="text-ink text-sm font-semibold">フォームの到達<HelpTip label="フォームの到達の説明">CTAの表示から送信まで、計測開始後の人数です。同じ友だちは各段で1人と数えます。主なグラフの全期間の数字とは集計範囲が異なります。項目ごとの到達人数も確認できます。</HelpTip></h3>
        {funnel ? <>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              ['CTA表示', funnel.ctaImpressions], ['CTAを押した', funnel.ctaClicks], ['フォームを開いた', funnel.formOpens],
              ['入力を始めた', funnel.formStarts], ['送信を試みた', funnel.submitAttempts], ['送信できた', funnel.submitSuccesses], ['送信エラー', funnel.submitErrors],
            ].map(([label, value]) => <div key={label}><dt className="text-ink-secondary">{label}</dt><dd className="text-ink mt-1 font-semibold tabular-nums">{formatNumber(Number(value))}人</dd></div>)}
          </dl>
          {funnel.fieldCompletions.length > 0 ? <table className="mt-3 w-full table-fixed"><colgroup><col /><col className="w-1/4" /></colgroup><thead><TableHeadRow><Th>項目</Th><Th align="right">到達人数</Th></TableHeadRow></thead><tbody>{funnel.fieldCompletions.map((field) => <Tr key={field.fieldName}><Td><span className="block truncate" title={field.fieldName}>{field.fieldName}</span></Td><Td align="right">{formatNumber(field.users)}人</Td></Tr>)}</tbody></table> : null}
        </> : <p className="text-ink-faint mt-2 text-xs">フォームの集計を取得できていません。</p>}
      </div>
    </div>
  </Disclosure>
}
