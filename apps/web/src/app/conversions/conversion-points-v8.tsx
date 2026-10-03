'use client'

/*
 * ★V8-B コンバージョンの一覧（Pencil「★V8-B 画面の地図」：一覧 `r6dJFy`、
 * 状態 `E2l8cw`、1152 `BygrU`、閲覧のみ `WSGvo`）。
 *
 * v7 の一覧（`page.tsx` 内の `ConversionsPageInner`）とは別の見せ方。
 * 取得・絞り込み・ページ送りの考え方は v7 と同じ（口へ渡す・画面で
 * 探し直さない）。数の帯は表の行の合計（この30日）と一致させる。
 * 止める操作は表の下の小窓（3択＋理由必須）で行い、共用の止める窓は
 * 開かない。編集・中身を見る・取消の窓は共用（`conversion-dialogs`）。
 *
 * 板との差（口が無いため）：フォルダは「すべて」だけ（成果地点に
 * フォルダの口が無い）。「よく使う絞り込み」は置かない。並び順は
 * v7 の既定（件数が多い順）のまま変えられない。月前半との比較は
 * 出さない（表の行の合計を正本にする）。
 */
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type {
  ConversionDefinitionDeleteImpact,
  ConversionDefinitionFilter,
  ConversionDefinitionListItem,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { deduplicationLabel } from './dedup'
import {
  STATE_LABELS,
  sourceTriggerLabel,
  usageLabel,
  type ConversionDetailDialogProps,
  type ConversionEditDialogProps,
  type ConversionReversalDialogProps,
  type ConversionStopAction,
} from './_components/conversion-dialogs'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListRange from '@/components/ui/list-range'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { RowActions } from '@/components/shared/row-actions'
import { TableHeadRow, Th } from '@/components/shared/table'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { inputClass } from '@/components/shared/form-controls'
import styles from './conversion-points-v8.module.css'

/** V8 の絞り込み。`all` を含む以外は v7 の `StatusFilter` と同じ。 */
export type ConversionPointsV8Status = 'all' | ConversionDefinitionFilter

export interface ConversionStateCounts {
  active: number
  draft: number
  stopped: number
  invalid: number
  sourceStopped: number
  unused: number
}

export interface ConversionPointsV8Model {
  loading: boolean
  loadFailed: boolean
  /** 読み込めた行（この30日・打ち切りあり）。 */
  points: ConversionDefinitionListItem[]
  /** 状態で絞った行（v7 と同じ絞り）。 */
  shown: ConversionDefinitionListItem[]
  total: number | null
  stateCounts: ConversionStateCounts | null
  listTruncated: boolean
  query: string
  onQueryChange: (value: string) => void
  status: ConversionPointsV8Status
  onStatusChange: (status: ConversionPointsV8Status) => void
  onReload: () => void
  onExportCsv: () => void
  exporting: boolean
  exportError: string
  highlightedId: string | null
  publishing: boolean
  onOpenDetail: (point: ConversionDefinitionListItem) => void
  onOpenEdit: (point: ConversionDefinitionListItem) => void
  onOpenStop: (point: ConversionDefinitionListItem, action: ConversionStopAction) => void
  onPublishDraft: (point: ConversionDefinitionListItem) => void
  stopTarget: ConversionDefinitionListItem | null
  stopImpact: ConversionDefinitionDeleteImpact | null
  stopImpactLoading: boolean
  stopAction: ConversionStopAction
  onStopActionChange: (action: ConversionStopAction) => void
  replacementId: string
  onReplacementIdChange: (id: string) => void
  stopReason: string
  onStopReasonChange: (reason: string) => void
  stopping: boolean
  stopError: string
  onConfirmStop: () => void
  onCancelStop: () => void
  detailDialog: ConversionDetailDialogProps
  editDialog: ConversionEditDialogProps
  reversalDialog: ConversionReversalDialogProps
  onIssueIngest: (point: ConversionDefinitionListItem) => void
  onToggleIngest: (point: ConversionDefinitionListItem) => void
  ingestBusy: '' | 'issue' | 'toggle'
  ingestError: string
  issuedSecret: string
  onClearIssuedSecret: () => void
}

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

const CHIPS: Array<{ value: ConversionPointsV8Status; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'active', label: '動いている' },
  { value: 'stopped', label: '止めている' },
  { value: 'draft', label: '下書き' },
  { value: 'invalid', label: '入力不良' },
  { value: 'sourceStopped', label: '起点停止' },
  { value: 'unused', label: 'どこからも使われていない' },
]

