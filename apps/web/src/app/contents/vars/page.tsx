'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CommonVar, CommonVarDeleteImpact, Folder } from '@line-crm/shared'
import {
  api,
  ApiError,
  type CommonVarReplacementCandidate,
  type CommonVarReplacementImpact,
} from '@/lib/api'
import FolderPanel from '@/components/shared/folder-panel'
import { formatStamp } from '@/lib/common-vars'
import Pagination from '@/components/shared/pagination'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { TableHeadRow, Th } from '@/components/shared/table'
import {
  blockedReason,
  canDelete as canDeleteVar,
  checkedAtText,
  consequenceText,
  placeholderText,
  splitItems,
  unavailableText,
  usageText,
} from './delete-impact'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import SelectField from '@/components/shared/select-field'
import {
  commonVarsCsv,
  filterAndSortCommonVars,
  type CommonVarFilter,
  type CommonVarOrder,
} from './list-model'

/**
 * 共通情報の一覧。
 *
 * Lステップの「コンテンツ ＞ 共通情報」と同じ形にしてある。
 * 左にフォルダの縦パネル、右に一覧。上に「新しいフォルダ」「新しい共通情報」、
 * 一覧の右肩に並び替えと検索。以前は /contents のタブの片方に入れていたが、
 * サイドバーから直接開けないので、独立した画面にした。
 */

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNGROUPED = '__ungrouped__'

/*
 * 一括削除の上限。1件ごとに使用先9種の走査が走るため、
 * 件数に比例してWorker・D1が重くなる。上限を超えたら確認口を打たず、
 * 絞り込みで分けるよう案内する。
 */
const MAX_BATCH_DELETE_COUNT = 20

/*
 * 一覧の更新日は、次回変更と同じセルに収まる短い形で出す。
 * `formatStamp`（`@/lib/common-vars`）とは別物。あちらは履歴・予定の
 * 「いつ」を読ませる長い形。用途が違うので統一せず、名前で使い分ける。
 */
