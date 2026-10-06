'use client'

import { Th } from '@/components/shared/table'

/*
 * ★V8-B 共通アクションの一覧（板 `LnGNw`・状態 `S3pdQ`・1152 `En14p`）。
 *
 * v7（page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （一覧・検索・状態の絞り込み・複製・保管・CSV）。
 * フォルダの列は口が無いので持たない（残所として報告する）。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる。
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { api, type CommonActionSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import MetricValue from '@/components/ui/metric-value'
import { TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { useAutomationRunPermissions } from '@/components/automations/use-can-manage'
import {
  V8AutoCreateButton,
  type AutoV8Counts,
  type AutoV8Model,
} from '@/app/automations/automations-v8'
import styles from '@/app/automations/automations-v8.module.css'

type Filter = 'all' | 'published' | 'draft' | 'old_version' | 'unused' | 'archived'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'published', label: '公開中' },
  { value: 'draft', label: '下書き' },
  { value: 'old_version', label: '古い版あり' },
  { value: 'unused', label: '呼ばれていない' },
  { value: 'archived', label: '保管' },
]

const STATUS_LABEL: Record<CommonActionSummary['status'], string> = {
  published: '公開中',
  draft: '下書き',
  archived: '保管',
}

const PAGE_SIZES = [10, 20, 50]

export function V8CommonActionsTab({
  model,
  onCounts,
}: {
  model: AutoV8Model
  onCounts: (counts: AutoV8Counts) => void
}) {
  const { readonly } = model
  const canManage = useCanManageCommonActions()
  const runPermissions = useAutomationRunPermissions()
  const canExportCsv = runPermissions?.canExport ?? false
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [items, setItems] = useState<CommonActionSummary[]>([])
  const [summary, setSummary] = useState<{
    total: number; published: number; draft: number; oldVersion: number; unused: number;
    archived: number;
    actions: number; bindings: number; outdated: number; outdatedItems: number;
    executions: number; failures: number;
  } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<{ item: CommonActionSummary; mode: 'archive' | 'unarchive' } | null>(null)
  const [archivingBusy, setArchivingBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [actionError, setActionError] = useState('')
  const router = useRouter()
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const my = ++requestSeq.current
    if (!selectedAccountId) {
      setItems([])
      setSummary(null)
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setActionError('')
    setLoadFailed(false)
    try {
      const [response, automationsResponse, templatesResponse] = await Promise.all([
        api.commonActions.list({
          accountId: selectedAccountId,
          status: filter,
          query: deferredQuery,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        api.automations.list({ accountId: selectedAccountId }).catch(() => null),
        api.automations.templates(selectedAccountId).catch(() => null),
      ])
      if (requestSeq.current !== my) return
      if (response.success) {
        setItems(response.data)
        setTotal(response.pagination?.total ?? response.data.length)
        if (response.summary) setSummary(response.summary)
      } else {
        setLoadFailed(true)
      }
      const automations = automationsResponse?.success ? automationsResponse.data : null
      const templates = templatesResponse?.success ? templatesResponse.data.length : null
      onCounts({
        rules: automations?.length ?? null,
        templates,
        commonActions: response.success ? (response.summary?.total ?? null) : null,
      })
    } catch {
      if (requestSeq.current !== my) return
      setLoadFailed(true)
    } finally {
      if (requestSeq.current === my) setLoading(false)
    }
  }, [deferredQuery, filter, page, pageSize, selectedAccountId, onCounts])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const totals = useMemo(() => ({
    published: summary?.published ?? 0,
    bindings: summary?.bindings ?? 0,
    executions: summary?.executions ?? 0,
    failures: summary?.failures ?? 0,
    outdatedItems: summary?.outdatedItems ?? 0,
    outdated: summary?.outdated ?? 0,
  }), [summary])

  const filterCount = (value: Filter): number | undefined => {
    if (!summary || loadFailed) return undefined
    if (value === 'all') return summary.total
    if (value === 'old_version') return summary.oldVersion
    if (value === 'unused') return summary.unused
    if (value === 'published') return summary.published
    if (value === 'draft') return summary.draft
    if (value === 'archived') return summary.archived
    return undefined
  }

  const duplicate = async (item: CommonActionSummary) => {
    if (!selectedAccountId || duplicatingId) return
    setDuplicatingId(item.id)
    setActionError('')
    try {
      const response = await api.commonActions.duplicate(item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      window.location.href = `/common-actions/edit?id=${encodeURIComponent(response.data.id)}`
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '共通アクションを複製できませんでした')
      setDuplicatingId(null)
    }
  }

  const openArchiveDialog = (item: CommonActionSummary, mode: 'archive' | 'unarchive') => {
    setArchiveError('')
    setArchiving({ item, mode })
  }

  const confirmArchive = async () => {
    if (!archiving || !selectedAccountId || archivingBusy) return
    if (archiving.mode === 'archive' && archiving.item.bindingCount > 0) {
      setArchiving(null)
      return
    }
    setArchivingBusy(true)
    setArchiveError('')
    try {
      const response = archiving.mode === 'archive'
        ? await api.commonActions.archive(archiving.item.id, selectedAccountId)
        : await api.commonActions.unarchive(archiving.item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      setArchiving(null)
      await load()
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : '操作を完了できませんでした')
    } finally {
      setArchivingBusy(false)
    }
  }

  const csvEmpty = !loading && !loadFailed && total === 0
  const csvScoped = filter !== 'all' || deferredQuery.trim() !== ''

  if (loading) {
    return <ListState kind="loading" title="共通アクションを読み込んでいます" />
  }

  if (loadFailed) {
    return (
      <ListState
        kind="error"
        title="共通アクションを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
        onRetry={() => void load()}
      />
    )
  }

  return (
    <div>
      {actionError ? <p role="alert" className={styles.errorBand}>{actionError}</p> : null}

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>共通アクション</p>
          <p className={styles.kpiValue}><MetricValue value={summary?.total ?? null} unit="件" /></p>
          <p className={styles.kpiSub}>うち公開中 {totals.published}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>使われている所</p>
          <p className={styles.kpiValue}><MetricValue value={summary ? totals.bindings : null} unit="か所" /></p>
          <p className={styles.kpiSub}>ルール・シナリオなど5機能から</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>今月動いた</p>
          <p className={styles.kpiValue}><MetricValue value={summary ? totals.executions : null} unit="回" /></p>
          <p className={styles.kpiSub}>失敗 {totals.failures}件は記録から直せます</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>古い版のまま</p>
          <p className={styles.kpiValue}><MetricValue value={summary ? totals.outdatedItems : null} unit="件" /></p>
          <p className={styles.kpiSub}>
            {totals.outdatedItems > 0 ? `呼び出し元 ${totals.outdated}か所要確認` : 'すべて最新の版です'}
          </p>
        </div>
      </div>

      <p className={styles.footnote}>
        共通アクションは、ルール・シナリオ・自動応答・回答フォーム・リッチメニューから呼び出せる「処理のまとまり」です。公開しても、使っている所はいまの版のまま。使う所ごとに新しい版へ切り替えます。
      </p>

      <div className={styles.toolbar}>
        <V8AutoCreateButton href="/common-actions/new" readonly={readonly}>＋ 共通アクションを作る</V8AutoCreateButton>
        {canExportCsv && selectedAccountId ? (
          csvEmpty ? (
            <Button disabled title="条件に合う共通アクションがないため書き出せません">CSVで書き出す</Button>
          ) : (
            <Button href={api.commonActions.csvUrl({
              accountId: selectedAccountId,
              status: filter === 'all' ? undefined : filter,
              query: deferredQuery.trim() || undefined,
            })}>CSVで書き出す</Button>
          )
        ) : null}
        {canExportCsv && selectedAccountId ? (
          <span className={styles.footnote}>
            {csvScoped ? `この条件の${total}件を書き出します` : `全${total}件を書き出します`}
          </span>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <TextField
          aria-label="共通アクションを検索"
          placeholder="アクション名・中の処理で探す"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          className={styles.toolsSearch}
        />
        <Button onClick={() => void load()} variant="secondary" size="compact">
          <RefreshCw size={16} aria-hidden />
          一覧を更新する
        </Button>
        <Select
          aria-label="1ページに表示する件数"
          value={String(pageSize)}
          onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
          options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size}件表示` }))}
        />
      </div>

      <div className={styles.toolbar}>
        <RadioCardGroup legend="状態で絞り込む">
          {FILTERS.map((option) => {
            const count = filterCount(option.value)
            return (
              <RadioCard
                key={option.value}
                name="common-action-filter-v8"
                value={option.value}
                checked={filter === option.value}
                onChange={() => { setFilter(option.value); setPage(1) }}
                title={`${option.label}${count == null ? '' : ` ${count}`}`}
              />
            )
          })}
        </RadioCardGroup>
      </div>

      {items.length === 0 ? (
        <ListState
          kind="empty"
          title={query || filter !== 'all' ? '条件に合う共通アクションはありません' : '共通アクションはまだありません'}
          description={query || filter !== 'all' ? '検索語や絞り込みを変えてください。' : 'よく使う処理をまとめると、設定の重複を減らせます。'}
          action={canManage && !query && filter === 'all' ? <Button href="/common-actions/new" variant="primary">＋ 共通アクションを作る</Button> : undefined}
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <Th scope="col">アクション名</Th>
                <Th scope="col">状態</Th>
                <Th scope="col">中の処理</Th>
                <Th scope="col">呼び出し元</Th>
                <Th scope="col">版</Th>
                <Th scope="col"><span className={styles.visuallyHidden}>操作</span></Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <p className={styles.cellMain} title={item.name}>{item.name}</p>
                    <p className={styles.cellSub} title={item.description ?? undefined}>{item.description || '説明はありません'}</p>
                  </td>
                  <td>
                    <span className={item.status === 'published' ? `${styles.pill} ${styles.pillActive}` : item.status === 'archived' ? `${styles.pill} ${styles.pillStopped}` : `${styles.pill} ${styles.pillWarn}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  <td><span className={styles.num}>{item.actionCount}個の処理</span></td>
                  <td>
                    <span className={styles.cellSubDark}>{item.bindingCount}か所</span>
                    {item.oldVersionBindingCount > 0 ? (
                      <span className={styles.confirmText}> 古い版 {item.oldVersionBindingCount}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.cellMain} title={item.publishedVersion ? `v${item.publishedVersion}` : undefined}>
                      {item.publishedVersion ? `v${item.publishedVersion}` : '—'}
                    </span>
                    {item.status === 'published' && item.draftVersion != null ? (
                      <span className={styles.cellSub} title={`下書きv${item.draftVersion}を編集中`}>下書きあり</span>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button href={`/common-actions/versions?id=${encodeURIComponent(item.id)}`} variant="secondary" size="compact">
                        中身を見る <ExternalLink size={14} aria-hidden />
                      </Button>
                      {canManage ? (
                        <>
                          <IconButton
                            aria-label={`${item.name}のその他操作`}
                            aria-expanded={openMenuId === item.id}
                            onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                          >
                            <MoreHorizontal aria-hidden />
                          </IconButton>
                          <ActionMenu
                            open={openMenuId === item.id}
                            ariaLabel={`${item.name}の操作`}
                            onClose={() => setOpenMenuId(null)}
                            items={[
                              item.status === 'archived'
                                ? {
                                  id: 'unarchive',
                                  label: '保管を戻す',
                                  onSelect: () => openArchiveDialog(item, 'unarchive'),
                                }
                                : {
                                  id: 'archive',
                                  label: '保管する',
                                  onSelect: () => openArchiveDialog(item, 'archive'),
                                },
                              item.status === 'draft'
                                ? {
                                  id: 'publish',
                                  label: '公開する',
                                  onSelect: () =>
                                    router.push(`/common-actions/edit?id=${encodeURIComponent(item.id)}`),
                                }
                                : {
                                  id: 'usage',
                                  label: '使われている場所',
                                  onSelect: () =>
                                    router.push(`/common-actions/versions?id=${encodeURIComponent(item.id)}`),
                                },
                              {
                                id: 'duplicate',
                                label: duplicatingId === item.id ? '複製中' : '複製して下書きを作る',
                                disabled: duplicatingId !== null,
                                onSelect: () => void duplicate(item),
                              },
                            ]}
                          />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.footer}>
            <ListRange total={total} first={(page - 1) * pageSize + 1} last={Math.min(page * pageSize, total)} />
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} onPageChange={setPage} />
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(archiving)}
        title={archiving?.mode === 'unarchive'
          ? `「${archiving?.item.name}」の保管を戻しますか`
          : `「${archiving?.item.name}」を保管しますか`}
        description={archiving?.mode === 'unarchive'
          ? '通常一覧に戻ります。実行記録はそのまま残ります。'
          : '通常一覧から外れます。実行記録は残ります。'}
        confirmLabel={archiving?.mode === 'unarchive'
          ? '保管を戻す'
          : archiving && archiving.item.bindingCount > 0 ? '閉じる' : '保管する'}
        busy={archivingBusy}
        onCancel={() => setArchiving(null)}
        onConfirm={() => void confirmArchive()}
      >
        {archiving?.mode === 'archive' && archiving.item.bindingCount > 0 ? (
          <p className={styles.confirmText} role="alert">
            利用中のため保管できません（{archiving.item.bindingCount}か所）。先に利用先を外してください。
          </p>
        ) : null}
        {archiveError ? <p className={styles.stepError} role="alert">{archiveError}</p> : null}
      </Dialog>
    </div>
  )
}
