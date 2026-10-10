import type { ReactNode } from 'react'
import styles from './form-section.module.css'

/** 設定フォームの段（gjUz3・hiBO8）。説明は題の下、操作は右に置く。 */
export default function FormSection({ title, id, description, children, action }: {
  title: string; id: string; description?: ReactNode; children: ReactNode; action?: ReactNode
}) {
  return <section className={styles.section} aria-labelledby={id}>
    <div className={styles.header}>
      <div className={styles.heading}>
        <h2 id={id} className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
}
