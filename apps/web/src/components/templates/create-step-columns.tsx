'use client'

import type { HTMLAttributes, ReactNode } from 'react'
import PreviewLauncher from './preview-launcher'
import styles from './create-step-columns.module.css'

/** 手順の入力を保ち、狭い板の補足だけを同じ内容の窓へ畳む。
 *  outline は左の細い列（正本 v06 ②の「AC左 操作ステップ」）。渡さない画面は今までどおり2列。 */
export function CreateStepColumns({ children, outline, outlineTitle, preview, previewTitle, standalone = false, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'className'> & { outline?: ReactNode; outlineTitle?: string; preview: ReactNode; previewTitle: string; standalone?: boolean }) {
  const columns = <div {...props} className={styles.columns} data-part="create-step-columns">
    {outline ? <aside className={styles.outline} aria-label={outlineTitle} data-template-region="outline">{outline}</aside> : null}
    <div className={styles.content} data-template-region="content">{children}</div>
    <aside className={styles.preview} aria-label={previewTitle} data-template-region="preview">{preview}</aside>
    <div className={styles.toggle}><PreviewLauncher title={previewTitle} label={`${previewTitle}を見る`}>{preview}</PreviewLauncher></div>
  </div>
  return standalone ? <div className={styles.standalone}>{columns}</div> : columns
}
