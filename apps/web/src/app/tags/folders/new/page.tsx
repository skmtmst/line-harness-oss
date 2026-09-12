'use client'

import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, FolderCheck, Trash2, X } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { usePageTitle } from '@/components/shell/page-chrome'
import StickyBar from '@/components/shared/sticky-bar'
import TagsPageV4 from '@/components/friend-fields/tags-page-v4'
import { useAccount } from '@/contexts/account-context'
import {
  folderSaveErrorMessage,
  isCurrentFolderRequest,
  type FolderRequestKey,
} from './folder-editor-state'

/*
  フォルダの色。**緑から始める。** V6 の基調色は `--color-accent`（#06c755）で、
  設計 `byqIW` も緑始まりの8色。青から始めると、既定で選ばれる色が
  基調色から外れる。

  **名前を必ず付ける。** 要件 04 §13 は「色だけでフォルダ・マーク・状態を
  区別しない」「すべての色選択に名前またはラベルを付ける」と決めている。
  前は読み上げが「色 #3B82F6」で、**色が見えない人には16進数しか届かなかった。**
*/
const COLORS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#06C755', name: '緑' },
  { value: '#3B82F6', name: '青' },
  { value: '#06B6D4', name: '水色' },
  { value: '#7C3AED', name: '紫' },
  { value: '#EC4899', name: 'ピンク' },
  { value: '#EF4444', name: '赤' },
  { value: '#F59E0B', name: '黄' },
  { value: '#6B7280', name: 'グレー' },
]

