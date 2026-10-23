'use client'

import type { AccountWithStats } from '@/contexts/account-context'
import type { TemplatesListView } from '@/v8/templates/words'
import { isRichVideoTemplate } from './list-model'


import AccountRequiredState from '@/components/shared/account-required-state'
import { type ActionMenuItem } from '@/components/shared/action-menu'
import BulkBar from '@/components/shared/bulk-bar'
import Button from '@/components/shared/button'
import Checkbox,{ UnavailableSelection } from '@/components/shared/checkbox'
import ContextMenu,{ type ContextMenuItem } from '@/components/shared/context-menu'
import EmptyList from '@/components/shared/empty-list'
import { emptyValue } from '@/components/shared/empty-value'
import { folderDisplayColor,type FolderDotFolder } from '@/components/shared/folder-dot'
import ListDateTime from '@/components/shared/list-date-time'
import Link from '@/components/shared/list-navigation'
import ListState from '@/components/shared/list-state'
import { RowMenu } from '@/components/shared/row-actions'
import { RovingTbody } from '@/components/shared/row-roving'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable,NameCell,RowNameLink,TableHeadRow,Td,Th,Tr } from '@/components/shared/table'
import TagPill from '@/components/shared/tag-pill'
import TruncatedText from '@/components/shared/truncated-text'
import { formatListTimestamp,formatNumber } from '@/lib/format'
import { FileText,Folder as FolderIcon,Trash2 } from 'lucide-react'
import type { Dispatch,SetStateAction } from 'react'
import { Template,excerptOf,publishStateOf,sendCountText } from './list-model'
import styles from './list.module.css'
import { messageTypeText,type TemplatesFailure } from './words'

type RenderTemplateListContext = {
  accountLoading: boolean
  accounts: AccountWithStats[]
  activeId: string | null
  allOnPageSelected: boolean
  bulkDeleting: boolean
  canMutateTemplates: boolean
  clearFilters: () => void
  clearSelection: () => void
  contextMenuItems: ContextMenuItem[]
  contextTemplate: Template | null
  detailHref: (t: Template) => string
  duplicateFeedback: { highlightedId: string | null; clear(): void; mark(sourceId: string, copyId: string): void; order<T extends { id: string; }>(rows: readonly T[], allRows?: readonly T[]): readonly T[]; }
  failure: TemplatesFailure | null
  filterActive: boolean
  filteredTemplates: Template[]
  folderDotOf: (t: { folderId: string | null; }) => FolderDotFolder | null
  load: () => Promise<void>
  moving: boolean
  narrow: boolean
  openMenuId: string | null
  openMove: (ids: string[]) => void
  openPicker: () => void
  removableSelected: Template[]
  rowMenuItems: (t: Template) => ActionMenuItem[]
  sectionWord: "リッチビデオのテンプレート" | "質問のテンプレート" | "メッセージのテンプレート"
  selectedAccountId: string | null
  selectedCount: number
  selectedIds: Set<string>
  setActiveId: Dispatch<SetStateAction<string | null>>
  setBulkDeleteError: Dispatch<SetStateAction<string>>
  setContextId: Dispatch<SetStateAction<string | null>>
  setOpenMenuId: Dispatch<SetStateAction<string | null>>
  setPendingBulkDelete: Dispatch<SetStateAction<Template[] | null>>
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  shownItems: Template[]
  templates: Template[]
  toggleAllOnPage: () => void
  toggleOne: (id: string) => void
  usedSelectedCount: number
  view: TemplatesListView
}