function chipCount(
  value: ConversionPointsV8Status,
  total: number | null,
  stateCounts: ConversionStateCounts | null,
): number | undefined {
  if (value === 'all') return total ?? undefined
  return stateCounts?.[value] ?? undefined
}

const PILL_CLASS: Record<ConversionDefinitionListItem['state'], string> = {
  active: styles.statePillActive,
  draft: styles.statePillDraft,
  invalid: styles.statePillInvalid,
  sourceStopped: styles.statePillSourceStopped,
  stopped: styles.statePillStopped,
}

/** 行の2行目（数え方・金額）。板 `r6dJFy` の2行目どおり。 */
function rowSub(point: ConversionDefinitionListItem): string {
  const dedup = deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)
  const amount = point.valueMode === 'source'
    ? '注文の金額'
    : point.valueMode === 'fixed'
      ? point.value == null ? '決まった金額（金額なし）' : `決まった金額¥${formatNumber(point.value)}`
      : '金額なし'
  const stopped = point.status === 'stopped' && point.stoppedAt
    ? `・止めた日 ${point.stoppedAt.slice(5, 7).replace(/^0/, '')}/${point.stoppedAt.slice(8, 10).replace(/^0/, '')}`
    : ''
  return `${dedup}・${amount}${stopped}`
}

const PAGE_SIZES = [20, 50, 100]

