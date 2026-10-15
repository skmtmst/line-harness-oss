'use client'

import { useId, type ReactNode } from 'react'
import Card from './card'
import styles from './dialog-choice-cards.module.css'

export interface DialogChoice {
  key: string
  title: string
  icon: ReactNode
  description: string
  notes: string[]
  href: string
}

/** 作る種類を選んで、その作成画面へ進む窓のカード。 */
export default function DialogChoiceCards({ choices, onChoose, columns = 3 }: {
  choices: DialogChoice[]
  onChoose: (href: string) => void
  /** 1段に並べる枚数。7種類のテンプレート（I4jUUW）は 4。 */
  columns?: 3 | 4
}) {
  const id = useId()
  /* 高さは CSS（絵の 184）を下限に、グリッドの行でそろえる。共通の高さ合わせ（自然な高さ）は使わない。 */
  return <div className={styles.grid} data-dialog-choice-cards data-columns={columns} data-card-height="natural">
