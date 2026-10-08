import type { ReactNode } from 'react'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface SettingsPageProps extends PageHeadingProps {
  boardId?: string; standalone?: boolean; navigation: ReactNode; children: ReactNode
  /** 変更があるときだけ渡す。保存口を頭に重ねない。 */
  saveActions?: ReactNode; saveStatus?: ReactNode
  /** 設定の一覧・詳細の広い本文。既定の設定フォームの寸法は保つ。 */
  contentLayout?: 'wide' | 'account-detail' | 'account-handover'
}
export function SettingsPage({ boardId, standalone, navigation, children, saveActions, saveStatus, contentLayout, ...heading }: SettingsPageProps) {
  return <PageFrame kind="settings" boardId={boardId} standalone={standalone} hasFooter={!!saveActions}>
    <PageHeading {...heading} />
    <div className={styles.settings} data-template-region="body" data-content-layout={contentLayout}>
      <nav aria-label="この設定の目次" className={styles.settingsNav} data-template-region="navigation">{navigation}</nav>
      <div className={styles.settingsContent} data-template-region="content" data-content-layout={contentLayout}>{children}</div>
    </div>
    {saveActions ? <div className={styles.footer} data-template-region="footer"><StickyBar actions={saveActions} status={saveStatus} /></div> : null}
  </PageFrame>
}