export default function ConversionPointsV8({ model }: { model: ConversionPointsV8Model }) {
  usePageTitle('コンバージョン')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const role = useStaffRole()
  // `WSGvo` 閲覧のみ：押せない形にする（隠さない）。
  const canEdit = canManageRole(role)
  const { selectedAccountId } = useAccount()
  // ページ送りは V8 側で持つ（v7 の100件固定と混ぜない）。
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // 表の下の詳細の小窓の相手。共用の詳細の窓（`detailTarget`）とは別。
  const [panelId, setPanelId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const pageCount = Math.max(1, Math.ceil(model.shown.length / pageSize))
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])
  useEffect(() => {
    setPage(1)
  }, [model.query, model.status, pageSize])
  const current = useMemo(
    () => model.shown.slice((page - 1) * pageSize, page * pageSize),
    [model.shown, page, pageSize],
  )
  const panelPoint = panelId ? model.points.find((point) => point.id === panelId) ?? null : null
  const highlightedPoint = model.highlightedId
    ? model.points.find((point) => point.id === model.highlightedId) ?? null
    : null
  // 鍵の平文は見せた相手が変わったら消す（別の行に見せない）。
  useEffect(() => {
    model.onClearIssuedSecret()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId])

  // 数の帯は表の行の合計（HANDOVER-MAP の指図どおり一致させる）。
  const totalCount = model.points.reduce((sum, point) => sum + point.metrics.netCount, 0)
  const totalValue = model.points.reduce((sum, point) => sum + point.metrics.netValue, 0)

  const clearFilter = () => {
    model.onQueryChange('')
    model.onStatusChange('all')
  }

  const duplicatePoint = async (point: ConversionDefinitionListItem) => {
    if (!canEdit || duplicatingId) return
    const lineAccountId = point.lineAccountId ?? selectedAccountId ?? ''
    if (!lineAccountId) {
      setActionError('集計対象のアカウントが無いため、コピーを作れませんでした。')
      return
    }
    setDuplicatingId(point.id)
    setActionError('')
    try {
      const res = await api.conversions.createDefinition({
        name: `「${point.name}」のコピー`,
        sourceType: point.sourceType,
        sourceConfig: { ...(point.sourceConfig ?? {}) },
        targetUrl: point.targetUrl,
        lineAccountId,
        deduplicationMode: point.deduplicationMode,
        deduplicationWindowDays: point.deduplicationWindowDays,
        valueMode: point.valueMode,
        fixedValue: point.valueMode === 'fixed' ? point.value : null,
        reversalPolicy: point.reversalPolicy,
        attributionDays: point.attributionDays,
        // 使う場所は版が違うと結び直せないので引き継がない。作ったあとで足す。
        usages: [],
      })
      if (!res.success) throw new Error(res.error)
      setNotice(`「${point.name}」のコピーを作りました。使う場所は引き継がないので、要れば足してください。`)
      model.onReload()
    } catch {
      setActionError('コピーを作れませんでした。読み直してから、もう一度お試しください。')
    } finally {
      setDuplicatingId(null)
    }
  }

  return (
    <div className={styles.board} data-design-node="r6dJFy">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>コンバージョン</h1>
          <p className={styles.headDescription}>
            成果として数えるできごと（成果地点）を決めます。配信・流入・アフィリエイトの成果は、この数え方で集計します。
          </p>
        </div>
        <Button
          onClick={() => model.onExportCsv()}
          disabled={model.exporting}
          busy={model.exporting}
          busyLabel="書き出しています"
        >
          CSVで書き出す
        </Button>
      </div>
      {model.exportError ? <p className={styles.panelError} role="alert">{model.exportError}</p> : null}

      {!canEdit ? (
        <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
      ) : null}
      <Notice tone="info" message="成果地点は、配信・流入リンク・アフィリエイトの成果を数えるときに使います。止めると、使っている所でも数えなくなります。" />
      {notice ? <Notice tone="success" message={notice} /> : null}
      {highlightedPoint ? (
        <Notice tone="info" message={`「${highlightedPoint.name}」を保存しました。色の付いた行です。`} />
      ) : null}
      {actionError ? <p className={styles.panelError} role="alert">{actionError}</p> : null}

      <ul className={styles.kpis} aria-label="数の帯">
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>成果地点</span>
          <div className={styles.kpiValue}>
            {model.total == null ? '—' : <>{formatNumber(model.total)}<span className={styles.kpiValueSmall}> 件</span></>}
          </div>
          <div className={styles.kpiNote}>
            {model.stateCounts == null
              ? '—'
              : <>動いている {formatNumber(model.stateCounts.active)}・止めている {formatNumber(model.stateCounts.stopped)}</>}
          </div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>この30日の成果</span>
          <div className={styles.kpiValue}>
            {model.loadFailed ? '—' : <>{formatNumber(totalCount)}<span className={styles.kpiValueSmall}> 件</span></>}
          </div>
          <div className={styles.kpiNote}>表の行の合計です{model.listTruncated ? '（直近5000件まで）' : ''}</div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>この30日の金額</span>
          <div className={styles.kpiValue}>
            {model.loadFailed ? '—' : <>¥{formatNumber(totalValue)}</>}
          </div>
          <div className={styles.kpiNote}>表の行の合計です{model.listTruncated ? '（直近5000件まで）' : ''}</div>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>どこからも使われていない</span>
          <div className={styles.kpiValue}>
            {model.stateCounts == null ? '—' : <>{formatNumber(model.stateCounts.unused)}<span className={styles.kpiValueSmall}> 件</span></>}
          </div>
          <div className={styles.kpiNote}>配信・流入・アフィリエイトで未使用</div>
        </li>
      </ul>

      <div className={styles.split}>
        <div className={styles.rail}>
          {canEdit ? (
            <Button variant="primary" href="/conversions/new" className={styles.createButton}>
              ＋ 成果地点を作る
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled
              title={READONLY_REASON}
              className={styles.createButton}
            >
              ＋ 成果地点を作る
            </Button>
          )}
          <h2 className={styles.railTitle}>フォルダ</h2>
          <ul className={styles.railList}>
            <li>
              <span className={`${styles.railRow} ${styles.railRowActive}`} aria-current="true">
                <span className={styles.railName}>すべて</span>
                <span className={styles.railCount}>{model.total == null ? '—' : formatNumber(model.total)}</span>
              </span>
            </li>
          </ul>
        </div>

        <div className={styles.main}>
          <div className={styles.toolbar}>
            {canEdit ? (
              <span className={styles.folderSelectWrap}>
                <Button variant="primary" href="/conversions/new">
                  ＋ 成果地点を作る
                </Button>
              </span>
            ) : null}
            <span className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value="all"
                options={[{ value: 'all', label: `フォルダ：すべて${model.total == null ? '' : `（${formatNumber(model.total)}）`}` }]}
                onChange={() => undefined}
              />
            </span>
            <span className={styles.searchWrap}>
              <SearchField
                value={model.query}
                onChange={model.onQueryChange}
                placeholder="成果地点の名前で探す"
                aria-label="成果地点の名前で探す"
              />
            </span>
            <span className={styles.chipRow}>
              {CHIPS.map((chip) => (
                <FilterChip
                  key={chip.value}
                  selected={model.status === chip.value}
                  onChange={() => model.onStatusChange(chip.value)}
                  count={chipCount(chip.value, model.total, model.stateCounts)}
                >
                  {chip.label}
                </FilterChip>
              ))}
            </span>
          </div>
          <div className={styles.toolbarSecond}>
            <span className={styles.pageSizeWrap}>
              <Select
                aria-label="1ページの件数"
                value={String(pageSize)}
                options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
                onChange={(value) => setPageSize(Number(value))}
              />
            </span>
          </div>

          {model.listTruncated ? (
            <Notice
              tone="warn"
              message="一覧は先頭5000個までを表示しています。これより後ろの成果地点は検索や絞り込みで範囲を分けて確認してください。"
            />
          ) : null}

          {model.loading ? (
            <div className={styles.tableWrap} aria-label="読み込み中">
              {[0, 1, 2, 3].map((index) => (
                <div className={styles.skeletonRow} key={index}>
                  <span className={styles.skeletonBar} style={{ width: '28%' }} />
                  <span className={styles.skeletonBar} style={{ width: '36%' }} />
                  <span className={styles.skeletonBar} style={{ width: '12%' }} />
                  <span className={styles.skeletonBar} style={{ width: '12%' }} />
                </div>
              ))}
            </div>
          ) : model.loadFailed ? (
            <div className={styles.stateBox} role="alert">
              <p className={styles.stateBoxTitle}>成果地点を読み込めませんでした</p>
              <p className={styles.stateBoxNote}>数の帯は「—」です。道具はそのまま使えます。</p>
              <div className={styles.stateBoxAction}>
                <Button variant="secondary" onClick={() => model.onReload()}>
                  もう一度読む
                </Button>
              </div>
            </div>
          ) : model.points.length === 0 ? (
            <div className={styles.stateBox}>
              <p className={styles.stateBoxTitle}>まだ成果地点がありません</p>
              <p className={styles.stateBoxNote}>「商品を買った」など、成果として数えるできごとを決めます</p>
              <div className={styles.stateBoxAction}>
                {canEdit ? (
                  <Button variant="primary" href="/conversions/new">
                    ＋ 成果地点を作る
                  </Button>
                ) : (
                  <Button type="button" variant="primary" disabled title={READONLY_REASON}>
                    ＋ 成果地点を作る
                  </Button>
                )}
              </div>
            </div>
          ) : model.shown.length === 0 ? (
            <div className={styles.stateBox}>
              <p className={styles.stateBoxTitle}>条件に合うものはありません</p>
              <p className={styles.stateBoxNote}>検索や絞り込みを外すと、すべて出ます</p>
              <div className={styles.stateBoxAction}>
                <Button variant="secondary" onClick={clearFilter}>
                  × 条件を外す
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <TableHeadRow>
                    <Th>成果地点</Th>
                    <Th>何が起きたら数えるか</Th>
                    <Th align="right">この30日</Th>
                    <Th align="right">金額</Th>
                    <Th>使われている場所</Th>
                    <Th>操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {current.map((point) => (
                    <tr
                      key={point.id}
                      className={panelId === point.id || model.highlightedId === point.id ? styles.rowSelected : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className={styles.cellButton}
                          onClick={() => setPanelId(panelId === point.id ? null : point.id)}
                          aria-expanded={panelId === point.id}
                          title={point.name}
                        >
                          <span className={styles.cellName}>{point.name}</span>
                        </button>
                        <span className={`${styles.statePill} ${PILL_CLASS[point.state]}`}>
                          <span className={styles.statePillDot} aria-hidden="true" />
                          {point.state === 'active' ? '動いている' : STATE_LABELS[point.state]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellName} title={sourceTriggerLabel(point)}>
                          {sourceTriggerLabel(point)}
                        </span>
                        <span className={styles.cellSub}>{rowSub(point)}</span>
                      </td>
                      <td className={styles.numeric}>{formatNumber(point.metrics.netCount)}件</td>
                      <td className={styles.numeric}>
                        {point.metrics.netValue > 0 ? `¥${formatNumber(point.metrics.netValue)}` : <span className={styles.cellMuted}>—</span>}
                      </td>
                      <td>
                        {point.usageCount === 0
                          ? <span className={styles.cellMuted}>—</span>
                          : <span title={usageLabel(point)}>{usageLabel(point)}</span>}
                      </td>
                      <td className={styles.opCell} onClick={(event) => event.stopPropagation()}>
                        {canEdit ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            href={`/analytics?tab=funnel&conversionPointId=${encodeURIComponent(point.id)}&conversionPointName=${encodeURIComponent(point.name)}`}
                          >
                            使う場所を足す
                          </Button>
                        ) : (
                          <Button type="button" variant="secondary" size="compact" disabled title={READONLY_REASON}>
                            使う場所を足す
                          </Button>
                        )}{' '}
                        <RowActions
                          menuItems={[
                            { id: 'detail', label: '中身を見る', onSelect: () => model.onOpenDetail(point) },
                            {
                              id: 'edit',
                              label: '編集する',
                              disabled: !canEdit || point.status === 'stopped',
                              onSelect: () => model.onOpenEdit(point),
                            },
                            { id: 'usage', label: '使う場所を見る', onSelect: () => setPanelId(point.id) },
                            ...(point.state === 'draft'
                              ? [{
                                id: 'publish',
                                label: '公開する',
                                disabled: !canEdit || model.publishing,
                                onSelect: () => model.onPublishDraft(point),
                              } as const]
                              : point.status !== 'stopped'
                                ? [{
                                  id: 'stop',
                                  label: '止める',
                                  disabled: !canEdit,
                                  onSelect: () => model.onOpenStop(point, 'stop'),
                                } as const]
                                : []),
                            {
                              id: 'duplicate',
                              label: '複製する',
                              disabled: !canEdit || duplicatingId !== null,
                              onSelect: () => void duplicatePoint(point),
                            },
                          ]}
                          menuNote={canEdit ? undefined : READONLY_REASON}
                          subjectName={point.name}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {model.total != null && model.shown.length > 0 ? (
            <div className={styles.pagerRow}>
              <p className={styles.pagerNote}>利用先の名前は詳細で確認できます。追加するときは分析画面でこの成果地点を選びます。</p>
              <div className={styles.toolbar}>
                <ListRange
                  className={styles.pagerCount}
                  label="成果地点"
                  total={model.shown.length}
                  first={model.shown.length === 0 ? 0 : (page - 1) * pageSize + 1}
                  last={Math.min(page * pageSize, model.shown.length)}
                />
                {pageCount > 1 ? (
                  <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {panelPoint || model.stopTarget ? (
        <div className={styles.panels}>
          {panelPoint ? (
            <section className={styles.panel} aria-label="詳細の小窓">
              <h2 className={styles.panelTitle}>詳細の小窓：{panelPoint.name}</h2>
              <p className={styles.panelLead}>
                <span className={`${styles.statePill} ${PILL_CLASS[panelPoint.state]}`}>
                  <span className={styles.statePillDot} aria-hidden="true" />
                  {panelPoint.state === 'active' ? '動いている' : STATE_LABELS[panelPoint.state]}
                </span>{' '}
                {sourceTriggerLabel(panelPoint)}・{deduplicationLabel(panelPoint.deduplicationMode, panelPoint.deduplicationWindowDays)}
              </p>
              <p className={styles.panelLead}>
                使われている場所：{panelPoint.usageCount === 0 ? 'どこからも使われていません' : usageLabel(panelPoint)}
              </p>
              {panelPoint.measureMethod === 'webhook' ? (
                <p className={styles.panelLead}>
                  受け口：POST /api/conversions/ingest/{panelPoint.id}
                  {panelPoint.ingest.disabledAt ? '（止まっています）' : panelPoint.ingest.configured ? '（動いています）' : '（まだ鍵を発行していません）'}
                </p>
              ) : null}
              {model.issuedSecret && panelPoint.measureMethod === 'webhook' ? (
                <p className={styles.secretBox} role="status">
                  発行した鍵（この表示でだけ見られます。連携先へ渡してください）：{model.issuedSecret}
                </p>
              ) : null}
              {model.ingestError ? <p className={styles.panelError} role="alert">{model.ingestError}</p> : null}
              <div className={styles.panelButtons}>
                {panelPoint.measureMethod === 'webhook' && panelPoint.status !== 'stopped' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit || model.ingestBusy !== ''}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onIssueIngest(panelPoint)}
                    busy={model.ingestBusy === 'issue'}
                    busyLabel="発行しています"
                  >
                    鍵を発行する
                  </Button>
                ) : null}
                {panelPoint.measureMethod === 'webhook' && panelPoint.ingest.configured && panelPoint.status !== 'stopped' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit || model.ingestBusy !== ''}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onToggleIngest(panelPoint)}
                    busy={model.ingestBusy === 'toggle'}
                    busyLabel="切り替えています"
                  >
                    {panelPoint.ingest.disabledAt ? '受け口を再開する' : '受け口を止める'}
                  </Button>
                ) : null}
                {panelPoint.status !== 'stopped' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onOpenEdit(panelPoint)}
                  >
                    編集する
                  </Button>
                ) : null}
                {panelPoint.status !== 'stopped' && panelPoint.state !== 'draft' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onOpenStop(panelPoint, 'stop')}
                  >
                    止める
                  </Button>
                ) : null}
                {panelPoint.state === 'draft' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit || model.publishing}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onPublishDraft(panelPoint)}
                    busy={model.publishing}
                    busyLabel="公開しています"
                  >
                    公開する
                  </Button>
                ) : null}
                {panelPoint.status !== 'stopped' ? (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={!canEdit}
                    title={canEdit ? undefined : READONLY_REASON}
                    onClick={() => model.onOpenStop(panelPoint, 'delete')}
                  >
                    削除する
                  </Button>
                ) : null}
                <Button variant="secondary" size="compact" onClick={() => model.onOpenDetail(panelPoint)}>
                  中身を見る
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => setPanelId(null)}
                  className={styles.panelClose}
                >
                  閉じる
                </Button>
              </div>
            </section>
          ) : null}

          {model.stopTarget ? (
            <section className={styles.panel} aria-label="止めるときの小窓">
              <h2 className={styles.panelTitle}>「{model.stopTarget.name}」を止める</h2>
              <p className={styles.panelLead}>
                {model.stopImpactLoading
                  ? '利用先と影響を読み込んでいます。'
                  : model.stopImpact
                    ? `${model.stopImpact.stopImpact.affectedUsageCount}か所で使われています。どうしますか。`
                    : '利用先と影響を読み込めませんでした。'}
              </p>
              <RadioCardGroup legend="どうしますか？" legendVisible>
                <RadioCard
                  name="conversion-v8-stop-action"
                  value="stop"
                  checked={model.stopAction === 'stop'}
                  onChange={() => model.onStopActionChange('stop')}
                  title="止める（使う所の計測も止まる）"
                  note="これから先は数えません。過去の記録と分析は残します。"
                />
                <RadioCard
                  name="conversion-v8-stop-action"
                  value="replace"
                  checked={model.stopAction === 'replace'}
                  onChange={() => model.onStopActionChange('replace')}
                  disabled={!model.stopImpact?.replacementCandidates.length}
                  disabledReason="差し替え先の成果地点がありません"
                  title="別の成果地点に差し替えてから止める"
                  note="利用先を別の成果地点へ切り替え、過去の数字を残します。"
                />
                <RadioCard
                  name="conversion-v8-stop-action"
                  value="delete"
                  checked={model.stopAction === 'delete'}
                  onChange={() => model.onStopActionChange('delete')}
                  disabled={!model.stopImpact?.canDelete}
                  disabledReason="成果または利用先があるため、物理削除は選べません。"
                  title="削除する（使われていないときだけ選べる）"
                  note={model.stopImpact?.canDelete
                    ? '成果0件・利用先0件のため、この成果地点だけを削除できます。'
                    : '成果または利用先があるため、物理削除は選べません。'}
                />
              </RadioCardGroup>
              {model.stopAction === 'replace' ? (
                <span className={styles.reasonField}>
                  <Select
                    aria-label="差し替え先の成果地点"
                    value={model.replacementId}
                    options={[
                      { value: '', label: '差し替え先を選ぶ' },
                      ...(model.stopImpact?.replacementCandidates ?? []).map((item) => ({ value: item.id, label: item.name })),
                    ]}
                    onChange={model.onReplacementIdChange}
                  />
                </span>
              ) : null}
              <label className={styles.reasonField}>
                <span className={styles.reasonLabel}>理由（必須）</span>
                <input
                  aria-label="止める理由"
                  className={inputClass}
                  value={model.stopReason}
                  maxLength={500}
                  placeholder="計測の仕方を変えるため"
                  onChange={(event) => model.onStopReasonChange(event.target.value)}
                />
              </label>
              {model.stopError ? <p className={styles.panelError} role="alert">{model.stopError}</p> : null}
              <div className={styles.panelButtons}>
                <Button variant="secondary" onClick={() => model.onCancelStop()} disabled={model.stopping}>
                  キャンセル
                </Button>
                <Button
                  variant="primary"
                  disabled={model.stopping || model.stopImpactLoading || !model.stopReason.trim() || (model.stopAction === 'replace' && !model.replacementId)}
                  onClick={() => model.onConfirmStop()}
                  busy={model.stopping || model.stopImpactLoading}
                  busyLabel="止めています"
                >
                  止める
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
