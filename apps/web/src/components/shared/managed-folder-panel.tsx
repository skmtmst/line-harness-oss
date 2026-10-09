'use client'

/*
 * ★V8 一覧の左のフォルダの列を、全部の一覧で同じにするための部品（B-136 2026-10-09「統一になっていない」）。
 *
 * そろっている一覧（一斉配信・回答フォーム・テンプレート・タグ・友だち情報・ウェビナー・統括のホーム）と同じ形：
 *   ［作る］ボタン（列の上）→「フォルダ」の見出し → すべて → 各フォルダ（色の丸・数・「…」）→ 未分類
 *   →「フォルダを追加」→「フォルダを消しても、中の〇〇は未分類に残ります」
 * 「…」の中は 名前を変える・色を変える・並べ替える（上へ・下へ）・消す（共通の useFolderRowActions）。
 *
 * 保存先は共通の `/api/folders`（kind ごと・packages/db/src/folders.ts の FOLDER_KINDS）。
 * 画面は `useManagedFolders(kind, accountId)` で読み、同じ `folders` を行の名前の前の丸にも使う。
 *
 * `kind={null}` はフォルダの受け口（API）がまだ無い一覧。「すべて」だけを出し、
 * 追加・「…」・未分類・注は出さない（押せない口を置かない）。API ができたら kind を渡すだけで全部が出る。
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import FolderPanel, { type FolderPanelRow } from './folder-panel'
import FolderAddDialog from './folder-add-dialog'
import { useFolderRowActions } from './folder-row-actions'
import styles from './managed-folder-panel.module.css'

export interface ManagedFoldersState {
  folders: Folder[]
  /** サーバーが同じ母集団で数えた未分類の件数。数えていない種類は null。 */
  unfiledCount: number | null
  loaded: boolean
  error: string
  reload: () => Promise<void>
}

/**
 * 共通の `/api/folders` を読む。アカウントを切り替えたら前のアカウントのフォルダを捨てて読み直す。
 * `kind` が null（API が無い一覧）のときは何も読まない。
 */
export function useManagedFolders(kind: string | null, accountId?: string | null, options: { enabled?: boolean } = {}): ManagedFoldersState {
  const enabled = options.enabled ?? true
  const [folders, setFolders] = useState<Folder[]>([])
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    if (!kind || !enabled) {
      setFolders([])
      setUnfiledCount(null)
      setLoaded(true)
      return
    }
    setError('')
    try {
      const res = await api.folders.list(kind, accountId ?? undefined)
      if (request !== requestRef.current) return
      if (res.success && Array.isArray(res.data)) {
        setFolders(res.data)
        setUnfiledCount(typeof res.unfiledCount === 'number' ? res.unfiledCount : null)
      } else {
        setError('フォルダを読み込めませんでした。')
      }
    } catch {
      if (request === requestRef.current) setError('フォルダを読み込めませんでした。')
    } finally {
      if (request === requestRef.current) setLoaded(true)
    }
  }, [accountId, enabled, kind])

  useEffect(() => {
    setFolders([])
    setUnfiledCount(null)
    setLoaded(false)
    void reload()
  }, [reload])

  return { folders, unfiledCount, loaded, error, reload }
}

/** 畳んだ板の道具の段など、列の外から同じ窓を開くための口。 */
export interface ManagedFolderControl {
  startAdd: () => void
  startEdit: (folder: Folder) => void
  startDelete: (folder: Folder) => void
}

export interface ManagedFolderPanelProps {
  /** `folders.kind`。null はフォルダの API がまだ無い一覧（「すべて」だけ）。 */
  kind: string | null
  accountId?: string | null
  /** `useManagedFolders` で読んだもの。画面の行の丸と同じものを渡す。 */
  folders: Folder[]
  /** 足した・直した・消した・並べ替えたあとに読み直す（一覧の件数も読み直すときは画面で足す）。 */
  onChanged: () => void | Promise<void>
  /** フォルダを変えてよい人だけ true。false は追加・「…」を出さない（閲覧のみ）。 */
  canManage: boolean
  /** 中身の呼び名（例：シナリオ）。注と確認の窓の言葉に使う。 */
  itemLabel: string
  activeId: string
  onSelect: (id: string) => void
  /** 「すべて」「未分類」の行の id。画面が URL に書く値と同じにする。 */
  allId?: string
  unfiledId?: string
  /** 「すべて」の件数。数えていないときは null（数字を出さない）。 */
  allCount: number | null
  /** 「未分類」の件数。省くとサーバーの数（useManagedFolders の unfiledCount）を画面が渡す。 */
  unfiledCount?: number | null
  /** フォルダの件数。既定はサーバーの itemCount。 */
  countOf?: (folder: Folder) => number | null
  /** 列の上の［作る］ボタン。閲覧のみは渡さない。 */
  createAction?: ReactNode
  /** 閲覧のみで［作る］を隠すときも、フォルダの位置を変えない。 */
  reserveCreateSpace?: boolean
  /** 消したフォルダを選んでいたときに「すべて」へ戻す。既定は onSelect(allId)。 */
  onDeleted?: (folderId: string) => void
  /** 読み込みの失敗など、列の下に1行だけ出すもの。 */
  error?: string
  placeholder?: string
  /** 注の下に足すもの（画面に固有の補足）。 */
  children?: ReactNode
  /** 選ぶ窓の中など、行の選択だけにするとき。 */
  disabled?: boolean
  /** 「フォルダを追加」を押したとき、窓を開く前にすること（開いている詳細の小窓を閉じるなど）。 */
  onAddStart?: () => void
  /** 作ったフォルダを選ぶなど、追加できたあとにすること（読み直しは onChanged が行う）。 */
  onAdded?: (folder: Folder) => void
  /** 列が畳まれているときに、道具の段の「フォルダの操作」から同じ窓を開く。変えてよい人のときだけ働く。 */
  controlRef?: Ref<ManagedFolderControl>
}

