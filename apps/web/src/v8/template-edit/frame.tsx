'use client'

/*
 * テンプレートの作る・編集の外枠。作る型（CreatePage）と同じ板の頭・左右の列・
 * 下の帯を、型の部品（PageFrame・PageHeading）と型の CSS で組む。
 * 型に無いのは1つだけ：頭のすぐ下の「帯の段」（絵 NCbYn の競合の帯）。
 */
import { useState, type ReactNode } from 'react'
import Drawer from '@/components/shared/drawer'
import HelpTip from '@/components/shared/help-tip'
import StatusBadge from '@/components/shared/status-badge'
import Checkbox from '@/components/shared/checkbox'
import Button from '@/components/shared/button'
import type { TemplateEditHost } from './host'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import tpl from '@/components/templates/page-templates.module.css'
import StickyBar from '@/components/shared/sticky-bar'
import styles from './edit.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'

export function TemplateEditFrame({
  boardId,
  title,
  description,
  band,
  children,
  side,
  footerActions,
  status,
  composerHost,
  onComposerInsert,
}: {
  onComposerInsert?: (alsoSave: boolean) => void
  composerHost?: TemplateEditHost
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
  const [alsoSave, setAlsoSave] = useState(false)
  if (composerHost?.composer) return <Drawer open dirty={false} width="composer" title={title} titleAccessory={<span className={styles.composerTitleAccessories}><HelpTip label="この画面の使い方">テンプレートと同じ編集画面です。作ったものをこの吹き出しに入れます。</HelpTip><StatusBadge tone="neutral" dot={false}>{`吹き出し ${composerHost.composer.index + 1} に入ります`}</StatusBadge></span>} onClose={composerHost.onCancel} busy={composerHost.busy} footer={<div className={styles.composerFooter}>
    {composerHost.composer.canSaveTemplate !== false ? <SaveErrorField names={["alsoSave","also_save"]}><Checkbox disabled={composerHost.busy} checked={alsoSave} onCheckedChange={setAlsoSave}>テンプレートとしても保存する</Checkbox></SaveErrorField> : <span />}
    <span className={styles.composerFooterActions}><Button disabled={composerHost.busy} onClick={composerHost.onCancel}>キャンセル</Button><Button variant="primary" disabled={composerHost.busy} busy={composerHost.busy} onClick={() => onComposerInsert?.(alsoSave)}>この吹き出しに入れる</Button></span>
  </div>}><div className={styles.composerSplit}><div className={styles.composerContent}>{band}{children}</div><aside className={styles.composerSide}>{side}</aside></div></Drawer>
  return (
    <PageFrame kind="create" boardId={boardId} hasFooter={Boolean(footerActions)}>
      {/* 板の頭に戻る（← テンプレートへ）は置かない。戻るのは上の帯のパンくずと下の帯の［キャンセル］（オーナー 2026-10-08）。 */}
      <PageHeading
        title={title}
        help={description}
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
