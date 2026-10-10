import type { ReactNode } from 'react'
import { Th } from './table'
import { FolderDotName, type FolderDotFolder } from './folder-dot'
import styles from './distribution-table.module.css'

export function DistributionTable({ selectAll, children }: { selectAll: ReactNode; children: ReactNode }) {
  return <div className={styles.tableBox} data-pencil-name="配布の表">
    <table className={styles.table}>
      <colgroup><col className={styles.colCheck} /><col /><col className={styles.colItem} /><col className={styles.colVersion} /><col className={styles.colMode} /></colgroup>
      <thead><tr><Th>{selectAll}</Th><Th>アカウント</Th><Th>項目</Th><Th>配布先の版</Th><Th>配布方法</Th></tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}

export function DistributionProgress({ finished, total, action, children }: { finished: number; total: number; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.progressPanel} aria-label="配布の進み具合">
    <div className={styles.progressHeader}><h2>配布の進み具合</h2>{action}</div>
    <div className={styles.progressRow}><div className={styles.progressTrack}><span className={styles.progressFill} style={{ width: `${total ? Math.min(100, finished / total * 100) : 0}%` }} /></div><span>{finished} / {total}</span></div>
    {children}
  </section>
}

export function DistributionToolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>
}

export function DistributionAccountName({ name, note, htmlFor, folder }: { name: string; note: string; htmlFor: string; folder?: FolderDotFolder | null }) {
  return <label className={styles.nameLabel} htmlFor={htmlFor}>
    <span className={styles.nameLine}><FolderDotName folder={folder}><span className={styles.name} title={name}>{name}</span></FolderDotName></span>
    <span className={styles.sub}>{note}</span>
  </label>
}
