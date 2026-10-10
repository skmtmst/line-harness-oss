'use client'
import type { ReactNode } from 'react'
import { barChartTicks } from './bar-chart'
import styles from './charts.module.css'
export const CHART_COLORS = { primary: 'var(--color-accent-deep)', secondary: 'var(--color-ink-faint)' } as const
export function chartNumber(value: number | null, unit = '') { return value === null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('ja-JP')}${unit}` }
export function chartDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${Number(value.slice(5,7))}/${Number(value.slice(8,10))}` : value }
export type ChartPoint = { key: string; label: string; value: number | null; note?: string }
export function ValueBarChart({ items, label, unit = '' }: { items: ChartPoint[]; label: string; unit?: string }) {
 const max = Math.max(1,...items.map(p=>p.value ?? 0)); const ticks = barChartTicks(max); const top=ticks.at(-1) || 1
 return <div className={styles.root} role="group" aria-label={label}>
  <div className={styles.plot}>{ticks.map(tick=><span className={styles.grid} key={tick} style={{bottom:`${tick/top*100}%`}} aria-hidden="true"><span>{chartNumber(tick,unit)}</span></span>)}
   <div className={styles.columns}>{items.map(item=><div className={styles.column} key={item.key}><button type="button" className={styles.hit} aria-label={`${item.label} ${chartNumber(item.value,unit)}${item.note ? `・${item.note}`:''}`}><span className={styles.bar} style={{height:`${Math.max(0,item.value??0)/top*100}%`,background:CHART_COLORS.primary}}/><span className={styles.tooltip}>{item.label} {chartNumber(item.value,unit)}{item.note}</span></button><span className={styles.axis}>{chartDate(item.label)}</span></div>)}</div>
  </div>
 </div>
}
export function FunnelChart({ items, label, unit = '人', selectedKey, onSelect, disabled, numbered = true }: { items: (ChartPoint & {detail?: ReactNode})[]; label: string; unit?: string; selectedKey?: string; onSelect?: (key:string)=>void; disabled?: boolean; numbered?: boolean }) {
 const top = Math.max(1,...items.map(i=>i.value??0))
 return <div className={styles.funnel} role="group" aria-label={label}>{items.map((item,i)=><button type="button" className={styles.funnelRow} key={item.key} disabled={disabled} onClick={()=>onSelect?.(item.key)} aria-pressed={onSelect ? item.key===selectedKey:undefined} aria-label={`${item.label} ${chartNumber(item.value,unit)}${item.note?`・${item.note}`:''}`} title={item.note}>{numbered ? <span>{i+1}</span> : null}<span className={styles.label} title={item.label}>{item.label}</span><span className={styles.track} aria-hidden="true"><span style={{width:`${Math.max(0,item.value??0)/top*100}%`,background:CHART_COLORS.primary}}/></span><span>{chartNumber(item.value,unit)}</span>{item.detail}</button>)}</div>
}
export function LineChart({ points, label, unit = '', maxX, maxY, marker }: { points: {x:number;value:number|null;label:string}[]; label:string; unit?:string; maxX?:number; maxY?:number; marker?:{x:number;label:string} }) {
 const topX=Math.max(1,maxX??0,...points.map(p=>p.x)); const topY=Math.max(1,maxY??0,...points.map(p=>p.value??0)); let gap=true
 const path=points.map(p=> { if(p.value===null){gap=true;return ''} const start=gap;gap=false;return `${start?'M':'L'}${p.x/topX*1000} ${100-Math.max(0,Math.min(topY,p.value))/topY*100}` }).join(' ')
 return <div className={styles.root} role="group" aria-label={label}><svg className={styles.line} viewBox="-80 -20 1100 150" role="img" aria-label={label}>
 {[0,topY/2,topY].map(t=><g key={t}><line x1="0" x2="1000" y1={100-t/topY*100} y2={100-t/topY*100} stroke="var(--color-hairline)"/><text x="-8" y={105-t/topY*100} textAnchor="end">{chartNumber(t,unit)}</text></g>)}
 <path d={path} fill="none" stroke={CHART_COLORS.primary} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
 {points.filter(p=>p.value!==null).map((p,i)=><circle key={i} cx={p.x/topX*1000} cy={100-Math.max(0,Math.min(topY,p.value??0))/topY*100} r="3" fill={CHART_COLORS.primary} tabIndex={0} aria-label={`${p.label} ${chartNumber(p.value,unit)}`}><title>{p.label} {chartNumber(p.value,unit)}</title></circle>)}
 {marker ? <g><line x1={marker.x/topX*1000} x2={marker.x/topX*1000} y1="0" y2="100" stroke={CHART_COLORS.secondary} strokeDasharray="4 4"/><text x={marker.x/topX*1000} y="-8">{marker.label}</text></g>:null}
 {points.length ? <><text x="0" y="125">{points[0].label}</text><text x="1000" y="125" textAnchor="end">{points.at(-1)?.label}</text></>:null}
 </svg></div>
}

export function HorizontalBarChart(props: Parameters<typeof FunnelChart>[0]) { return <FunnelChart {...props} numbered={false} /> }
