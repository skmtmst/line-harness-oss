'use client'

import { type ActionMenuItem } from '@/components/shared/action-menu'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import BulkBar from '@/components/shared/bulk-bar'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ContextMenu,{ type ContextMenuItem } from '@/components/shared/context-menu'
import DetailPanel from '@/components/shared/detail-panel'
import EmptyList from '@/components/shared/empty-list'
import { emptyValue } from '@/components/shared/empty-value'
import { type FolderDotFolder } from '@/components/shared/folder-dot'
import ListState from '@/components/shared/list-state'
import ReorderHandle from '@/components/shared/reorder-handle'
import { RowMenu } from '@/components/shared/row-actions'
import { RovingTbody } from '@/components/shared/row-roving'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import StatusBadge from '@/components/shared/status-badge'
import SharedStatusPill from '@/components/shared/status-pill'
import { DataTable,NameCell,RowNameLink,TableHeadRow,Td,Th,Tr } from '@/components/shared/table'
import TagOverflow from '@/components/shared/tag-overflow'
import TruncatedText from '@/components/shared/truncated-text'
import { withViewTransition } from '@/components/shared/view-transition'
import { formatNumber } from '@/lib/format'
import { Folder as FolderIcon,MessageSquare,Play,Square } from 'lucide-react'
import type { Dispatch,JSX,SetStateAction } from 'react'
import { actionSummary,AutoReply,displayName,PendingToggle,TemplateLite } from './list-model'
import { type SortKey } from './list-options'
import styles from './list.module.css'
import { conditionChips,LOAD_STATE_WORDS,responseTypeWord,stopNote,templateWord,triggerSummary,type LoadState } from './words'

type RenderAutoReplyListContext = {
  allOnPageSelected: boolean
  canEdit: boolean
  clearFilters: () => void
  clearSelection: () => void
  dragId: string | null
  dropOn: (targetId: string) => void
  duplicateFeedback: { highlightedId: string | null; clear(): void; mark(sourceId: string, copyId: string): void; order<T extends { id: string; }>(rows: readonly T[], allRows?: readonly T[]): readonly T[]; }
  filterActive: boolean
  folderDotOf: (r: { folderId: string | null; }) => FolderDotFolder | null
  goEdit: (id: string) => void
  items: AutoReply[]
  keyboardMove: (id: string, direction: -1 | 1) => void
  liveOrder: { shown: readonly AutoReply[]; overId: string | null; enter: (id: string) => void; dropTarget: (fallback: string) => string; reset: () => void; }
  load: () => Promise<void>
  loadError: unknown
  loadingSkeleton: JSX.Element
  moveNotice: string
  narrow: boolean
  openMenuId: string | null
  openMove: (ids: string[]) => void
  panelId: string | null
  panelIndex: number
  panelRow: AutoReply | null
  requestDelete: (r: AutoReply) => void
  resumableIds: string[]
  router: ReturnType<typeof import('@/components/shared/list-navigation').useListNavigationRouter>
  rowContextItems: (r: AutoReply) => ContextMenuItem[]
  rowMenuItems: (r: AutoReply) => ActionMenuItem[]
  runDuplicate: (duplicateTarget: AutoReply) => Promise<void>
  runToggle: (target?: PendingToggle | null) => void
  selectedAccountId: string | null
  selectedCount: number
  selectedIds: Set<string>
  setConflictOnly: (next: boolean) => void
  setDragId: Dispatch<SetStateAction<string | null>>
  setDuplicateError: (message: string | null) => void
  setOpenMenuId: Dispatch<SetStateAction<string | null>>
  setPage: (next: number) => void
  setPanelId: Dispatch<SetStateAction<string | null>>
  setPendingToggle: Dispatch<SetStateAction<PendingToggle | null>>
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  setToggleError: Dispatch<SetStateAction<string>>
  setToggleReason: Dispatch<SetStateAction<string>>
  sortedItems: AutoReply[]
  sortKey: SortKey
  stoppableIds: string[]
  tableHeadCells: JSX.Element
  templateById: Map<string, TemplateLite>
  templateListAvailable: boolean
  toggleAllOnPage: () => void
  toggleFromPanel: (r: AutoReply) => void
  toggleOne: (id: string) => void
  visibleLoadState: LoadState
}

