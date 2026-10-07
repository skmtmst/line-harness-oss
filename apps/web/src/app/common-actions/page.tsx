'use client'

import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAdminTheme } from '@/lib/use-admin-theme'
import CommonActionsV8 from '@/v8/automations/common-actions'
import { ExternalLink, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { api, type CommonActionSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import { usePageTitle } from '@/components/shell/page-chrome'
import ListToolbar from '@/components/shared/list-toolbar'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { Tabs } from '@/components/shared/tabs'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { useAutomationRunPermissions } from '@/components/automations/use-can-manage'
import { useManualHref } from '@/lib/use-manual-href'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type Filter = 'all' | 'published' | 'draft' | 'old_version' | 'unused' | 'archived'
const PAGE_SIZE = 6

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'published', label: '公開中' },
  { value: 'draft', label: '下書き' },
  { value: 'old_version', label: '古い版あり' },
  { value: 'unused', label: '呼ばれていない' },
  // 監査 R480: 保管済みは通常一覧に出さない。この札で見る・戻す。
  { value: 'archived', label: '保管' },
]

const STATUS_LABEL: Record<CommonActionSummary['status'], string> = {
  published: '公開中',
  draft: '下書き',
  archived: '保管',
}

/*
 * ★V8 の切り替え。v8 の画面は src/v8/automations/common-actions.tsx（2026-10-06 から）。
 * v7 の器・動きはこの下の V7 のまま残す。
 */
export default function CommonActionsPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') {
    return (
      <Suspense fallback={null}>
        <CommonActionsPageV8 />
      </Suspense>
    )
  }
  return <CommonActionsPageV7 />
}

/* ★V8 共通アクションの一覧（板 `LnGNw`）。画面は src/v8/automations/common-actions.tsx。 */
function CommonActionsPageV8() {
  return <CommonActionsV8 />
}

