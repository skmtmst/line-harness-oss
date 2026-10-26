import type { ReactNode } from 'react'
import styles from './empty-value.module.css'
export const EMPTY_VALUE_LABELS = { unknown: '—', unconfigured: '未設定', none: 'なし' } as const
export type EmptyValueKind = keyof typeof EMPTY_VALUE_LABELS
export function emptyValue(kind: EmptyValueKind): string { return EMPTY_VALUE_LABELS[kind] }
/**
 * 0とfalseは値として残す。空の意味は呼ぶ側が指定する。
 * 「—」は本当に値が無い時だけ（洗い出し 68）。空白だけの文字は値が無いと同じに扱い、
 * 値がある時は前後の空白を落としてそのまま出す（「— 2.6.4」のように空の印と値を並べない）。
 */
export function displayValue(value: string | number | boolean | null | undefined, kind: EmptyValueKind = 'unknown'): string {
 if (value === null || value === undefined) return emptyValue(kind)
 if (typeof value === 'string') return value.trim() === '' ? emptyValue(kind) : value.trim()
 return String(value)
}
export default function EmptyValue({kind,children}: {kind:EmptyValueKind;children?:ReactNode}) { return <>{children ?? emptyValue(kind)}</> }
/** 表・一覧の値の無い欄。どの表も薄い灰の「—」1つ（空を言葉で書かない）。字の大きさは置いた欄に合わせる。 */
export function EmptyCell() { return <span className={styles.empty} data-empty-value="">{emptyValue('unknown')}</span> }
