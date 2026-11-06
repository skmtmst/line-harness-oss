'use client'

import type { ButtonHTMLAttributes } from 'react'
import styles from './seat-tile.module.css'

/** 卓の選択と時間帯の利用状況。同じ卓の印を2画面で共有する。 */
export default function SeatTile({ code, label, capacity, joinGroup, stopped, occupied, selected, presentation = 'map', ...props }: {
  code: string; label?: string; capacity: string; joinGroup?: string | null
  stopped?: boolean; occupied?: boolean; selected?: boolean
  presentation?: 'map' | 'occupancy'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const body = <>
    <span className={presentation === 'map' ? styles.code : styles.name}>{code}</span>
    {label ? <span className={styles.label}>{label}</span> : null}
    <span className={presentation === 'map' ? styles.capacity : styles.seats}>{capacity}</span>
    {joinGroup ? <span className={styles.join}>{`結合 ${joinGroup}`}</span> : null}
  </>
  return presentation === 'map'
    ? <button {...props} type="button" className={`${styles.tile} ${styles.map} ${joinGroup ? styles.joined : ''} ${stopped ? styles.stopped : ''} ${occupied ? styles.occupied : ''}`} aria-pressed={selected}>{body}</button>
    : <div className={`${styles.tile} ${styles.occupancy} ${joinGroup ? styles.joined : ''} ${stopped ? styles.stopped : ''} ${occupied ? styles.occupied : ''}`} aria-label={props['aria-label']}>{body}</div>
}