function FolderEditor() {
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const editId = params.get('id')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0].value)
  const [scope, setScope] = useState<'tag' | 'friend_field'>('tag')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const activeRequestRef = useRef<FolderRequestKey>({ editId, generation: 0 })
  /**
   * 編集で開いたときの読み込み。`ready` になるまで名前も色も本物ではない。
   * 失敗を黙って捨てると、空欄のまま保存して**元の名前を消す**ことになる。
   */
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error' | 'forbidden'>(
    editId ? 'loading' : 'ready',
  )

  // 画面名は共通トップバーだけに置く（`docs/v6-common-rules.md` §1）。
  // 本文に大見出しを戻すと、上部バーと同じ文字が2つ並ぶ。
  usePageTitle('友だち属性')

  const close = () => router.push('/tags')
  const dialogRef = useOverlayFocus(!deleteOpen, close, saving)

  const loadFolder = () => {
    const request = {
      editId,
      generation: activeRequestRef.current.generation + 1,
    }
    activeRequestRef.current = request
    setError('')
    setSaving(false)

    // 同じページで ?id= が外れた場合も、前の編集内容を新規作成へ持ち越さない。
    if (!editId) {
      setName('')
      setColor(COLORS[0].value)
      setScope('tag')
      setLoadState('ready')
      return
    }

    // 別フォルダの名前を読込中の面へ残さない。
    setName('')
    setColor(COLORS[0].value)
    setLoadState('loading')
    void api.tagGroups
      .list(selectedAccountId)
      .then((result) => {
        if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
        if (!result.success) {
          setLoadState('error')
          return
        }
        const group = result.data.find((item) => item.id === editId)
        if (!group) {
          setLoadState('error')
          return
        }
        setName(group.name)
        setColor(group.color ?? COLORS[0].value)
        setLoadState('ready')
      })
      .catch((reason: unknown) => {
        if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
        const status = (reason as { status?: number } | null)?.status
        setLoadState(status === 403 ? 'forbidden' : 'error')
      })
  }

  useEffect(loadFolder, [editId, selectedAccountId])

  const save = async () => {
    if (!name.trim() || saving || loadState !== 'ready') return
    const request = { ...activeRequestRef.current }
    setSaving(true); setError('')
    try {
      if (scope === 'tag') {
        const result = editId
          ? await api.tagGroups.update(editId, { name: name.trim(), color, accountId: selectedAccountId })
          : await api.tagGroups.create({ name: name.trim(), color, accountId: selectedAccountId })
        if (!result.success) throw new Error('save_failed')
      } else {
        const result = await api.folders.create({ kind: 'friend_field', name: name.trim(), color })
        if (!result.success) throw new Error('save_failed')
      }
      if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
      router.push(scope === 'tag' ? '/tags' : '/tags?tab=fields')
    } catch (reason) {
      if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
      setError(folderSaveErrorMessage(reason instanceof ApiError ? reason.status : undefined))
    } finally {
      if (isCurrentFolderRequest(activeRequestRef.current, request)) setSaving(false)
    }
  }

  const remove = async () => {
    if (!editId || saving) return
    const request = { ...activeRequestRef.current }
    setSaving(true)
    setError('')
    try {
      const result = await api.tagGroups.delete(editId, selectedAccountId)
      if (!result.success) throw new Error('delete_failed')
      if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
      router.push('/tags')
    } catch (reason) {
      if (!isCurrentFolderRequest(activeRequestRef.current, request)) return
      setDeleteOpen(false)
      setError(folderSaveErrorMessage(reason instanceof ApiError ? reason.status : undefined))
    } finally {
      if (isCurrentFolderRequest(activeRequestRef.current, request)) setSaving(false)
    }
  }

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !saving) close()
  }

  /**
   * 保存を止めている理由。**押せないだけにしない。**
   * 何が足りないのか本文に出さないと、直しようがないまま詰まる。
   */
  const blockedReason =
    loadState === 'loading' ? '読み込んでいます'
      : loadState === 'error' ? '読み込めませんでした'
        : loadState === 'forbidden' ? '操作する権限がありません'
          : !name.trim() ? 'フォルダ名を入力すると保存できます'
            : null

  return (
    <div data-design="friend-attributes-folder-v4" data-design-node="byqIW">
      {/* 設計 byqIW はタグ一覧を残したまま、追加・編集で同じ窓を重ねる。 */}
      <TagsPageV4 accountId={selectedAccountId} />
      <div
        ref={dialogRef}
        className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4"
        onMouseDown={closeFromBackdrop}
      >
        <section
          className="rounded-card border-hairline bg-canvas flex max-h-full w-full max-w-[620px] flex-col overflow-hidden border shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-editor-title"
        >
          <header className="border-hairline relative border-b px-5 py-4">
            <h2 id="folder-editor-title" className="text-xl font-bold text-ink">
              {editId ? 'フォルダを編集' : 'フォルダを追加'}
            </h2>
            <p className="text-ink-secondary mt-1 text-xs">{editId ? '名前と色を変えられます。削除しても中の項目は未分類に残ります。' : 'タグや友だち情報欄を、運用目的ごとに整理します。'}</p>
            <button type="button" aria-label="閉じる" disabled={saving} onClick={close} className="text-ink-faint hover:text-ink absolute right-4 top-4 rounded p-1 disabled:opacity-40">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto px-5 py-4">
        {loadState === 'forbidden' ? (
          <p className="text-ink-secondary text-sm">見る権限がありません</p>
        ) : (
          <>
            {loadState === 'loading' && <p className="text-ink-faint mb-5 text-sm">読み込んでいます</p>}
            {loadState === 'error' && (
              <div className="border-hairline bg-canvas-sunken rounded-control mb-5 flex flex-wrap items-center gap-3 border p-3">
                <p className="text-ink-secondary text-sm">読み込めませんでした</p>
                <Button type="button" onClick={loadFolder}>再読み込み</Button>
              </div>
            )}

            <label className="block">
              <span className="text-ink mb-1.5 block text-sm font-semibold">
                フォルダ名
              </span>
              {/* 設計 `byqIW` の入力欄は h=44・文字13。 */}
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例: 購入"
                maxLength={60}
                disabled={loadState !== 'ready'}
                className="rounded-control border-hairline text-label focus:border-accent focus:ring-accent/15 h-11 w-full border px-3 outline-none focus:ring-2 disabled:opacity-40"
              />
            </label>

            <div className="mt-4">
              <p className="text-ink mb-3 text-sm font-semibold">フォルダの色</p>
              {/*
                設計 `byqIW` の色見本は **枠38×38（r=10・背景canvas）の中に
                20×20の円**。枠ごと色で塗ると、8つ並んだときに色の面が
                主役になり、どれを選んでいるかより先に色が目に入る。
                選択中は円の上に16pxのチェックを重ねる。
              */}
              <div className="flex flex-wrap gap-2">
                {COLORS.map((item) => {
                  const selected = color === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      /* **16進数ではなく名前で言う。**（要件 §13） */
                      aria-label={item.name}
                      aria-pressed={selected}
                      title={item.name}
                      disabled={loadState !== 'ready'}
                      onClick={() => setColor(item.value)}
                      className={`rounded-card bg-canvas flex h-[38px] w-[38px] items-center justify-center disabled:opacity-40 ${
                        selected ? 'ring-accent ring-2' : 'ring-hairline ring-1'
                      }`}
                    >
                      <span className="relative flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: item.value }}>
                        {selected && <Check size={16} strokeWidth={3} className="text-on-accent" aria-hidden="true" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/*
              設計 `byqIW` の「一覧での表示」。色だけ選んでも、一覧で
              どう出るかは分からない。**選んだ色のまま名前を並べて見せる。**
            */}
            <div className="rounded-card border-hairline bg-canvas-sunken mt-4 flex flex-col gap-[7px] border p-[14px]">
              <p className="text-nano text-ink-faint font-semibold">一覧での表示</p>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                <span className="text-label text-ink font-bold">{name.trim() || 'フォルダ名'}</span>
              </div>
            </div>

            {!editId && (
              <div className="border-hairline mt-7 border-t pt-6">
                <p className="text-ink mb-3 text-sm font-semibold">作成する場所</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setScope('tag')} className={`rounded-pill border px-4 py-2 text-sm font-medium ${scope === 'tag' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}>タグ</button>
                  <button type="button" onClick={() => setScope('friend_field')} className={`rounded-pill border px-4 py-2 text-sm font-medium ${scope === 'friend_field' ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-secondary'}`}>友だち情報欄</button>
                </div>
              </div>
            )}

            <p className="text-ink-secondary mt-4 text-xs leading-5">このダイアログは追加のときも編集のときも同じものを使います。</p>

            {error && <p className="text-danger mt-4 text-sm">{error}</p>}
            {/* 止まっている理由は本文に出す。押せない見た目だけにしない。 */}
            {/* 読込中・失敗・権限不足は直前の状態表示で説明済み。同じ文を二重に出さない。 */}
            {loadState === 'ready' && blockedReason && (
              <p className="text-ink-faint mt-4 text-xs">{blockedReason}</p>
            )}

            <StickyBar
              className="-mx-5 -mb-4 mt-4 rounded-none border-x-0 border-b-0"
              destructive={editId ? (
                <Button type="button" className="border-danger/30 text-danger" disabled={saving} onClick={() => setDeleteOpen(true)}>
                  <Trash2 size={16} aria-hidden="true" /> フォルダを削除
                </Button>
              ) : undefined}
              actions={(
                <>
                  <button type="button" disabled={saving} onClick={close} className="rounded-control border-hairline bg-canvas text-ink-secondary border px-4 py-2.5 text-sm font-medium disabled:opacity-40">キャンセル</button>
                  <Button type="button" variant="primary" disabled={saving || blockedReason !== null} onClick={() => void save()}>{saving ? '保存中…' : editId ? <><FolderCheck size={16} aria-hidden="true" /> フォルダを保存</> : 'フォルダを追加'}</Button>
                </>
              )}
            />
          </>
        )}
          </div>
      </section>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title={`「${name}」を削除しますか？`}
        description="フォルダだけを削除します。中にあるタグは削除されず、未分類へ戻ります。"
        confirmLabel="このフォルダを削除"
        destructive
        busy={saving}
        onCancel={() => { if (!saving) setDeleteOpen(false) }}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

export default function NewTagFolderPage() {
  return <Suspense fallback={<p className="text-ink-faint p-6 text-sm">読み込んでいます</p>}><FolderEditor /></Suspense>
}
