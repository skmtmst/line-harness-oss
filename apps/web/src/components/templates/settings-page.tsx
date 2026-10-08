import type { ReactNode } from 'react'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface SettingsPageProps extends PageHeadingProps {
  boardId?: string; standalone?: boolean; navigation: ReactNode; children: ReactNode
  /** 変更があるときだけ渡す。保存口を頭に重ねない。 */
  saveActions?: ReactNode; saveStatus?: ReactNode
  /** 保存の帯を本文幅に置く。省略時は板全体の下。 */
  savePlacement?: 'content'
}
export function SettingsPage({ boardId, standalone, navigation, children, saveActions, saveStatus, savePlacement, ...heading }: SettingsPageProps) {
  const footer = saveActions ? <div className={styles.footer} style={savePlacement === 'content' ? { marginBlock: 0 } : undefined} data-template-region="footer"><StickyBar actions={saveActions} status={saveStatus} /></div> : null
  return <PageFrame kind="settings" boardId={boardId} standalone={standalone} hasFooter={!!saveActions}>
    <PageHeading {...heading} />
    <div className={styles.settings} data-template-region="body">
      <nav aria-label="この設定の目次" className={styles.settingsNav} data-template-region="navigation">{navigation}</nav>
      <div className={styles.settingsContent} data-template-region="content">{children}{savePlacement === 'content' ? footer : null}</div>
    </div>
    {savePlacement === 'content' ? null : footer}
  </PageFrame>
}
