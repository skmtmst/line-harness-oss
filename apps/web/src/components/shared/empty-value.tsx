import type { ReactNode } from 'react'
import styles from './empty-value.module.css'
export const EMPTY_VALUE_LABELS = { unknown: '—', unconfigured: '未設定', none: 'なし' } as const
export type EmptyValueKind = keyof typeof EMPTY_VALUE_LABELS
export function emptyValue(kind: EmptyValueKind): string { return EMPTY_VALUE_LABELS[kind] }
/** 0とfalseは値として残す。空の意味は呼ぶ側が指定する。 */
export function displayValue(value: string | number | boolean | null | undefined, kind: EmptyValueKind = 'unknown'): string {
 return value === null || value === undefined || value === '' ? emptyValue(kind) : String(value)
}
export default function EmptyValue({kind,children}: {kind:EmptyValueKind;children?:ReactNode}) { return <>{children ?? emptyValue(kind)}</> }
/** 表・一覧の値の無い欄。どの表も薄い灰の「—」1つ（空を言葉で書かない）。字の大きさは置いた欄に合わせる。 */
export function EmptyCell() { return <span className={styles.empty} data-empty-value="">{emptyValue('unknown')}</span> }
