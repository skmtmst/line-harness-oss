import type { ReactNode } from 'react'
import { PageFrame } from './page-frame'
import styles from './hours-workspace-frame.module.css'

export default function HoursWorkspaceFrame({ context, children }: { context: ReactNode; children: ReactNode }) {
 return <div className={styles.workspace} data-google-hours-page><div className={styles.context}>{context}</div><div className={styles.board}><PageFrame kind="list" boardId="tYbl8" standalone>{children}</PageFrame></div></div>
}
