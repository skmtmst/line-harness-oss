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
    {choices.map(choice => <Card key={choice.key} layout="vertical" padding="compact" gap="tight" className={styles.card}>
      <a href={choice.href} className={styles.link} aria-describedby={`${id}-${choice.key}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onChoose(choice.href)
      }}>
        <span className={styles.icon} aria-hidden="true">{choice.icon}</span>
        <span className={styles.title} title={choice.title}>{choice.title}</span>
      </a>
      <div id={`${id}-${choice.key}`} className={styles.body}>
        <p className={styles.description} role="note">{choice.description}</p>
        <div className={styles.notes}>{choice.notes.map(note => <small key={note}>{note}</small>)}</div>
      </div>
    </Card>)}
  </div>
}
