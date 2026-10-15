'use client'

import type { FormBlock } from '@line-crm/shared'
import { ADD_GROUPS } from './model'
import { formKindIcon } from './block-icons'
import styles from './edit.module.css'

export default function AddGrid({ onAdd, hide }: { onAdd: (make: (count: number) => FormBlock) => void; hide?: ReadonlySet<string> }) {
  return (
    <div className={styles.addBox}>
      <p className={styles.addTitle}>ブロックを足す</p>
      {ADD_GROUPS.map((group) => (
        <div key={group.title} className={styles.addGroup}>
          <p className={styles.addGroupTitle}>{group.title}</p>
          <div className={styles.addCards} data-writing={group.title === '書いてもらう' || undefined}>
            {group.cards.filter((card) => !hide?.has(card.key)).map((card) => {
              const Icon = formKindIcon(card.key)
              return <button key={card.key} type="button" className={styles.addCard} data-fresh={card.fresh || undefined} onClick={() => onAdd(card.make)}>
                <span className={styles.addCardTop}>
                  <Icon size={15} aria-hidden="true" />
                  <span className={styles.addCardLabel}>{card.label}</span>
                  {card.fresh ? <span className={styles.newBadge}>新</span> : null}
                </span>
                <span className={styles.addCardHint} title={card.hint}>{card.hint}</span>
              </button>
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
