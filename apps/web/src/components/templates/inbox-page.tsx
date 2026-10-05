import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
export interface InboxPageProps {
  boardId?: string; standalone?: boolean; heading?: PageHeadingProps
  list: ReactNode; conversationHeader?: ReactNode; children: ReactNode; composer: ReactNode
  summary?: ReactNode; summaryToggle?: ReactNode
}
export function InboxPage({ boardId, standalone, heading, list, conversationHeader, children, composer, summary, summaryToggle }: InboxPageProps) {
  return <PageFrame kind="inbox" boardId={boardId} standalone={standalone}>
    {heading ? <PageHeading {...heading} /> : null}
    {summaryToggle ? <div className={styles.asideToggle}>{summaryToggle}</div> : null}
    <div className={styles.inbox} data-template-region="body">
      <div className={styles.inboxList} data-template-region="list">{list}</div>
      <div className={styles.conversation} data-template-region="conversation">
        {conversationHeader}<div className={styles.messages}>{children}</div><div className={styles.composer}>{composer}</div>
      </div>
      {summary ? <aside className={styles.inboxSummary} data-template-region="summary">{summary}</aside> : null}
    </div>
  </PageFrame>
}
