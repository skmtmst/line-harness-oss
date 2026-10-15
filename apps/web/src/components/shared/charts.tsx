'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { barChartTicks } from './bar-chart'
import styles from './charts.module.css'
export const CHART_COLORS = { primary: 'var(--color-accent-deep)', secondary: 'var(--color-ink-faint)' } as const
export function chartNumber(value: number | null, unit = '') { return value === null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('ja-JP')}${unit}` }
export function chartDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${Number(value.slice(5,7))}/${Number(value.slice(8,10))}` : value }
export type ChartPoint = { key: string; label: string; value: number | null; note?: string; emphasis?: boolean }
export function ValueBarChart({ items, label, unit = '', presentation = 'standard' }: { items: ChartPoint[]; label: string; unit?: string; presentation?: 'standard' | 'summary' }) {
 const columnsRef = useRef<HTMLDivElement>(null)
 const [labelStep, setLabelStep] = useState(1)
 useEffect(() => {
  const columns = columnsRef.current
  if (!columns) return
  const measure = () => {
   const width = columns.getBoundingClientRect().width
   if (!width || !items.length) return
   const axis = columns.querySelector<HTMLElement>('[data-chart-axis]')
   const fontSize = axis ? Number.parseFloat(getComputedStyle(axis).fontSize) || 11 : 11
   const gap = Number.parseFloat(getComputedStyle(columns).columnGap) || 0
   const longest = Math.max(...items.map(item => chartDate(item.label).length)) * fontSize
   setLabelStep(Math.max(1, Math.ceil((longest + gap) / ((width + gap) / items.length))))
  }
  measure()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(columns)
  void document.fonts?.ready.then(measure)
  return () => observer?.disconnect()
 }, [items])
 const max = Math.max(1,...items.map(p=>p.value ?? 0)); const ticks = barChartTicks(max); const top=ticks.at(-1) || 1
 return <div className={styles.root} role="group" aria-label={label}>
  <div className={styles.plot} data-presentation={presentation}>{presentation === 'standard' && ticks.map(tick=><span className={styles.grid} key={tick} style={{bottom:`${tick/top*100}%`}} aria-hidden="true"><span>{chartNumber(tick,unit)}</span></span>)}
   <div ref={columnsRef} className={styles.columns} data-dense={items.length > 14 || undefined}>{items.map((item,index)=><div className={styles.column} key={item.key}><button type="button" className={styles.hit} aria-label={`${item.label} ${chartNumber(item.value,unit)}${item.note ? `・${item.note}`:''}`}><span className={styles.bar} style={{height:`${Math.max(0,item.value??0)/top*100}%`,background:presentation === 'summary' && !item.emphasis ? 'var(--color-accent)' : CHART_COLORS.primary}}/><span className={styles.tooltip}>{item.label} {chartNumber(item.value,unit)}{item.note}</span></button><span className={styles.axis} data-chart-axis data-axis-edge={items.length > 1 ? index === 0 ? 'first' : index === items.length - 1 ? 'last' : undefined : undefined} hidden={index !== 0 && index !== items.length - 1 && (index % labelStep !== 0 || items.length - 1 - index < labelStep)}>{chartDate(item.label)}</span></div>)}</div>
  </div>
 </div>
}
export function FunnelChart({ items, label, unit = '人', selectedKey, onSelect, disabled, numbered = true }: { items: (ChartPoint & {detail?: ReactNode})[]; label: string; unit?: string; selectedKey?: string; onSelect?: (key:string)=>void; disabled?: boolean; numbered?: boolean }) {
 const top = Math.max(1,...items.map(i=>i.value??0))
 return <div className={styles.funnel} role="group" aria-label={label}>{items.map((item,i)=><button type="button" className={styles.funnelRow} data-part="funnel-row" key={item.key} disabled={disabled} onClick={()=>onSelect?.(item.key)} aria-pressed={onSelect ? item.key===selectedKey:undefined} aria-label={`${item.label} ${chartNumber(item.value,unit)}${item.note?`・${item.note}`:''}`} title={item.note}>{numbered ? <span>{i+1}</span> : null}<span className={styles.label} title={item.label}>{item.label}</span><span className={styles.track} aria-hidden="true"><span className={styles.funnelBar} style={{width:`${Math.max(0,item.value??0)/top*100}%`}}/></span><span>{chartNumber(item.value,unit)}</span>{item.detail}</button>)}</div>
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

/**
 * 横棒（絵 v0SbYR「集まった回答」）：名前120・細い棒（全体に占める割合）・数と割合。
 * 行は押せない読み物なので、枠の付いた箱にしない。total を渡さなければ並べた数の合計を全体にする。
 */
export function HorizontalBarChart({ items, label, unit = '件', total }: { items: ChartPoint[]; label: string; unit?: string; total?: number }) {
 const whole = Math.max(1, total ?? items.reduce((sum, item) => sum + Math.max(0, item.value ?? 0), 0))
 return <div className={styles.hbar} role="group" aria-label={label}>{items.map(item => {
  const share = Math.round(Math.max(0, item.value ?? 0) / whole * 100)
  const text = `${chartNumber(item.value, unit)}（${share}%）`
  return <div className={styles.hbarRow} key={item.key} role="group" aria-label={`${item.label} ${text}`}>
   <span className={styles.hbarLabel} title={item.label}>{item.label}</span>
   <span className={styles.hbarTrack} aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
   <span className={styles.hbarValue}>{text}</span>
  </div>
 })}</div>
}
