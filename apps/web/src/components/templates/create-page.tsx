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
  footerActions: ReactNode
  destructive?: ReactNode
  status?: ReactNode
}
export function CreatePage({ boardId, standalone, children, preview, previewToggle, footerActions, destructive, status, ...heading }: CreatePageProps) {
  return <PageFrame kind="create" boardId={boardId} standalone={standalone} hasFooter>
    <PageHeading {...heading} />
    {previewToggle ? <div className={styles.asideToggle}>{previewToggle}</div> : null}
    <div className={styles.split} data-template-region="body">
      <div className={styles.createContent} data-template-region="content">{children}</div>
      {preview ? <aside className={styles.preview} data-template-region="preview"><div className={styles.previewContent}>{preview}</div></aside> : null}
    </div>
    <div className={styles.footer} data-template-region="footer"><StickyBar actions={footerActions} destructive={destructive} status={status} /></div>
  </PageFrame>
}
