import type { ReactNode } from 'react'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from './table'
import { FolderDotName, type FolderDotFolder } from './folder-dot'
import styles from './resource-table.module.css'

export interface ResourceTableRow {
  id: string; name: ReactNode; summary: string; folder?: FolderDotFolder | null;
  references: ReactNode; updated: ReactNode; destinations: ReactNode; actions?: ReactNode;
}
/** 統括のひな形：参照先と配布先を見てから配る。 */
export default function ResourceTable({ rows, canEdit, updatedLabel = '更新日時' }: { rows: ResourceTableRow[]; canEdit: boolean; updatedLabel?: string }) {
  return <DataTable>
    <colgroup><col /><col className={styles.references} /><col className={styles.updated} /><col className={styles.destinations} />{canEdit ? <col className={styles.actions} /> : null}</colgroup>
    <thead><TableHeadRow><Th>名前</Th><Th>参照先</Th><Th>{updatedLabel}</Th><Th>配布先</Th>{canEdit ? <Th aria-label="操作" /> : null}</TableHeadRow></thead>
    <tbody>{rows.map(row => <Tr key={row.id} density="template">
      <NameCell name={row.name} folder={row.folder} />
      <Td>{row.references}<span className={styles.summary}>{row.summary}</span></Td><Td>{row.updated}</Td><Td>{row.destinations}</Td>
      {canEdit ? <Td>{row.actions}</Td> : null}
    </Tr>)}</tbody>
  </DataTable>
}