function formatListDate(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[1]}/${match[2]}` : value
}

function VarsPageInner() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()

  const [items, setItems] = useState<CommonVar[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 一覧が件数上限で切られたときに絞り込み誘導を出す。 */
  const [listLimited, setListLimited] = useState(false)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [stateFilter, setStateFilter] = useState<CommonVarFilter>('all')
  const [order, setOrder] = useState<CommonVarOrder>('usage_desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTargets, setDeleteTargets] = useState<CommonVar[]>([])
  /** 1件ずつの削除確認（設計 `yPkWe`）。 */
  const [singleTarget, setSingleTarget] = useState<CommonVar | null>(null)
  const [singleImpact, setSingleImpact] = useState<CommonVarDeleteImpact | null>(null)
  const [singlePhase, setSinglePhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [singleBusy, setSingleBusy] = useState(false)
  const [singleError, setSingleError] = useState('')
  const [replacementCandidates, setReplacementCandidates] = useState<CommonVarReplacementCandidate[]>([])
  const [replacementId, setReplacementId] = useState('')
  const [replacementImpact, setReplacementImpact] = useState<CommonVarReplacementImpact | null>(null)
  const [replacementPhase, setReplacementPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /** 確認のために打ってもらう差し込みキー。 */
  const [typedKey, setTypedKey] = useState('')
  /** いま影響を読んでいるアカウント・対象・世代。遅れて返った別の結果を捨てるために持つ。 */
  const singleRequestRef = useRef({ accountId: selectedAccountId, itemId: null as string | null, generation: 0 })
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteRequestRef = useRef({ accountId: selectedAccountId, generation: 0 })

  /** 選んでいるフォルダ。URLに出して、戻るとブックマークを壊さない。 */
  const folderFilter = params.get('folder') ?? ''
  const setFolderFilter = (id: string) => {
    setPage(1)
    router.replace(id ? `/contents/vars?folder=${encodeURIComponent(id)}` : '/contents/vars')
  }

  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  const load = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [vars, folderList] = await Promise.all([
        api.commonVars.list(accountAtRequest),
        api.folders.list('common_var'),
      ])
      if (accountAtRequest !== latestAccountRef.current) return
      if (vars.success) {
        setItems(vars.data)
        setListLimited(vars.meta?.limited ?? false)
      }
      if (folderList.success) setFolders(folderList.data)
    } catch (e) {
      // 権限なしと通信障害で文言を分ける。同じ文言だと運用者が接続を
      // 確かめ続け、権限申請に気づけない。
      if (accountAtRequest === latestAccountRef.current) {
        setError(e instanceof ApiError && e.status === 403
          ? 'この一覧を見る権限がありません。管理者に権限を申請してください。'
          : '読み込みに失敗しました。接続を確かめて、もう一度お試しください。')
      }
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    singleRequestRef.current = {
      accountId: selectedAccountId,
      itemId: null,
      generation: singleRequestRef.current.generation + 1,
    }
    setSingleTarget(null)
    setSingleImpact(null)
    setSinglePhase('idle')
    setSingleBusy(false)
    setSingleError('')
    setTypedKey('')
    setReplacementCandidates([])
    setReplacementId('')
    setReplacementImpact(null)
    setReplacementPhase('idle')
    deleteRequestRef.current = {
      accountId: selectedAccountId,
      generation: deleteRequestRef.current.generation + 1,
    }
    setSelected(new Set())
    setDeleteTargets([])
    setDeleting(false)
    setDeleteError('')
    setListLimited(false)
  }, [selectedAccountId])

  const filtered = useMemo(
    () => filterAndSortCommonVars(items, {
      query,
      folderId: folderFilter,
      ungroupedValue: UNGROUPED,
      filter: stateFilter,
      order,
    }),
    [folderFilter, items, order, query, stateFilter],
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  )

  const emptyInUseCount = useMemo(
    () => items.filter((item) => item.value === '' && typeof item.usageCount === 'number' && item.usageCount > 0).length,
    [items],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const exportVisibleCsv = () => {
    if (filtered.length === 0) return
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${commonVarsCsv(filtered)}`], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'common-information.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const addFolder = async () => {
    const name = folderName.trim()
    if (!name || savingFolder) return
    setSavingFolder(true)
    setError('')
    try {
      const res = await api.folders.create({ kind: 'common_var', name })
      if (!res.success) {
        setError(res.error)
        return
      }
      setFolderName('')
      setAddingFolder(false)
      void load()
    } catch {
      setError('フォルダを作れませんでした')
    } finally {
      setSavingFolder(false)
    }
  }

  /*
    1件ずつの削除確認（設計 `yPkWe`）。**窓を開けてから読む。**
    一覧を出すたびに全件ぶん読むと、消さない人にも8種類の走査が走る。
  */
  const openSingleDelete = async (item: CommonVar) => {
    setSingleTarget(item)
    setTypedKey('')
    setSingleError('')
    setSingleImpact(null)
    setSinglePhase('loading')
    setReplacementCandidates([])
    setReplacementId('')
    setReplacementImpact(null)
    setReplacementPhase('loading')
    if (!selectedAccountId) {
      setSinglePhase('error')
      return
    }
    /*
      **遅れて返った別の共通情報の結果を映さない。** Aを読み込み中に窓を
      閉じてBを開くと、あとから返るAの結果がBの窓に出る。読んでいるものと
      押せるものが食い違う。
    */
    const request = {
      accountId: selectedAccountId,
      itemId: item.id,
      generation: singleRequestRef.current.generation + 1,
    }
    singleRequestRef.current = request
    const isCurrentRequest = () =>
      singleRequestRef.current.accountId === request.accountId &&
      singleRequestRef.current.itemId === request.itemId &&
      singleRequestRef.current.generation === request.generation
    const [impactResult, candidatesResult] = await Promise.allSettled([
      api.commonVars.deleteImpact(request.itemId, request.accountId),
      api.commonVars.replacementCandidates(request.itemId, request.accountId),
    ])
    if (!isCurrentRequest()) return
    if (impactResult.status === 'rejected' || !impactResult.value.success) {
      setSinglePhase('error')
      setReplacementPhase('error')
      return
    }
    setSingleImpact(impactResult.value.data)
    setSinglePhase('ready')
    if (candidatesResult.status === 'rejected' || !candidatesResult.value.success) {
      setReplacementPhase('error')
      return
    }
    setReplacementCandidates(candidatesResult.value.data.candidates)
    const first = candidatesResult.value.data.candidates[0]
    if (!first) {
      setReplacementPhase('ready')
      return
    }
    setReplacementId(first.id)
    try {
      const preview = await api.commonVars.replacementImpact(request.itemId, request.accountId, first.id)
      if (!isCurrentRequest()) return
      if (!preview.success) throw new Error('replacement_impact_failed')
      setReplacementImpact(preview.data)
      setReplacementPhase('ready')
    } catch {
      if (!isCurrentRequest()) return
      setReplacementPhase('error')
    }
  }

  const selectReplacement = async (nextId: string) => {
    if (!singleTarget || !selectedAccountId) return
    setReplacementId(nextId)
    setReplacementImpact(null)
    if (!nextId) {
      setReplacementPhase('ready')
      return
    }
    const request = {
      accountId: selectedAccountId,
      itemId: singleTarget.id,
      generation: singleRequestRef.current.generation + 1,
    }
    singleRequestRef.current = request
    setReplacementPhase('loading')
    try {
      const res = await api.commonVars.replacementImpact(request.itemId, request.accountId, nextId)
      if (singleRequestRef.current.generation !== request.generation) return
      if (!res.success) throw new Error('replacement_impact_failed')
      setReplacementImpact(res.data)
      setReplacementPhase('ready')
    } catch {
      if (singleRequestRef.current.generation === request.generation) setReplacementPhase('error')
    }
  }

  const confirmReplacement = async () => {
    if (!singleTarget || !selectedAccountId || !replacementImpact?.canReplace || singleBusy) return
    const request = {
      accountId: selectedAccountId,
      itemId: singleTarget.id,
      generation: singleRequestRef.current.generation + 1,
    }
    singleRequestRef.current = request
    setSingleBusy(true)
    setSingleError('')
    try {
      const res = await api.commonVars.replace(request.itemId, request.accountId, {
        replacementId: replacementImpact.replacement.id,
        expectedVersion: replacementImpact.source.version,
        expectedRevision: replacementImpact.revision,
      })
      if (singleRequestRef.current.generation !== request.generation) return
      if (!res.success) throw new Error('replace_failed')
      singleRequestRef.current = {
        accountId: selectedAccountId,
        itemId: null,
        generation: request.generation + 1,
      }
      setSingleTarget(null)
      setSingleImpact(null)
      setSinglePhase('idle')
      setSingleBusy(false)
      setReplacementCandidates([])
      setReplacementId('')
      setReplacementImpact(null)
      setReplacementPhase('idle')
      await load()
    } catch (error) {
      if (singleRequestRef.current.generation !== request.generation) return
      if (error instanceof ApiError && error.status === 409) {
        setSingleError('使用先が変わりました。影響をもう一度確認してください。')
        setSingleBusy(false)
        await selectReplacement(replacementImpact.replacement.id)
      } else {
        setSingleError('差し替えを完了できませんでした。状態を読み直して、もう一度お試しください。')
      }
    } finally {
      if (singleRequestRef.current.generation === request.generation) setSingleBusy(false)
    }
  }

  const confirmSingleDelete = async () => {
    if (!singleTarget || !selectedAccountId || singleBusy) return
    const request = {
      accountId: selectedAccountId,
      itemId: singleTarget.id,
      generation: singleRequestRef.current.generation + 1,
    }
    singleRequestRef.current = request
    const isCurrentRequest = () =>
      singleRequestRef.current.accountId === request.accountId &&
      singleRequestRef.current.itemId === request.itemId &&
      singleRequestRef.current.generation === request.generation
    setSingleBusy(true)
    setSingleError('')
    try {
      const res = await api.commonVars.delete(request.itemId, request.accountId)
      if (!isCurrentRequest()) return
      if (!res.success) throw new Error('delete_failed')
      setSingleTarget(null)
      setSingleImpact(null)
      setSinglePhase('idle')
      await load()
    } catch (e) {
      if (!isCurrentRequest()) return
      if (e instanceof ApiError && e.status === 409) {
        /*
          **409は「読んだあとに使われ始めた」。** 消せない理由が変わって
          いるので、影響を読み直してから見せる。
        */
        setSingleError('いま使われ始めたため、削除できませんでした。使用先を読み直しました。')
        try {
          const again = await api.commonVars.deleteImpact(request.itemId, request.accountId)
          if (!isCurrentRequest()) return
          if (again.success) setSingleImpact(again.data)
        } catch {
          if (isCurrentRequest()) setSinglePhase('error')
        }
        return
      }
      setSingleError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      if (isCurrentRequest()) setSingleBusy(false)
    }
  }

  const closeSingleDelete = () => {
    if (singleBusy) return
    singleRequestRef.current = {
      accountId: selectedAccountId,
      itemId: null,
      generation: singleRequestRef.current.generation + 1,
    }
    setSingleTarget(null)
    setSingleImpact(null)
    setSinglePhase('idle')
    setSingleError('')
    setTypedKey('')
    setReplacementCandidates([])
    setReplacementId('')
    setReplacementImpact(null)
    setReplacementPhase('idle')
  }

  const prepareRemoveSelected = async () => {
    if (selected.size === 0 || !selectedAccountId) return
    if (selected.size > MAX_BATCH_DELETE_COUNT) {
      setError(`一度に削除できるのは${MAX_BATCH_DELETE_COUNT}件までです。フォルダや検索で絞り込んで分けて削除してください。`)
      return
    }
    const request = {
      accountId: selectedAccountId,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    const isCurrentRequest = () =>
      deleteRequestRef.current.accountId === request.accountId &&
      deleteRequestRef.current.generation === request.generation
    setError('')
    setDeleteError('')
    try {
      const impacts = await Promise.all(
        [...selected].map(async (id) => {
          const response = await api.commonVars.deleteImpact(id, request.accountId)
          if (!response.success) throw new Error(response.error)
          return { id, impact: response.data }
        }),
      )
      if (!isCurrentRequest()) return
      const blocked = impacts.filter(({ impact }) => !impact.canDelete)
      if (blocked.length > 0) {
        const references = blocked.reduce((sum, { impact }) => sum + impact.total, 0)
        setError(`${blocked.length}件は、合計${references}か所で使用中のため削除できません。`)
        return
      }
    } catch {
      if (!isCurrentRequest()) return
      setError('使用先を確認できないため削除できません。もう一度お試しください。')
      return
    }

    if (!isCurrentRequest()) return
    const targets = items.filter((item) => selected.has(item.id))
    if (targets.length !== selected.size) {
      setError('選択した共通情報を確認できませんでした。状態を読み直してから、もう一度お試しください。')
      return
    }
    setDeleteTargets(targets)
  }

  const removeSelected = async () => {
    if (deleteTargets.length === 0 || !selectedAccountId || deleting) return
    const request = {
      accountId: selectedAccountId,
      generation: deleteRequestRef.current.generation + 1,
    }
    deleteRequestRef.current = request
    const isCurrentRequest = () =>
      deleteRequestRef.current.accountId === request.accountId &&
      deleteRequestRef.current.generation === request.generation
    const targets = [...deleteTargets]
    setDeleting(true)
    setDeleteError('')
    const failed: CommonVar[] = []
    for (const target of targets) {
      try {
        const result = await api.commonVars.delete(target.id, request.accountId)
        if (!result.success) throw new Error(result.error)
      } catch {
        failed.push(target)
      }
      if (!isCurrentRequest()) return
    }

    try {
      if (!isCurrentRequest()) return
      if (failed.length > 0) {
        setDeleteTargets(failed)
        setSelected(new Set(failed.map((item) => item.id)))
        setDeleteError(
          failed.length === targets.length
            ? '選択した共通情報を削除できませんでした。状態を読み直してから、もう一度お試しください。'
            : `${failed.length}件の共通情報を削除できませんでした。削除できなかったものだけを残しています。`,
        )
        await load()
        return
      }

      setDeleteTargets([])
      setSelected(new Set())
      await load()
    } finally {
      if (isCurrentRequest()) setDeleting(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOnPageSelected = current.length > 0 && current.every((item) => selected.has(item.id))

  return (
    <div data-design-node="WuKzU">
      {!selectedAccountId && !accountLoading && (
        <ListState kind="empty" title="LINEアカウントを選択してください" description="共通情報はLINEアカウントごとに管理します。" />
      )}
      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setAddingFolder(true)}>フォルダを追加</Button>
          <Button href="/contents/vars/new" variant="primary">＋ 共通情報を作る</Button>
        </div>
        <Button type="button" onClick={exportVisibleCsv} disabled={filtered.length === 0}>
          CSVで書き出す
        </Button>
      </div>

      {emptyInUseCount > 0 ? (
        <div className="bg-status-warning-soft text-status-warning mb-4 rounded-control px-4 py-3 text-sm font-semibold" role="status">
          中身が空のまま使われているものが {emptyInUseCount.toLocaleString('ja-JP')}件あります。差し込んだところが空欄のまま送られます。
        </div>
      ) : null}

      {listLimited ? (
        <div className="bg-status-warning-soft text-status-warning mb-4 rounded-control px-4 py-3 text-sm font-semibold" role="status">
          表示は最初の200件までです。フォルダや検索で絞り込んでください。
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <FolderPanel
            total={`${items.length} 件`}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            rows={[
              { id: '', label: 'すべて', count: items.length },
              {
                id: UNGROUPED,
                label: '未分類',
                count: items.filter((item) => item.folderId === null).length,
              },
              ...folders.map((folder) => ({
                id: folder.id,
                label: folder.name,
                count: items.filter((item) => item.folderId === folder.id).length,
                color: folder.color,
              })),
            ]}
          >
            {addingFolder ? (
              <div className="space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addFolder()
                    if (e.key === 'Escape') setAddingFolder(false)
                  }}
                  placeholder="フォルダ名を入力"
                  aria-label="フォルダ名"
                  className="border-hairline rounded-control focus:ring-accent w-full border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setAddingFolder(false)
                      setFolderName('')
                    }}
                    className="border-hairline text-ink-secondary rounded-control border px-3 py-1 text-xs"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => void addFolder()}
                    disabled={!folderName.trim() || savingFolder}
                    className="bg-accent-deep text-on-accent rounded-control px-3 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    決定
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-ink-faint text-xs leading-relaxed">
                フォルダを消しても、入っていた共通情報は未分類として残ります。
              </p>
            )}
          </FolderPanel>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="名前・差し込みキー・中身で検索"
              aria-label="共通情報を検索"
              className="border-hairline rounded-control focus:ring-accent min-w-64 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <SelectField
              size="compact"
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
              aria-label="表示件数"
              options={[20, 50, 100].map((value) => ({ value: String(value), label: `${value}件表示` }))}
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([
              ['all', 'すべて'],
              ['empty', '空のまま'],
              ['scheduled', '期限つき'],
              ['unused', '使われていない'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={stateFilter === value}
                onClick={() => {
                  setStateFilter(value)
                  setPage(1)
                }}
                className={stateFilter === value
                  ? 'border-accent bg-accent-soft text-accent rounded-pill border px-3 py-1.5 text-xs font-semibold'
                  : 'border-hairline bg-canvas text-ink-secondary rounded-pill border px-3 py-1.5 text-xs font-semibold'}
              >
                {label}
              </button>
            ))}
            <SelectField
              value={order}
              onChange={(event) => setOrder(event.target.value as CommonVarOrder)}
              aria-label="並び順"
              options={[
                { value: 'usage_desc', label: '使われている数が多い順' },
                { value: 'updated_desc', label: '更新が新しい順' },
                { value: 'name_asc', label: '名前順' },
              ]}
            />
          </div>

          <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] table-fixed">
                <thead>
                  <TableHeadRow className="bg-canvas-sunken border-hairline border-b">
                    <Th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            for (const item of current) {
                              if (allOnPageSelected) next.delete(item.id)
                              else next.add(item.id)
                            }
                            return next
                          })
                        }
                        aria-label="このページの共通情報をすべて選ぶ"
                        className="accent-green-500"
                      />
                    </Th>
                    <Th className="px-4 py-3" style={{ width: '14%' }}>
                      共通情報
                    </Th>
                    <Th className="px-4 py-3" style={{ width: '17%' }}>
                      差し込みキー
                    </Th>
                    <Th className="px-4 py-3">中身</Th>
                    <Th className="px-4 py-3" style={{ width: '14%' }}>
                      使われている場所
                    </Th>
                    <Th className="px-4 py-3" style={{ width: '21%' }}>
                      更新・次の変更
                    </Th>
                    <Th align="right" className="w-28 px-4 py-3">操作</Th>
                  </TableHeadRow>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="text-ink-faint px-4 py-8 text-center text-sm">
                        <ListState kind="loading" title="共通情報を読み込んでいます" />
                      </td>
                    </tr>
                  ) : current.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-ink-faint px-4 py-8 text-center text-sm">
                        <ListState
                          kind="empty"
                          title={items.length === 0
                            ? 'まだ共通情報がありません'
                            : '条件に合う共通情報はありません'}
                          description={items.length === 0
                            ? '何度も使う営業時間や会社名を登録できます。'
                            : '検索語やフォルダを変えてください。'}
                          action={items.length === 0
                            ? <Button href="/contents/vars/new" variant="primary">共通情報を作る</Button>
                            : undefined}
                        />
                      </td>
                    </tr>
                  ) : (
                    current.map((item) => {
                      const pending = item.nextSchedule
                      return (
                        <tr key={item.id} className="hover:bg-canvas-sunken">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggle(item.id)}
                              aria-label={`${item.name}を選ぶ`}
                              className="accent-green-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/contents/vars/edit?id=${item.id}`}
                              title={item.name}
                              className="text-info block truncate text-sm font-medium hover:underline"
                            >
                              {item.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {/* 差し込みの書き方を独立した列に出す。名前と混ぜず、
                                テンプレートを書くときに横へ追って確認できる。 */}
                            <code
                              title={placeholderText(item.name)}
                              className="text-ink-faint block truncate whitespace-nowrap text-xs"
                            >{placeholderText(item.name)}</code>
                          </td>
                          <td title={item.value || '（空）'} className="text-ink truncate px-4 py-3 text-sm">
                            {item.value || <span className="text-ink-faint">（空）</span>}
                          </td>
                          <td className="text-ink-secondary whitespace-nowrap px-4 py-3 text-xs">
                            {item.usageCount === undefined
                              ? '—（未取得）'
                              : item.usageCount === 0
                                ? '使われていません'
                                : `${item.usageCount.toLocaleString('ja-JP')}か所`}
                          </td>
                          <td className="text-ink-secondary px-4 py-3 text-xs">
                            <span className="whitespace-nowrap">{formatListDate(item.updatedAt)}</span>
                            {!pending ? (
                              <span className="text-ink-faint whitespace-nowrap"> ／ 予定なし</span>
                            ) : (
                              <>
                                <span className="text-ink-faint whitespace-nowrap"> ／ {formatStamp(pending.effectiveFrom)} に</span>
                                <span className="text-ink-faint"> {pending.value || '（空）'}へ</span>
                                {(item.pendingScheduleCount ?? 0) > 1 && (
                                  <span className="text-ink-faint"> ほか{(item.pendingScheduleCount ?? 1) - 1}件</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <Link
                              href={`/contents/vars/edit?id=${item.id}`}
                              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-xs"
                            >
                              編集
                            </Link>
                            <Button
                              type="button"
                              onClick={() => void openSingleDelete(item)}
                              data-qa-open="yPkWe"
                              aria-label={`${item.name}を削除`}
                              className="ml-2"
                            >
                              削除
                            </Button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

            <button
              onClick={() => void prepareRemoveSelected()}
              data-qa-open="yPkWe"
              disabled={selected.size === 0}
              className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              選択した共通情報を削除
              {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
            </button>
          </div>
        </div>
      </div>

      {/*
        1件ずつの削除確認（設計 `yPkWe`）。**消すと差し込んでいた場所が
        空欄のまま送られる**ので、何か所でそれが起きるのかを先に言う。
      */}
      <Dialog
        open={singleTarget !== null}
        designNode="yPkWe"
        tone="destructive"
        title={singleTarget ? `共通情報「${singleTarget.name}」を削除しますか？` : ''}
        description="この共通情報と、登録値・次回予約を削除します。テンプレート・配信・フォルダ・友だちは削除しません。"
        busy={singleBusy}
        error={singleError || undefined}
        onCancel={closeSingleDelete}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-faint text-micro">この操作は取り消せません</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={closeSingleDelete}
                disabled={singleBusy}
              >
                キャンセル
              </Button>
              {singleImpact && !singleImpact.canDelete && replacementImpact?.canReplace ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void confirmReplacement()}
                  disabled={singleBusy || replacementPhase !== 'ready'}
                >
                  {singleBusy ? '差し替え中…' : '差し替えて削除'}
                </Button>
              ) : null}
              {singleImpact && !singleImpact.canDelete ? (
                <Button
                  type="button"
                  disabled
                  title="使用中の共通情報は削除できません"
                >
                  このまま削除
                </Button>
              ) : null}
              {/* 消せないときは押し口ごと出さない。押せるように見えて何も起きない形にしない。 */}
              {canDeleteVar({ impact: singleImpact, typedKey, busy: singleBusy }) ? (
                <Button type="button" variant="primary" onClick={() => void confirmSingleDelete()}>
                  {singleBusy ? '処理中…' : 'このまま削除する'}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div data-design-node="yPkWe">
          {singlePhase === 'loading' ? (
            <p className="text-ink-faint text-xs">使われている場所を確認しています…</p>
          ) : singlePhase === 'error' ? (
            <p className="text-danger text-xs font-semibold" role="alert">
              使用先を確認できませんでした。読み直してから、もう一度お試しください。
            </p>
          ) : singleImpact ? (
            <div className="space-y-3">
              <p className={singleImpact.total > 0 ? 'text-danger text-sm font-semibold' : 'text-ink-secondary text-sm'}>
                {usageText(singleImpact)}
              </p>
              {consequenceText(singleImpact) ? (
                <p className="text-ink-secondary text-xs leading-5">{consequenceText(singleImpact)}</p>
              ) : null}

              <div>
                <h3 className="text-ink text-sm font-bold">どうしますか</h3>
                <div className="mt-2 space-y-2">
                  <div className="border-accent bg-accent-soft rounded-control border p-3">
                    <p className="text-accent text-sm font-bold">別の共通情報に差し替えてから削除する（おすすめ）</p>
                    <p className="text-ink-secondary mt-1 text-xs leading-5">
                      {singleImpact.blockingTotal.toLocaleString('ja-JP')}か所の差し込みを、選んだ別のキーへ置き換えます。置き換え後は元の共通情報を履歴が残る形で保管します。
                    </p>
                    <label className="text-ink-secondary mt-2 block text-xs font-semibold">
                      差し替え先
                      <SelectField
                        value={replacementId}
                        disabled={singleBusy || replacementCandidates.length === 0}
                        onChange={(event) => void selectReplacement(event.target.value)}
                        aria-label="差し替え先"
                        className="mt-1 w-full"
                        style={{ width: '100%' }}
                        options={replacementCandidates.length > 0
                          ? replacementCandidates.map((candidate) => ({
                              value: candidate.id,
                              label: `${placeholderText(candidate.name)} — ${candidate.value || '（空）'}`,
                            }))
                          : [{ value: '', label: replacementPhase === 'loading' ? '候補を読み込んでいます' : '差し替えられる候補がありません' }]}
                      />
                    </label>
                    {replacementPhase === 'loading' ? (
                      <p className="text-ink-faint mt-2 text-xs">差し替え後の影響を確認しています…</p>
                    ) : replacementPhase === 'error' ? (
                      <p className="text-danger mt-2 text-xs font-semibold">差し替え後の影響を確認できませんでした。</p>
                    ) : replacementImpact ? (
                      <p className={replacementImpact.canReplace ? 'text-success mt-2 text-xs font-semibold' : 'text-danger mt-2 text-xs font-semibold'}>
                        {replacementImpact.canReplace
                          ? `${replacementImpact.replaceableTotal.toLocaleString('ja-JP')}か所を差し替え、元の共通情報を保管できます。`
                          : `${replacementImpact.blockedTotal.toLocaleString('ja-JP')}か所は自動で差し替えられません。先に個別に確認してください。`}
                      </p>
                    ) : null}
                  </div>
                  <div className="border-hairline rounded-control border p-3" aria-disabled={!singleImpact.canDelete}>
                    <p className="text-ink text-sm font-bold">このまま削除する</p>
                    <p className="text-ink-secondary mt-1 text-xs leading-5">
                      {singleImpact.canDelete
                        ? '使われている場所が無いことを確認してから削除します。'
                        : `${singleImpact.blockingTotal.toLocaleString('ja-JP')}か所が空欄になるため、先に使用先を直してください。`}
                    </p>
                  </div>
                </div>
              </div>

              {splitItems(singleImpact.items).blocking.length > 0 ? (
                <div>
                  <p className="text-ink text-xs font-bold">削除できない理由になっている場所</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {splitItems(singleImpact.items).blocking.map((item) => (
                      <li key={`${item.kind}-${item.href}`} className="border-hairline flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2 text-xs">
                        <span className="min-w-0">
                          <span className="text-ink font-semibold">{item.kindLabel}</span>
                          <span className="text-ink-secondary">「{item.name}」・{item.status}</span>
                        </span>
                        <a href={item.href} className="text-action shrink-0 font-semibold">ここを開く</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                **送信済みは消せない理由に混ぜない。** もう送ったものなので
                これから変わることが無い。混ぜると「なぜ消せないのか」が読めない。
              */}
              {splitItems(singleImpact.items).historical.length > 0 ? (
                <p className="text-ink-faint text-micro leading-5">
                  すでに送った{splitItems(singleImpact.items).historical.length}件は、これから変わりません（
                  {splitItems(singleImpact.items).historical.map((item) => `${item.kindLabel}「${item.name}」`).join('／')}）。
                </p>
              ) : null}

              {unavailableText(singleImpact) ? (
                <p className="text-ink-faint text-micro leading-5">{unavailableText(singleImpact)}</p>
              ) : null}

              {/*
                **差し込みキーを打ってもらう。** 空欄のまま送られる場所がある
                操作を、ボタン1つで通さない。
              */}
              {singleImpact.canDelete ? (
                <label className="block">
                  <span className="text-ink-secondary text-xs font-semibold">
                    削除する場合は、差し込みキーを入力してください
                  </span>
                  <input
                    value={typedKey}
                    onChange={(e) => setTypedKey(e.target.value)}
                    placeholder={placeholderText(singleImpact.variable.name)}
                    className="border-hairline rounded-control bg-canvas text-ink mt-1 w-full border px-3 py-2 text-sm"
                  />
                </label>
              ) : null}

              {blockedReason({ impact: singleImpact, typedKey }) ? (
                <p className="text-ink-faint text-micro">{blockedReason({ impact: singleImpact, typedKey })}</p>
              ) : null}

              <p className="text-ink-faint text-micro leading-5">
                {checkedAtText(singleImpact.checkedAt)} 時点で、テンプレート・一斉配信・シナリオ・リマインダ・自動応答・回答フォーム・オートメーション・友だち追加時・共通アクションの9種類を確認しました。
                差し替え前にも使用先の世代を再確認します。
              </p>
            </div>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteTargets.length > 0}
        title={deleteTargets.length === 1
          ? `「${deleteTargets[0]?.name ?? ''}」を削除しますか？`
          : `「${deleteTargets[0]?.name ?? ''}」ほか${deleteTargets.length - 1}件を削除しますか？`}
        description={`選択した${deleteTargets.length}件の共通情報と、登録値・次回予約を削除します。テンプレート、配信、フォルダ、友だちは削除しません。この操作は元に戻せません。`}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void removeSelected()}
        onCancel={() => {
          if (deleting) return
          deleteRequestRef.current = {
            accountId: selectedAccountId,
            generation: deleteRequestRef.current.generation + 1,
          }
          setDeleteError('')
          setDeleteTargets([])
        }}
      />
    </div>
  )
}

export default function CommonVarsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <VarsPageInner />
    </Suspense>
  )
}
