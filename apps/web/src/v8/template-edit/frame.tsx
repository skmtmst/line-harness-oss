'use client'

/*
 * テンプレートの作る・編集の外枠。作る型（CreatePage）と同じ板の頭・左右の列・
 * 下の帯を、型の部品（PageFrame・PageHeading）と型の CSS で組む。
 * 型に無いのは1つだけ：頭のすぐ下の「帯の段」（絵 NCbYn の競合の帯）。
 */
import type { ReactNode } from 'react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import tpl from '@/components/templates/page-templates.module.css'
import StickyBar from '@/components/shared/sticky-bar'
import styles from './edit.module.css'

export function TemplateEditFrame({
  boardId,
  title,
  description,
  band,
  children,
  side,
  footerActions,
  status,
}: {
  boardId: string
  title: string
  description: ReactNode
  band?: ReactNode
  children: ReactNode
  side: ReactNode
  /** 閲覧のみでは渡さない（押せない操作は置かない）。 */
  footerActions?: ReactNode
  /** 下の帯の左の文（下書きの自動保存の状態）。 */
  status?: ReactNode
}) {
  return (
    <PageFrame kind="create" boardId={boardId} hasFooter={Boolean(footerActions)}>
      {/* 板の頭に戻る（← テンプレートへ）は置かない。戻るのは上の帯のパンくずと下の帯の［キャンセル］（オーナー 2026-10-08）。 */}
      <PageHeading
        title={title}
        description={description}
      />
      {band ? <div className={styles.bandRow}>{band}</div> : null}
      <div className={tpl.split} data-template-region="body">
        <div className={tpl.createContent} data-template-region="content">{children}</div>
        <aside className={styles.side} data-template-region="preview">
          <div className={styles.sideContent}>{side}</div>
        </aside>
      </div>
      {footerActions ? (
        <div className={tpl.footer} data-template-region="footer"><StickyBar actions={footerActions} status={status} /></div>
      ) : null}
    </PageFrame>
  )
}