/**
 * 畳んだ幅のフォルダの選ぶ欄の中身（列と同じ並び：すべて→各フォルダ→未分類）。
 * kind が null の一覧は「すべて」だけ。
 */
export function managedFolderOptions(kind: string | null, folders: Folder[], { allId = 'all', unfiledId = 'unfiled' }: { allId?: string; unfiledId?: string } = {}) {
  return [
    { value: allId, label: 'フォルダ：すべて' },
    ...(kind ? folders.map((folder) => ({ value: folder.id, label: `フォルダ：${folder.name}` })) : []),
    ...(kind ? [{ value: unfiledId, label: 'フォルダ：未分類' }] : []),
  ]
}

/** 畳んだ板の folderNav（ListPage の型）に渡す行。並びは列と同じ。 */
export function managedFolderNavRows(kind: string | null, folders: Folder[], { allId = 'all', unfiledId = 'unfiled' }: { allId?: string; unfiledId?: string } = {}) {
  return [
    { id: allId, label: 'すべて' },
    ...(kind ? folders.map((folder) => ({ id: folder.id, label: folder.name })) : []),
    ...(kind ? [{ id: unfiledId, label: '未分類' }] : []),
  ]
}

/** 行の名前の前の丸に渡すフォルダ。未分類・見つからないフォルダは null（色の無い輪）。 */
export function folderDotFor(folders: Folder[], folderId: string | null | undefined) {
  if (!folderId) return null
  const folder = folders.find((f) => f.id === folderId)
  return folder ? { name: folder.name, color: folder.color } : null
}

export function managedFolderNote(itemLabel: string) {
  return `フォルダを消しても、中の${itemLabel}は未分類に残ります`
}

export default function ManagedFolderPanel({
  kind,
  accountId,
  folders,
  onChanged,
  canManage,
  itemLabel,
  activeId,
  onSelect,
  allId = 'all',
  unfiledId = 'unfiled',
  allCount,
  unfiledCount = null,
  countOf,
  createAction,
  reserveCreateSpace,
  onDeleted,
  error,
  placeholder,
  children,
  disabled,
  onAddStart,
  onAdded,
  controlRef,
}: ManagedFolderPanelProps) {
  const [adding, setAdding] = useState(false)
  const managed = kind !== null
  const editable = managed && canManage
  const actions = useFolderRowActions({
    kind: kind ?? '',
    folders,
    accountId,
    enabled: editable,
    itemLabel,
    countOf: (id) => {
      const folder = folders.find((f) => f.id === id)
      return folder ? (countOf ? countOf(folder) : folder.itemCount ?? null) : null
    },
    onChanged,
    onDeleted: (id) => {
      if (onDeleted) onDeleted(id)
      else if (activeId === id) onSelect(allId)
    },
    placeholder,
  })

  useImperativeHandle(controlRef, () => ({
    startAdd: () => { if (editable) { onAddStart?.(); setAdding(true) } },
    startEdit: (folder) => { const index = folders.findIndex((f) => f.id === folder.id); if (index >= 0) actions.rowActions(folder, index).onEdit?.() },
    startDelete: (folder) => { const index = folders.findIndex((f) => f.id === folder.id); if (index >= 0) actions.rowActions(folder, index).onDelete?.() },
  }))

  const rows: FolderPanelRow[] = [
    { kind: 'all', id: allId, label: 'すべて', count: allCount },
    ...(managed ? folders.map((folder, index) => ({
      ...actions.rowActions(folder, index),
      kind: 'folder' as const,
      id: folder.id,
      label: folder.name,
      count: countOf ? countOf(folder) : folder.itemCount ?? null,
      color: folder.color,
    })) : []),
    ...(managed ? [{ kind: 'unfiled' as const, id: unfiledId, label: '未分類', count: unfiledCount }] : []),
  ]

  return (
    <>
      <FolderPanel
        rows={rows}
        activeId={activeId}
        onSelect={onSelect}
        createAction={createAction}
        reserveCreateSpace={reserveCreateSpace}
        onAddFolder={editable ? () => { onAddStart?.(); setAdding(true) } : undefined}
        addFolderLabel="フォルダを追加"
        disabled={disabled}
      >
        {error ? <p role="alert" className={styles.note}>{error}</p> : null}
        {managed ? <p className={styles.note}>{managedFolderNote(itemLabel)}</p> : null}
        {children}
      </FolderPanel>
      {adding && kind ? (
        <FolderAddDialog
          kind={kind}
          accountId={accountId}
          note={`${itemLabel}を分けてしまう箱です。消しても、中の${itemLabel}は未分類に残ります。`}
          placeholder={placeholder}
          onClose={() => setAdding(false)}
          onAdded={(created) => { setAdding(false); if (created) onAdded?.(created); void onChanged() }}
        />
      ) : null}
      {actions.dialogs}
    </>
  )
}
