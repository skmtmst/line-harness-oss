'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import PreviewLauncher from './preview-launcher'
import styles from './create-step-columns.module.css'

/** 手順の入力を保ち、狭い板の補足だけを同じ内容の窓へ畳む。 */
export function CreateStepColumns({ children, preview, previewTitle, standalone = false, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'className'> & { preview: ReactNode; previewTitle: string; standalone?: boolean }) {
  const columns = <div {...props} className={styles.columns} data-part="create-step-columns">
    <div className={styles.content} data-template-region="content">{children}</div>
    <aside className={styles.preview} aria-label={previewTitle} data-template-region="preview">{preview}</aside>
    <div className={styles.toggle}><PreviewLauncher title={previewTitle} label={`${previewTitle}を見る`}>{preview}</PreviewLauncher></div>
  </div>
  return standalone ? <div className={styles.standalone}>{columns}</div> : columns
}