export function renderAutoReplyList({ allOnPageSelected, canEdit, clearFilters, clearSelection, dragId, dropOn, duplicateFeedback, filterActive, folderDotOf, goEdit, items, keyboardMove, liveOrder, load, loadError, loadingSkeleton, moveNotice, narrow, openMenuId, openMove, panelId, panelIndex, panelRow, requestDelete, resumableIds, router, rowContextItems, rowMenuItems, runDuplicate, runToggle, selectedAccountId, selectedCount, selectedIds, setConflictOnly, setDragId, setDuplicateError, setOpenMenuId, setPage, setPanelId, setPendingToggle, setSelectedIds, setToggleError, setToggleReason, sortedItems, sortKey, stoppableIds, tableHeadCells, templateById, templateListAvailable, toggleAllOnPage, toggleFromPanel, toggleOne, visibleLoadState }: RenderAutoReplyListContext) {
  return (visibleLoadState === 'loading' ? (
    <div className={styles.tableWrap} aria-busy="true" aria-label="読み込んでいます">
      <DelayedSkeleton loading skeleton={loadingSkeleton} />
    </div>
  ) : visibleLoadState === 'error' || visibleLoadState === 'forbidden' ? (
    <ListState kind="error" title={visibleLoadState === 'forbidden' ? LOAD_STATE_WORDS.forbidden.label : '自動応答を読み込めませんでした'} description={visibleLoadState === 'forbidden'
          ? LOAD_STATE_WORDS.forbidden.note
          : isForbiddenOrRateLimited(loadError)
            ? LOAD_STATE_WORDS.error.note
            : '登録したルールは消えていません。数の帯は「—」、道具はそのまま使えます（条件を変えてから試し直せる）。'} data-design-node="G8i4xP" action={<>{visibleLoadState === 'error' && (
        <Button type="button" onClick={() => load()} busyLabel="処理中…">もう一度読み込む</Button>
      )}</>} />
  ) : sortedItems.length === 0 ? (
    /* 修正案 D-2：空の一覧。閲覧のみには作るボタンを出さない。 */
    <EmptyList
      data-design-node="G8i4xP"
      icon={<MessageSquare aria-hidden="true" />}
      title="まだ自動応答のルールはありません"
      description="よく届く質問や営業時間外の連絡に、自動で返せます。ひな形からも作れます。"
      create={{ label: 'ルールを作る', onClick: () => router.push('/auto-replies/edit') }}
      canCreate={canEdit}
      filtered={filterActive}
      onClearFilters={clearFilters}
      filteredTitle="条件に合うルールはありません"
      filteredDescription="「停止中のみ」「時間帯あり」「今月0回」や検索を外すと、すべて出ます"
    />
  ) : (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {moveNotice}
      </span>
      <div className={narrow ? `${styles.tableWrap} ${styles.narrowTable}` : styles.tableWrap} data-content-in="">
        <DataTable>
          <colgroup>
            {/* ★V8 列の幅＝絵の中身の幅＋欄の間16。端の列は端の24も足す（uE9gf：選ぶ16・つまみ14・返すもの200・回数96・状態60・操作28） */}
            {/* 閲覧のみは選ぶ・つまみの列を置かない（押せない物は隠す）。名前の列が表の左端から始まる（Q5lOCc）。 */}
            {canEdit ? <col style={{ width: 16 + 24 + 8 }} /> : null}
            {canEdit ? <col style={{ width: 14 + 16 }} /> : null}
            {!narrow ? <col style={{ width: canEdit ? 426 : 426 + (16 + 24 + 8) + (14 + 16) }} /> : <col />}
            <col style={{ width: 200 + 16 }} />
            {!narrow && <col style={{ width: 96 + 16 }} />}
            <col style={{ width: 80 + 16 }} />
            <col style={{ width: 28 + 8 + 24 }} />
          </colgroup>
          <thead>
            <TableHeadRow>
                {canEdit ? <Th className={styles.selectCell} aria-label="選択">
                  <SaveErrorField names={["allOnPageSelected","all_on_page_selected"]}><Checkbox
                    checked={allOnPageSelected}
                    indeterminate={!allOnPageSelected && selectedCount > 0}
                    onCheckedChange={() => toggleAllOnPage()}
                    aria-label="このページのルールをすべて選択"
                  /></SaveErrorField>
                </Th> : null}
              {tableHeadCells}
            </TableHeadRow>
          </thead>
          <RovingTbody reorderKey={duplicateFeedback.order(liveOrder.shown, items).map((r) => r.id).join(',')}>
            {duplicateFeedback.order(liveOrder.shown, items).map((r, saveFieldIndex) => {
              const name = displayName(r)
              const conflicts = r.conflictAttentionCount ?? 0
              const actions = actionSummary(r)
              const tpl = templateWord(
                r.templateId,
                templateById.get(r.templateId ?? '')?.name ?? null,
                templateListAvailable,
              )
              return (
                <Tr interactive
                  key={r.id}
                    selected={selectedIds.has(r.id)}
                  data-reorder-id={r.id}
                  onDragEnter={() => liveOrder.enter(r.id)}
                  onDragOver={dragId ? (event) => event.preventDefault() : undefined}
                  onDrop={dragId ? () => dropOn(liveOrder.dropTarget(r.id)) : undefined}
                  className={styles.rowClick}
                  tabIndex={0}
                  detailKey="reply" onOpen={() => setPanelId(panelId === r.id ? null : r.id)}
                   data-row-id={r.id}
                >
                    {canEdit ? <><Td className={styles.selectCell}>
                      <SaveErrorField names={[`shown.${saveFieldIndex}.id`,"id","r.id"]}><Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                        aria-label={`${name}を選択`}
                      /></SaveErrorField>
                    </Td>
                  <Td
                    className={styles.gripCell}
                    onClick={(event) => event.stopPropagation()}
                    draggable={canEdit && sortKey === 'priority'}
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    {canEdit && <ReorderHandle
                      label={name}
                      disabledReason={sortKey !== 'priority' ? '並びを「評価順」にすると動かせます' : null}
                      onMove={(direction) => keyboardMove(r.id, direction)}
                    >
                      <span aria-hidden>⠿</span>
                    </ReorderHandle>}
                  </Td></> : null}
                  <NameCell name={<div className={styles.nameRow}>
                      <>
                        {canEdit ? <RowNameLink
                          href={`/auto-replies/edit?id=${r.id}`}

                          className={styles.cellTitle}
                          onClick={(event) => {
                            event.stopPropagation()

                          }}
                        >
                          <TruncatedText value={String(name ?? '')} />
                        </RowNameLink> : <button type="button" className={styles.cellTitle} title={name} onClick={(event) => { event.stopPropagation(); setPanelId(r.id) }}>{name}</button>}
                      </>

                    </div>} folder={folderDotOf(r)}
                  />
                  <Td className={styles.middleCell}>
                    {/* 絵 uE9gf：1行目「テキストで返す」／「テンプレート『〇〇』」、2行目「＋対応マーク・担当者へ通知」／「なし」。 */}
                    <span className={styles.cellMain} title={tpl.linked ? tpl.note : responseTypeWord(r.responseType).note}>
                      {r.responseType === 'silent'
                        ? '返信しない'
                        : tpl.linked
                          ? `テンプレート「${tpl.label}」`
                          : `${responseTypeWord(r.responseType).label}で返す`}
                    </span>
                    <span className={styles.cellSub} title={actions.join('・') || emptyValue('none')}>
                      {actions.length > 0 ? `＋${actions.join('・')}` : emptyValue('none')}
                    </span>
                  </Td>
                  {!narrow && (
                    <Td
                      className={styles.countCell}
                      title={`今月 ${r.hits?.period ?? emptyValue('unknown')}回 ／ 累計 ${r.hits?.total ?? emptyValue('unknown')}回`}
                    >
                      {/* 数えられていないものを 0 と書かない。0 は「当たらなかった」の意味。 */}
                      <div className={styles.countMain}>{r.hits?.period ?? emptyValue('unknown')}<span className={styles.kpiUnit}>回</span></div>
                      <div className={styles.countSub}>{`累計 ${r.hits?.total == null ? emptyValue('unknown') : formatNumber(r.hits.total)}回`}</div>
                    </Td>
                  )}
                  <Td>
                    <SharedStatusPill tone={r.isActive ? 'success' : 'neutral'} title={stopNote(r) ?? undefined}>{r.isActive ? '有効' : '停止中'}</SharedStatusPill>
                      {conflicts > 0 && (
                        <button
                          type="button"
                          className={styles.miniBadgeWarn}
                          title="同じ受信に先に当たるルールがあります。押すと重なりのあるルールだけを表示します"
                          onClick={(event) => {
                            event.stopPropagation()
                            setConflictOnly(true)
                            setPage(1)
                          }}
                        >
                          <StatusBadge tone="warning">{`重なり ${conflicts}`}</StatusBadge>
                        </button>
                      )}
                    {!r.isActive && r.stopReason && (
                      <p className={styles.stateSub} style={{ maxWidth: 140 }} title={stopNote(r) ?? ''}>
                        {r.stopReason}
                      </p>
                    )}
                  </Td>
                    <Td className={styles.menuCell} data-design-node={openMenuId === r.id ? 'IIesG' : undefined}>
                      {/* 横並びにして、メニューの位置の目印（空の span）が行を1段増やさないようにする。 */}
                      <ContextMenu
                        label={`自動応答「${name}」の操作`}
                        items={rowContextItems(r)}
                      >
                        <div className={styles.menuBox}>
                        <RowMenu
                          label={`自動応答「${name}」の操作`}
                          items={rowMenuItems(r)}
                          open={openMenuId === r.id}
                          onOpenChange={(next) => setOpenMenuId(next ? r.id : null)}
                        />
                        </div>
                      </ContextMenu>
                    </Td>
                </Tr>
              )
            })}
          </RovingTbody>
        </DataTable>
      </div>

      {/* 行の詳細パネル（V8「サクサク感」C①・E）。一覧は左に見えたまま。 */}
      {panelRow &&
        (() => {
          const name = displayName(panelRow)
          const trigger = triggerSummary(panelRow)
          const canToggle = panelRow.isActive || panelRow.lifecycleStatus !== 'draft'
          return (
            <DetailPanel
              open
              title={name}
              description={trigger.text}
              onClose={() => setPanelId(null)}
              onPrev={panelIndex > 0 ? () => setPanelId(items[panelIndex - 1].id) : undefined}
              onNext={
                panelIndex < items.length - 1 ? () => setPanelId(items[panelIndex + 1].id) : undefined
              }
              hasPrev={panelIndex > 0}
              hasNext={panelIndex < items.length - 1}
              footer={
                <>
                  {canEdit && <Button variant="primary" onClick={() => goEdit(panelRow.id)}>
                    開く
                  </Button>}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      withViewTransition(() => {
                        router.push(`/auto-replies/runs?id=${panelRow.id}`)
                      })
                    }
                   busyLabel="移動中…">
                    実行結果を見る
                  </Button>
                  {canEdit && <Button
                    variant="secondary"
                    onClick={() => {
                      setDuplicateError('')
                      void runDuplicate(panelRow)
                      setPanelId(null)
                    }}
                  >
                    複製する
                  </Button>}
                  {canEdit && canToggle && (
                    <Button
                      variant="secondary"
                      onClick={() => toggleFromPanel(panelRow)}
                    >
                      {panelRow.isActive ? '止める' : '再開する'}
                    </Button>
                  )}
                  {canEdit && <Button
                    variant="secondary"
                    onClick={() => {
                      setPanelId(null)
                      requestDelete(panelRow)
                    }}
                  >
                    削除する
                  </Button>}
                </>
              }
            >
              <p title={trigger.title}>{trigger.text}</p>
              <TagOverflow label="すべての応答条件">{conditionChips(panelRow).map((label) => <span key={label} className={styles.condChip} title={label}>{label}</span>)}</TagOverflow>
              <p>
                {panelRow.isActive ? '有効' : '停止中'} ／ 今月 {panelRow.hits?.period ?? emptyValue('unknown')}回 ／
                累計 {panelRow.hits?.total ?? emptyValue('unknown')}回
              </p>
            </DetailPanel>
          )
        })()}

      {/* まとめての帯（選ぶと表の下に出る）：止める・再開・フォルダへ移す。 */}
      {canEdit && selectedCount > 0 ? (
        <BulkBar count={selectedCount} total={sortedItems.length} onSelectAll={() => setSelectedIds(new Set(sortedItems.map(item => item.id)))} onClear={clearSelection}><Button
            type="button"
            variant="secondary"
            disabled={stoppableIds.length === 0}
            title={stoppableIds.length === 0 ? '動いているルールが選ばれていません' : undefined}
            onClick={() => {
              setToggleError('')
              setToggleReason('')
              setPendingToggle({ ids: stoppableIds, names: [], kind: 'stop', accountId: selectedAccountId })
            }}
          >
            <Square size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            まとめて止める
          </Button><Button
            type="button"
            variant="secondary"
            disabled={resumableIds.length === 0}
            title={resumableIds.length === 0 ? '停止中のルールが選ばれていません' : undefined}
            onClick={() => {
              setToggleError('')
              runToggle({ ids: resumableIds, names: [], kind: 'resume', accountId: selectedAccountId })
            }}
          >
            <Play size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            まとめて再開
          </Button><Button
            type="button"
            variant="secondary"
            onClick={() => openMove([...selectedIds])}
          >
            <FolderIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -1 }} />
            フォルダへ移す
          </Button><Button type="button" variant="secondary" onClick={() => setSelectedIds(new Set())}>
            選択を外す
          </Button></BulkBar>
      ) : null}
    </>
  ))
}
