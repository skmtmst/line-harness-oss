'use client'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { DetailColumns } from '@/components/templates/detail-columns'
import Card from '@/components/shared/card'
import DeltaChip from '@/components/shared/delta-chip'
import HelpTip from '@/components/shared/help-tip'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import ListState, { ListEmptyMessage } from '@/components/shared/list-state'
import { RowMenu } from '@/components/shared/row-actions'
import SegmentedControl from '@/components/shared/segmented'
import StatusBadge from '@/components/shared/status-badge'
import type { StyleAnalytics } from './model'
import { SideCard } from './parts'
import styles from './style-dashboard.module.css'

/*
 * 「分析」のタブ（KcRVI 飲食・hqQLV サロン・UTxFu 面談・tMIuZ 教室）。
 * 小タブ → 数のカード 6 → 日ごとのグラフ（この期間と前の期間）→ 切り口の表｜右：内訳のカード。
 * 売上（料金×確定数）と入金額（オンライン）は別の数。「出せない」は 0 と別。
 */
export function StyleAnalyticsView({ data, error, onTab, onRetry, onRowOpen }: {
  data: StyleAnalytics | null
  error: boolean
  onTab: (tab: string) => void
  onRetry: () => void
  onRowOpen: (id: string) => void
}) {
  if (error) return <ListState kind="error" title="分析を読み込めませんでした" onRetry={onRetry} />
  if (!data) return <ListState kind="loading" />
  const { chart, table } = data
  return (
    <DetailColumns variant="style-dashboard" asideLabel="内訳" expanded showToggle={false} onExpandedChange={() => {}} aside={<>
        {data.side.map((card) => (
          <SideCard key={card.id} card={{ ...card, rows: card.bars || card.split ? [] : card.rows }} canWrite={false}>
            {card.split ? <span className={styles.split}><i style={{ inlineSize: `${Math.round(card.split.ratio * 100)}%` }} /></span> : null}
            {card.split ? card.rows.map((row) => <span key={row.label} className={styles.sideRow}><span className={styles.sideLabel}>{row.label}</span><span className={styles.grow} /><strong className={styles.sideValue}>{row.value}</strong></span>) : null}
            {card.bars?.map((b) => (
              <span key={b.label} className={styles.barRow}><span className={styles.sideRow}><span className={styles.sideLabel}>{b.label}</span><span className={styles.grow} /><strong className={styles.sideValue}>{b.value}</strong></span><span className={styles.split}><i style={{ inlineSize: `${Math.round(b.ratio * 100)}%` }} /></span></span>
            ))}
            {card.note ? <p className={styles.cardNote}>{card.note}</p> : null}
          </SideCard>
        ))}
      </>}>
        <SegmentedControl aria-label="分析の切り口" appearance="track" size="small" fit="content" value={data.tab} onChange={onTab} options={data.tabs.map((t) => ({ value: t.id, label: t.label }))} />
        {data.availability ? <ListState kind={data.availability.kind === 'forbidden' ? 'forbidden' : 'empty'} title={data.availability.description} description="ほかの分析の切り口は、上の切り替えから確認できます。" /> : <div className={styles.metricGrid}>
          {data.cards.map((c) => (
            <Card key={c.id} className={styles.metricCard} contentPadding="var(--polish-space-field) var(--polish-space-card)" gap="var(--tpl-sd-metric-gap)" aria-label={c.title}>
              <span className={styles.metricHead}>{c.title}<HelpTip label={`${c.title}の説明`}>{c.help}</HelpTip></span>
              <span className={styles.metricValue}><strong>{c.valueText}</strong>{c.unit ? <span>{c.unit}</span> : null}</span>
              {c.delta ? <span><DeltaChip tone={c.delta.tone}>{c.delta.text}</DeltaChip></span> : null}
            </Card>
          ))}
        </div>}
        {!data.availability && (chart ? <Card className={styles.chartCard} contentPadding="var(--polish-space-card)" gap="var(--polish-space-field)" aria-label={chart.title}>
          <h3 className={styles.sectionTitle}>{chart.title}<HelpTip label={`${chart.title}の説明`}>{chart.help}</HelpTip></h3>
          <span className={styles.calLegend}><i data-k="now" />この期間{chart.points.some((p) => p.prev > 0) ? <><i data-k="prev" />前の期間</> : null}</span>
          <div className={styles.pairChart} role="img" aria-label={`${chart.title}のグラフ`}>
            <div className={styles.pairTicks}>{chart.ticks.map((t) => <span key={t}>{t}</span>)}</div>
            <div className={styles.pairPlot}>
              {chart.points.map((p) => (
                <span key={p.label} className={styles.pairGroup} title={`${p.label}：この期間 ${p.now}・前の期間 ${p.prev}`}>
                  <i data-k="prev" style={{ blockSize: `${Math.round((p.prev / chart.max) * 100)}%` }} />
                  <i data-k="now" style={{ blockSize: `${Math.round((p.now / chart.max) * 100)}%` }} />
                </span>
              ))}
            </div>
            <div className={styles.pairAxis}>{chart.axis.map((a) => <span key={a}>{a}</span>)}</div>
          </div>
        </Card> : <ListEmptyMessage>日別の支払いグラフは、この画面ではまだ取得していません。</ListEmptyMessage>)}
        {!data.availability && (table ? <Card className={styles.chartCard} contentPadding="var(--polish-space-card)" gap="var(--polish-space-field)" aria-label={table.title}>
          <h3 className={styles.sectionTitle}>{table.title}<HelpTip label={`${table.title}の説明`}>{table.help}</HelpTip><span className={styles.grow} />{table.link ? <Link className={styles.sideLink} href={table.link.href}>{table.link.label}<ArrowRight size={14} aria-hidden="true" /></Link> : null}</h3>
          <GridTable label={table.title} presentation="metrics" framed={false} design={{
            columns: `minmax(0, 1fr) repeat(${table.columns.length - 1}, auto) auto`,
            gap: 'var(--polish-space-field)', rowPadding: 'var(--polish-space-card)',
            rowHeight: 'var(--tpl-sd-row-h)', headHeight: 'var(--tpl-sd-head-h)', fontSize: 'var(--text-body)',
          }}>
            <GridHeadRow>
              <GridCell role="columnheader">{table.columns[0]?.label}</GridCell>
              {table.columns.slice(1).map((c) => <GridCell key={c.label} role="columnheader" align={c.align}>{c.label}</GridCell>)}
              <GridCell aria-hidden="true" />
            </GridHeadRow>
            {table.rows.map((r) => (
              <GridRow key={r.id}>
                <GridCell><strong className={styles.cellStrong}>{r.name}</strong><span className={styles.cellSub}>{r.sub}</span></GridCell>
                {r.cells.map((c, i) => (
                  <GridCell key={i} align={table.columns[i + 1]?.align}>
                    {c.badge ? <span><StatusBadge tone={c.badge.tone}>{c.badge.label}</StatusBadge></span> : <span className={styles.cellText}>{c.text}</span>}
                    {c.note ? <span className={styles.cellSub}>{c.note}</span> : null}
                  </GridCell>
                ))}
                <GridCell align="right"><RowMenu appearance="box" size="row" label={`${r.name}の操作`} items={[{ id: 'open', label: '内訳を開く', onSelect: () => onRowOpen(r.id) }]} /></GridCell>
              </GridRow>
            ))}
          </GridTable>
          {table.note ? <p className={styles.listNote}>{table.note}</p> : null}
        </Card> : <ListEmptyMessage>期間内の支払い明細は、この画面ではまだ取得していません。</ListEmptyMessage>)}
    </DetailColumns>
  )
}
