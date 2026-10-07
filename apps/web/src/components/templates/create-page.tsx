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
  /** 板の頭のすぐ下に、入力欄と右の列の両方にまたがる幅で置く帯（同時編集の知らせなど。pvimJ）。 */
  notice?: ReactNode
  /**
   * 帯の置き場の余白。`'band'` は「帯の段」の絵（上 0・左右 24・下 8。h5rm8t・J1pdB ほかの競合の帯）。
   * 渡さなければ今までどおり（上下 12・左右 24。pvimJ）。
   */
  noticeSpacing?: 'band'
  footerActions: ReactNode
  destructive?: ReactNode
  status?: ReactNode
}
export function CreatePage({ boardId, standalone, children, preview, previewToggle, notice, noticeSpacing, footerActions, destructive, status, ...heading }: CreatePageProps) {
  return <PageFrame kind="create" boardId={boardId} standalone={standalone} hasFooter>
    <PageHeading {...heading} />
    {notice ? <div className={styles.createNotice} data-template-region="notice" data-notice-spacing={noticeSpacing}>{notice}</div> : null}
    {previewToggle ? <div className={styles.asideToggle}>{previewToggle}</div> : null}
    <div className={styles.split} data-template-region="body">
      <div className={styles.createContent} data-template-region="content">{children}</div>
      {preview ? <aside className={styles.preview} data-template-region="preview"><div className={styles.previewContent}>{preview}</div></aside> : null}
    </div>
    <div className={styles.footer} data-template-region="footer"><StickyBar actions={footerActions} destructive={destructive} status={status} /></div>
  </PageFrame>
}
