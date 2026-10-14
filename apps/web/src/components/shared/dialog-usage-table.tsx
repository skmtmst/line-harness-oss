'use client'

import Button from './button'
import { ListFolderContext } from './list-folder-context'
import { DataTable, NameCell, Td, Tr } from './table'
import TruncatedText from './truncated-text'

export interface DialogUsageRow {
  key: string
  kind: string
  name: string
  href: string | null
}

/** 使用先の一覧は、種類・名前・開く操作の順で示す。 */
export default function DialogUsageTable({ rows }: { rows: readonly DialogUsageRow[] }) {
  return <ListFolderContext.Provider value={false}>
    <DataTable label="使っている所" columnLayout={{
      headHeight: 'auto', rowHeight: 'auto', gap: 'var(--polish-space-field)',
      padding: 'var(--tpl-eds-dialog-row-pad)', bodyTextSize: 'var(--text-label)',
    }}><tbody>{rows.map(row => <Tr key={row.key} data-table-layout="columns">
      <Td style={{ flex: '0 0 var(--tpl-eds-kind-w)' }}><TruncatedText value={row.kind} /></Td>
      <NameCell grow name={row.name} />
      <Td>{row.href
        ? <Button variant="text" external href={row.href}>開いて差し替える</Button>
        : <span>開ける画面がありません</span>}
      </Td>
    </Tr>)}</tbody></DataTable>
  </ListFolderContext.Provider>
}
