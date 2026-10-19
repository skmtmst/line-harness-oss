'use client'

import { PageExplanationProvider, PageExplanationToggle, PageExplanationBody } from '@/components/shared/page-explanation'
import type { ReactNode } from 'react'
import PreviewLauncher from './preview-launcher'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface SettingsPageProps extends PageHeadingProps {
  heightMode?: 'viewport' | 'content'
  /** 板ごとの寸法。画面CSSから型の領域を上書きしない。 */
  layout?: 'accounts' | 'account-detail' | 'account-handover' | 'wide-nav' | 'narrow-nav' | 'customer-look'
  preview?: ReactNode
  /** 設定本文の中にカードの見本を並べる。狭い板では開く口へ移す。 */
  previewLayout?: 'cards'
  boardId?: string; standalone?: boolean; navigation: ReactNode; children: ReactNode
  /** 変更があるときだけ渡す。保存口を頭に重ねない。 */
  saveActions?: ReactNode; saveStatus?: ReactNode
  /** 設定の一覧・詳細の広い本文。既定の設定フォームの寸法は保つ。 */
  contentLayout?: 'wide' | 'account-detail' | 'account-handover'
  /** 保存の帯を本文幅に置く。省略時は板全体の下。 */
  savePlacement?: 'content'
  /** 板の頭の下・中のメニューより上に置く帯（競合の帯など。）。帯の段の余白で置く。 */
  notice?: ReactNode
}
export function SettingsPage({ boardId, heightMode, standalone, layout, navigation, children, saveActions, saveStatus, contentLayout, savePlacement, preview, previewLayout, explanation, explanationKey, titleAccessory, notice, ...heading }: SettingsPageProps) {
  const footer = saveActions ? <div className={styles.footer} style={savePlacement === 'content' ? { marginBlock: 0 } : undefined} data-template-region="footer"><StickyBar actions={saveActions} status={saveStatus} /></div> : null
  const page = <PageFrame kind="settings" heightMode={heightMode} layout={layout} boardId={boardId} standalone={standalone} hasFooter={!!saveActions}>
    <PageHeading {...heading} titleAccessory={titleAccessory} explanationToggle={explanation ? <PageExplanationToggle /> : undefined} />
    {notice ? <div className={styles.createNotice} data-template-region="notice" data-notice-spacing="band">{notice}</div> : null}
    <div className={styles.settings} data-template-region="body" data-content-layout={contentLayout}>
      <nav aria-label="この設定の目次" className={styles.settingsNav} data-template-region="navigation">{navigation}</nav>
      <div className={styles.settingsContent} data-template-region="content" data-content-layout={contentLayout}>{explanation ? <PageExplanationBody keepMounted>{explanation}</PageExplanationBody> : null}{preview ? <div className={styles.asideToggle}><PreviewLauncher title="プレビュー" label="プレビューを開く">{preview}</PreviewLauncher></div> : null}{preview ? <div className={styles.customerLookSplit} data-preview-layout={previewLayout}><div className={styles.customerLookMain}>{children}</div><aside className={styles.customerLookPreview} aria-label="プレビュー">{preview}</aside></div> : children}{savePlacement === 'content' ? footer : null}</div>
    </div>
    {savePlacement === 'content' ? null : footer}
  </PageFrame>
  return explanation ? <PageExplanationProvider pageKey={explanationKey ?? `settings:${typeof heading.title === 'string' ? heading.title : boardId ?? 'screen'}`}>{page}</PageExplanationProvider> : page
}
