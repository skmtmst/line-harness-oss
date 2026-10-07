import type { ReactNode } from 'react'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'

export interface CreatePageProps extends PageHeadingProps {
  boardId?: string
  standalone?: boolean
  children: ReactNode
  preview?: ReactNode
  /** 狭い板でプレビューを開くボタン・パネルは画面が持つ。 */
  previewToggle?: ReactNode
  /** ★V8：狭い板（白い板 1100 未満）で右の列の余白を 16 に詰める（絵 kmTab）。渡さなければ今までどおり 24。 */
  previewCompactWhenNarrow?: boolean
  /** 板の頭のすぐ下に、入力欄と右の列の両方にまたがる幅で置く帯（同時編集の知らせなど。pvimJ）。 */
  notice?: ReactNode
  footerActions: ReactNode
  destructive?: ReactNode
  status?: ReactNode
}
export function CreatePage({ boardId, standalone, children, preview, previewToggle, previewCompactWhenNarrow, notice, footerActions, destructive, status, ...heading }: CreatePageProps) {
  return <PageFrame kind="create" boardId={boardId} standalone={standalone} hasFooter>
    <PageHeading {...heading} />
    {notice ? <div className={styles.createNotice} data-template-region="notice">{notice}</div> : null}
    {previewToggle ? <div className={styles.asideToggle}>{previewToggle}</div> : null}
    <div className={styles.split} data-template-region="body">
      <div className={styles.createContent} data-template-region="content">{children}</div>
      {preview ? <aside className={styles.preview} data-template-region="preview" data-preview-narrow={previewCompactWhenNarrow ? 'compact' : undefined}><div className={styles.previewContent}>{preview}</div></aside> : null}
    </div>
    <div className={styles.footer} data-template-region="footer"><StickyBar actions={footerActions} destructive={destructive} status={status} /></div>
  </PageFrame>
}