export function renderTemplateList({ accountLoading, accounts, activeId, allOnPageSelected, bulkDeleting, canMutateTemplates, clearFilters, clearSelection, contextMenuItems, contextTemplate, detailHref, duplicateFeedback, failure, filterActive, filteredTemplates, folderDotOf, load, moving, narrow, openMenuId, openMove, openPicker, removableSelected, rowMenuItems, sectionWord, selectedAccountId, selectedCount, selectedIds, setActiveId, setBulkDeleteError, setContextId, setOpenMenuId, setPendingBulkDelete, setSelectedIds, shownItems, templates, toggleAllOnPage, toggleOne, usedSelectedCount, view }: RenderTemplateListContext) {
  return (accountLoading || view === 'loading' ? (
    <div className={styles.skeletonRows} aria-label="読み込み中" data-design-node="susGP">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonRow} aria-hidden="true">
          <span className={styles.skeletonDot} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
          <span className={styles.skeletonBar} />
        </div>
      ))}
    </div>
  ) : !selectedAccountId ? (
    <AccountRequiredState hasAccounts={accounts.length > 0}   icon={<FileText size={18} aria-hidden="true" />} />
  ) : view === 'forbidden' || view === 'error' ? (
    <ListState kind="error" title={view === 'forbidden' ? (failure?.title ?? '見る権限がありません') : 'テンプレートを読み込めませんでした'} description={view === 'forbidden'
          ? (failure?.description ?? '')
          : '登録したテンプレートは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。'} data-design-node="susGP" action={<>{view === 'error' && (
        <Button type="button" onClick={() => load()} busyLabel="処理中…">もう一度読み込む</Button>
      )}</>} />
  ) : filteredTemplates.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      data-design-node="susGP"
      icon={<FileText aria-hidden="true" />}
      title={`まだ${sectionWord}がありません`}
      description="よく送る文を保存しておくと、一斉配信・自動応答・シナリオから選べます。"
      create={{ label: '最初のテンプレートを作る', onClick: openPicker }}
      canCreate={canMutateTemplates}
      filtered={filterActive}
      onClearFilters={clearFilters}
      filteredDescription="「1通のみ」「差し込みあり」「使っていない」や検索を外すと、すべて出ます"
    />
  ) : (
    <>
      <ContextMenu
        label={contextTemplate ? `テンプレート「${contextTemplate.name}」の操作` : 'テンプレートの操作'}
        items={contextMenuItems}
        shouldOpen={(event) => Boolean((event.target as HTMLElement | null)?.closest?.('tr[data-row-id]'))}
      >
        <div className={styles.tableWrap}>
          <DataTable presentation="template-list" columnSizing="content">
            <colgroup>
              <col className={styles.colSelect} />
              <col />
              <col className={styles.colKind} />
              <col className={styles.colPublish} />
              {!narrow && <col className={styles.colUsage} />}
              {!narrow && <col className={styles.colMonthly} />}
              {!narrow && <col className={styles.colUpdated} />}
              <col className={styles.colMenu} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th className={styles.selectCell} aria-label="選択">
                  {/* 閲覧のみ：対象外の枠と理由だけを残す（差し戻しH）。 */}
                  {canMutateTemplates ? (<SaveErrorField names={["allOnPageSelected","all_on_page_selected"]}><Checkbox
                      checked={allOnPageSelected}
                      indeterminate={!allOnPageSelected && selectedCount > 0}
                      onCheckedChange={() => toggleAllOnPage()}
                      aria-label="このページのテンプレートをすべて選択"
                    /></SaveErrorField>) : <UnavailableSelection label="このページのテンプレートをすべて選択" />}
                </Th>
                <Th className={styles.headCell}>テンプレート</Th>
                <Th className={styles.headCell}>種類</Th>
                <Th className={styles.headCell}>公開</Th>
                {!narrow && <Th className={styles.headCell}>使っている所</Th>}
                {!narrow && <Th className={styles.headCell}>今月送った数</Th>}
                {!narrow && <Th className={styles.headCell}>更新</Th>}
                <Th aria-label="操作" />
              </TableHeadRow>
            </thead>
            <RovingTbody>
              {duplicateFeedback.order(shownItems, templates).map((t, saveFieldIndex) => {
                const publish = publishStateOf(t)
                const kindLabel = t.question ? 'question' : t.messageType
                const folder = folderDotOf(t)
                const excerpt = excerptOf(t)
                return (
                  <Tr
                    interactive
                    key={t.id}
                    selected={selectedIds.has(t.id)}
                    data-row-id={t.id}
                    className={styles.rowClick}
                    tabIndex={0}
                    detailKey="row" onOpen={() => setActiveId(activeId === t.id ? null : t.id)}
                    onContextMenuCapture={() => setContextId(t.id)}

                  >
                    <Td className={styles.selectCell}>
                      {canMutateTemplates ? (<SaveErrorField names={[`shownItems.${saveFieldIndex}.id`,"id","t.id"]}><Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleOne(t.id)}
                          aria-label={`「${t.name}」を選択`}
                        /></SaveErrorField>) : <UnavailableSelection label={`「${t.name}」を選択`} />}
                    </Td>
                    <NameCell name={
                        <div className={styles.dotLine}>
                          <>
                            <RowNameLink href={detailHref(t)} title={t.name} className={styles.cellTitle} onClick={(event) => event.stopPropagation()}>
                              <TruncatedText value={String(t.name ?? '')} />
                            </RowNameLink>
                          </>
                        </div>
                      } folder={folder}
                      annotation={String(t.name ?? '').startsWith('【見本】') ? <StatusBadge tone="neutral" dot>見本</StatusBadge> : undefined}
                    />
                    <Td>
                      <TagPill name={isRichVideoTemplate(t) ? 'リッチビデオ' : messageTypeText(kindLabel)} color={folder ? folderDisplayColor(folder) : undefined} aria-label={`種類：${isRichVideoTemplate(t) ? 'リッチビデオ' : messageTypeText(kindLabel)}`} />
                    </Td>
                    <Td>
                      <StatusBadge tone={publish.tone === 'live' ? 'success' : publish.tone === 'changes' ? 'warning' : 'neutral'}>
                        {publish.label}
                      </StatusBadge>
                    </Td>
                    {!narrow && (
                      <Td>
                        {typeof t.usageCount !== 'number' ? (
                          <span className={styles.cellFaint}>使っている所を確認できません</span>
                        ) : t.usageCount === 0 ? (
                          <span className={styles.cellFaint}>{emptyValue('none')}</span>
                        ) : (
                          <Link href={detailHref(t)} className={styles.usageLink} onClick={(event) => event.stopPropagation()}>
                            {`${formatNumber(t.usageCount)}か所`}
                          </Link>
                        )}
                      </Td>
                    )}
                    {!narrow && (
                      <Td
                        className={styles.cellPlain}
                        title={typeof t.totalSendCount === 'number' ? `累計 ${formatNumber(t.totalSendCount)} 通` : undefined}
                      >
                        {sendCountText(t)}
                      </Td>
                    )}
                    {!narrow && (
                      <Td className={styles.cellPlain} title={formatListTimestamp(t.updatedAt)}>
                        <ListDateTime value={t.updatedAt} />
                      </Td>
                    )}
                    <Td className={styles.menuCell}>
                      {/* 横並びにして、メニューの位置の目印が行を1段増やさないようにする。 */}
                      <div className={styles.menuBox}>
                        <RowMenu
                          label={`テンプレート「${t.name}」の操作`}
                          items={rowMenuItems(t)}
                          open={openMenuId === t.id}
                          onOpenChange={(next) => setOpenMenuId(next ? t.id : null)}
                        />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </RovingTbody>
          </DataTable>
        </div>
      </ContextMenu>

      {/* まとめての帯（選ぶと表の下に出る）：フォルダへ移す・まとめて削除。 */}
      {canMutateTemplates && selectedCount > 0 ? (
        <BulkBar count={selectedCount} total={filteredTemplates.length} onSelectAll={() => setSelectedIds(new Set(filteredTemplates.map(item => item.id)))} onClear={clearSelection}><Button
            type="button"
            variant="secondary"
            disabled={moving}
            onClick={() => openMove([...selectedIds])}
          >
            <FolderIcon size={13} aria-hidden="true" />
            フォルダへ移す
          </Button><Button
            type="button"
            variant="secondary"
            disabled={bulkDeleting || removableSelected.length === 0}
            title={
              usedSelectedCount > 0
                ? '使っているテンプレートが選ばれています。先に使用先を差し替えてください'
                : undefined
            }
            onClick={() => {
              setBulkDeleteError('')
              setPendingBulkDelete(removableSelected)
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            まとめて削除
          </Button><Button type="button" variant="secondary" onClick={() => setSelectedIds(new Set())}>
            選択を外す
          </Button></BulkBar>
      ) : null}
    </>
  ))
}
