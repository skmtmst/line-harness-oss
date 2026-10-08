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
  /** 板の頭のすぐ下に、板の幅で置くタブの段（店のタブ。rm92Y）。一覧・詳細の型の tabs と同じ置き方。 */
  tabs?: ReactNode
  /**
   * 帯の置き場の余白。`'band'` は「帯の段」の絵（上 0・左右 24・下 8。h5rm8t・J1pdB ほかの競合の帯）。
   * 渡さなければ今までどおり（上下 12・左右 24。pvimJ）。
   */
  noticeSpacing?: 'band'
  /**
   * 入力欄と右の列の余白の口。渡さなければ型の既定（入力欄 上下 24・左右 28・段の間 16、右の列 24）。
   * `'flush-top'` は板の頭のすぐ下から始める絵（両方とも上 4・左右 24・下 24、入力欄の段の間 28。
   * E-9 統括の一括配信 p17Qku）。画面の CSS で型の余白を上書きせず、ここで選ぶ。
   */
  contentSpacing?: 'flush-top'
  /** 右の列の地。`'plain'` は地の色を敷かない（E-9 p17Qku）。渡さなければ表の頭と同じ地。 */
  previewSurface?: 'plain'
  footerActions: ReactNode
  /** 枠のある下部の帯を描く板だけで使う。StickyBar の既定は変えない。 */
  footerOutlined?: boolean
  destructive?: ReactNode
  status?: ReactNode
}
export function CreatePage({ boardId, standalone, children, preview, previewToggle, previewCompactWhenNarrow, notice, tabs, noticeSpacing, contentSpacing, previewSurface, footerActions, footerOutlined, destructive, status, ...heading }: CreatePageProps) {
  return <PageFrame kind="create" boardId={boardId} standalone={standalone} hasFooter>
    <PageHeading {...heading} />
    {tabs ? <div className={styles.tabs} data-template-region="tabs">{tabs}</div> : null}
    {notice ? <div className={styles.createNotice} data-template-region="notice" data-notice-spacing={noticeSpacing}>{notice}</div> : null}
    {previewToggle ? <div className={styles.asideToggle}>{previewToggle}</div> : null}
    <div className={styles.split} data-template-region="body">
      <div className={styles.createContent} data-template-region="content" data-content-spacing={contentSpacing}>{children}</div>
      {preview ? <aside className={styles.preview} data-template-region="preview" data-preview-narrow={previewCompactWhenNarrow ? 'compact' : undefined} data-content-spacing={contentSpacing} data-preview-surface={previewSurface}><div className={styles.previewContent}>{preview}</div></aside> : null}
    </div>
    <div className={styles.footer} data-template-region="footer"><StickyBar actions={footerActions} outlined={footerOutlined} destructive={destructive} status={status} /></div>
  </PageFrame>
}