function CommonActionsPageV7() {
  const canManage = useCanManageCommonActions()
  /*
   * 監査 R466: 書き出しの権限（automation.run.export）がない担当者には
   * 出力リンク自体を出さない。押してから403になる誘導をやめる。
   * 本当の可否はサーバが決める（routeは403を維持）。
   */
  const runPermissions = useAutomationRunPermissions()
  const canExportCsv = runPermissions?.canExport ?? false
  /* 監査 R128: 正本表に登録があるときだけ出す。無ければボタン自体を出さない。 */
  const manualHref = useManualHref('/common-actions')
  // /common-actions はメニューの接頭辞に当たらず上部バーが空になるため、画面名を明示する。
  usePageTitle('共通アクション')
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
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** m23m: 捕まえた読み込み失敗。403・429の1枚へ渡すためだけに持つ。 */
  const [loadError, setLoadError] = useState<unknown>(null)
  const [automationCounts, setAutomationCounts] = useState<{ active: number; stopped: number } | null>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  // 行の「その他」メニューの開き先（#641）
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()
  /*
   * 監査 R465: アカウント・検索・絞り込みを含む取得の世代。取得中に条件が
   * 変わったら、遅れて届いた古い応答は捨てて現在の一覧を上書きしない。
   */
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
    setError('')
    setLoadError(null)
    try {
      // 件数表示のための全件取得はしない。札・KPIの数字は口の集計で受け取る。
      const [response, automationsResponse, templatesResponse] = await Promise.all([
        api.commonActions.list({
          accountId: selectedAccountId,
          status: filter,
          query: deferredQuery,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        api.automations.list({ accountId: selectedAccountId }).catch(() => null),
        api.automations.templates(selectedAccountId).catch(() => null),
      ])
      if (requestSeq.current !== my) return
      if (response.success) {
        setItems(response.data)
        setTotal(response.pagination?.total ?? response.data.length)
        if (response.summary) setSummary(response.summary)
      }
      else setError(response.error)
      setAutomationCounts(automationsResponse?.success ? {
        active: automationsResponse.data.filter((item) => item.isActive).length,
        stopped: automationsResponse.data.filter((item) => !item.isActive).length,
      } : null)
      setTemplateCount(templatesResponse?.success ? templatesResponse.data.length : null)
    } catch (caught) {
      if (requestSeq.current !== my) return
      setLoadError(caught)
      setError(caught instanceof Error ? caught.message : '共通アクションを読み込めませんでした')
    } finally {
      if (requestSeq.current === my) setLoading(false)
    }
  }, [deferredQuery, filter, page, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const totals = useMemo(() => ({
    actions: summary?.actions ?? 0,
    bindings: summary?.bindings ?? 0,
    outdated: summary?.outdated ?? 0,
    outdatedItems: summary?.outdatedItems ?? 0,
    published: summary?.published ?? 0,
    executions: summary?.executions ?? 0,
    failures: summary?.failures ?? 0,
  }), [summary])

  /* 監査 R464: 0件の条件では書き出せない。押せる理由がない操作は置かない。 */
  const csvEmpty = !loading && !error && total === 0
  const csvScoped = filter !== 'all' || deferredQuery.trim() !== ''

  // ★V7 `x63W5x`：集計が取れていない間、絞り込みの件数に 0 を出さない。
  const filterCount = (value: Filter): number | undefined => {
    if (!summary || error) return undefined
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
    setError('')
    try {
      const response = await api.commonActions.duplicate(item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      window.location.href = `/common-actions/edit?id=${encodeURIComponent(response.data.id)}`
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共通アクションを複製できませんでした')
      setDuplicatingId(null)
    }
  }

  /*
   * 監査 R480: 未使用なら確認後に保管、利用中は窓内で件数と理由を示して止める。
   * 保管済みは同じ窓で戻せる。権限なしの操作はサーバでも拒否する。
   */
  const [archiving, setArchiving] = useState<{ item: CommonActionSummary; mode: 'archive' | 'unarchive' } | null>(null)
  const [archivingBusy, setArchivingBusy] = useState(false)
  const [archiveError, setArchiveError] = useState('')

  const openArchiveDialog = (item: CommonActionSummary, mode: 'archive' | 'unarchive') => {
    setArchiveError('')
    setArchiving({ item, mode })
  }

  const confirmArchive = async () => {
    if (!archiving || !selectedAccountId || archivingBusy) return
    // 利用中は理由を示すだけで実行しない（押せない操作に見せかけない）。
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

  return (
    <div data-design-node="xOpDs">
      {/*
        U035: 390pxでは右側の操作ボタンが見出し・パンくず・説明を
        押しつぶし、縦に割れていた。共通の PageHeader の形は変えず、
        この画面の見出し帯だけ「収まらないとき操作を次の行へ下げる」にする。
        収まる幅では1行のままで見た目は変わらない。
      */}
      <div data-page-header-wrap>
      <PageHeader
        breadcrumb={[
          { label: 'オートメーション', href: '/automations' },
          { label: '共通アクション' },
        ]}
        title="共通アクション"
        description=""
        actions={(
          <>
            {manualHref ? <Button href={manualHref}>マニュアル</Button> : null}
          </>
        )}
      />
      <style>{`
        [data-page-header-wrap] > div { flex-wrap: wrap; }
        [data-page-header-wrap] > div > div + div { flex-wrap: wrap; max-width: 100%; margin-left: auto; }
        /* 下の5つの画面切替タブも、390pxでは右へはみ出していた。同じ考え方で折り返す。 */
        [data-tabs-row] nav:has(> span) { height: auto; flex-wrap: wrap; row-gap: 8px; }
        [data-tabs-row] nav:has(> span) > span { flex-wrap: wrap; row-gap: 0; }
        [data-scroll-table] > div { overflow-x: auto; }
        [data-scroll-table] table { min-width: 800px; }
      `}</style>
      </div>

      <div data-tabs-row>
      <Tabs items={[
        { label: '動いているもの', count: automationCounts?.active, href: '/automations' },
        { label: '止めているもの', count: automationCounts?.stopped, href: '/automations?tab=stopped' },
        { label: '動いた記録', href: '/automations/runs' },
        { label: '見本', count: templateCount ?? undefined, href: '/automations?tab=templates' },
        { label: '共通アクション', count: summary?.total, current: true },
      ]} className="mb-4" />
      </div>

      {/*
        ★V7 `x63W5x`：取れない KPI は「—」。読み込み中は「読み込んでいます」、
        失敗は「読み込めませんでした」と言い分け、0 と混ぜない。
      */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard variant="v6" title="共通アクション" value={loading || error ? null : (summary?.total ?? 0)} unit="" detail={error ? '読み込めませんでした' : loading ? '読み込んでいます' : `うち公開中 ${totals.published}`} loading={loading} />
        <KpiCard variant="v6" title="呼び出し元" value={loading || error ? null : totals.bindings} unit="" detail={error ? '読み込めませんでした' : loading ? '読み込んでいます' : '5機能から'} loading={loading} />
        <KpiCard variant="v6" title="今月 動いた回数" value={loading || error ? null : totals.executions} unit="" detail={error ? '読み込めませんでした' : loading ? '読み込んでいます' : `失敗 ${totals.failures}`} loading={loading} />
        <KpiCard variant="v6" title="古い版のまま" value={loading || error ? null : totals.outdatedItems} unit="" detail={error ? '読み込めませんでした' : loading ? '読み込んでいます' : `呼び出し元 ${totals.outdated}か所`} loading={loading} badge={!error && totals.outdatedItems > 0 ? '要確認' : undefined} badgeTone="warning" />
      </div>

      {/*
        監査 R122: 「直すとすべてに効く」は実動作と違う。公開しても利用先は
        いまの版のまま動き、使う場所ごとに新版へ切り替えたときだけ効く
        （「版と利用先」画面で確認・切り替え）。作成画面の説明と揃える。
      */}
      <NoteBar>
        直した内容は、公開したあと使う場所ごとに新しい版へ切り替えたときだけ効きます。動いている途中のものは、始まったときの版のまま最後まで進みます。
      </NoteBar>

      {/*
        作る操作は一覧のすぐ上の左。見出しの行の右端には置かない。
        ★V7：同じボタンを2つ並べない。
      */}
      <div className="my-3 flex flex-wrap items-center gap-2">
        {canManage ? <Button href="/common-actions/new" variant="primary">＋ 共通アクションを作る</Button> : null}
        {/*
          監査 R464: 「この条件の結果を書き出す」が既定。検索・絞り込みを
          そのまま渡し、実行前に範囲と件数が分かる文を添える。
        */}
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
        {canExportCsv && selectedAccountId && !loading && !error ? (
          <span className="text-xs text-ink-faint">
            {csvScoped ? `この条件の${total}件を書き出します` : `全${total}件を書き出します`}
          </span>
        ) : null}
      </div>

      {/*
        ★V7 `Xn1Mz`：検索は幅320で1行目、2行目は左に絞り込み・
        右端に一覧の更新。
      */}
      <ListToolbar
        search={{
          placeholder: 'アクション名・中の処理で探す',
          label: '共通アクションを検索',
          value: query,
          onChange: (value) => { setQuery(value); setPage(1) },
          loading: loading && query !== deferredQuery,
        }}
        filters={
          <RadioCardGroup legend="状態で絞り込む" className="flex flex-wrap gap-2">
            {FILTERS.map((option) => {
              const count = filterCount(option.value)
              return (
                <RadioCard
                  key={option.value}
                  name="common-action-filter"
                  value={option.value}
                  checked={filter === option.value}
                  onChange={() => { setFilter(option.value); setPage(1) }}
                  title={`${option.label}${count == null ? '' : ` ${count}`}`}
                />
              )
            })}
          </RadioCardGroup>
        }
        trailing={
          <Button
            onClick={() => void load()}
          >
            <RefreshCw size={16} aria-hidden />
            一覧を更新する
          </Button>
        }
      />

      {error ? (
        // ★V7 `x63W5x`：口の文言（英語の `Failed to fetch` など）をそのまま
        // 出さない。日本語の決まった文で出す。
        <ListState
          kind="error"
          title="共通アクションを読み込めませんでした"
          // m23m: 403・429は共通の1枚（権限の案内・待ち案内）へ切り替える。
          // それ以外は画面の文のまま。
          description={isForbiddenOrRateLimited(loadError) ? undefined : '通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。'}
          error={loadError ?? undefined}
          onRetry={() => void load()}
        />
      ) : loading ? (
        <ListState kind="loading" title="共通アクションを読み込んでいます" />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title={query || filter !== 'all' ? '条件に合う共通アクションはありません' : '共通アクションはまだありません'}
          description={query || filter !== 'all' ? '検索語や絞り込みを変えてください。' : 'よく使う処理をまとめると、設定の重複を減らせます。'}
          action={canManage && !query && filter === 'all' ? <Button href="/common-actions/new" variant="primary">＋ 共通アクションを作る</Button> : undefined}
        />
      ) : (
        /* U035: 390pxでは6列の表が潰れて見出しが重なる。列の比較が要る表なので、
           枠の内側だけ横へ動かせるようにして見出しの形を保つ。 */
        <div data-scroll-table>
        <DataTable>
            <thead className="bg-canvas-sunken text-ink-faint text-xs">
              <TableHeadRow>
                <Th style={{ width: '28%' }}>アクション名</Th>
                <Th style={{ width: '12%' }}>状態</Th>
                <Th style={{ width: '18%' }}>中の処理</Th>
                <Th style={{ width: '16%' }}>呼び出し元</Th>
                <Th style={{ width: '8%' }}>版</Th>
                {/* 表の外側の余白は左右で同じに。操作列は中身の幅で固定し、残りは本文の列で吸収する。 */}
                <Th align="right" className="w-44">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <NameCell name={<span className="truncate" title={item.name}>{item.name}</span>} sub={<span className="truncate" title={item.description ?? undefined}>{item.description || '説明はありません'}</span>} />
                  <Td>
                    <StatusBadge tone={item.status === 'published' ? 'success' : 'neutral'} size="compact">
                      {STATUS_LABEL[item.status]}
                    </StatusBadge>
                  </Td>
                  <Td>{item.actionCount}個の処理</Td>
                  <Td>
                    <span className="text-ink-secondary">{item.bindingCount}か所</span>
                    {item.oldVersionBindingCount > 0 ? (
                      <span className="text-warning ml-2 text-xs">古い版 {item.oldVersionBindingCount}</span>
                    ) : null}
                  </Td>
                  <Td>
                    {/* 短い文字列は途中で折らない。版と札は1行ずつ出す。 */}
                    <span className="block truncate" title={item.publishedVersion ? `v${item.publishedVersion}` : undefined}>
                      {item.publishedVersion ? `v${item.publishedVersion}` : '—'}
                    </span>
                    {/* 監査 R470: 公開版と下書きが両方あるとき、下書きの存在も識別できるようにする。 */}
                    {item.status === 'published' && item.draftVersion != null ? (
                      <span className="text-ink-faint block truncate text-xs" title={`下書きv${item.draftVersion}を編集中`}>下書きあり</span>
                    ) : null}
                  </Td>
                  <ActionCell>
                    {/* #641: 「中身を見る」＋「その他（…）」の形にそろえる。残りはメニューへ集約。 */}
                    <div className="relative flex w-full items-center justify-end gap-1.5">
                    <Button
                      href={`/common-actions/versions?id=${encodeURIComponent(item.id)}`}
                      variant="secondary"
                    >
                      中身を見る <ExternalLink size={14} aria-hidden />
                    </Button>
                    {canManage ? (
                      <>
                        <IconButton
                          aria-label={`${item.name}のその他操作`}
                          aria-expanded={openMenuId === item.id}
                          onClick={() =>
                            setOpenMenuId((current) => (current === item.id ? null : item.id))
                          }
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
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
        </DataTable>
        </div>
      )}
      {!loading && !error && items.length > 0 ? (
        <div className="border-hairline flex items-center justify-between border-x border-b bg-canvas px-4 py-3 text-xs text-ink-faint">
          <ListRange total={total} first={(page - 1) * PAGE_SIZE + 1} last={Math.min(page * PAGE_SIZE, total)} />
          <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} onPageChange={setPage} />
        </div>
      ) : null}
      {/* 監査 R480: 利用中は件数と理由を示して止める。保管済みの閲覧・復元もここ。 */}
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
          <p className="text-ink-secondary mt-3 text-sm" role="alert">
            利用中のため保管できません（{archiving.item.bindingCount}か所）。先に利用先を外してください。
          </p>
        ) : null}
        {archiveError ? <p className="text-danger mt-3 text-sm" role="alert">{archiveError}</p> : null}
      </Dialog>
    </div>
  )
}
