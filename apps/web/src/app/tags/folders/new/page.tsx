'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import StickyBar from '@/components/shared/sticky-bar'
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
  { value: '#8B5CF6', name: '紫' },
  { value: '#EC4899', name: 'ピンク' },
  { value: '#EF4444', name: '赤' },
  { value: '#F59E0B', name: '黄' },
  { value: '#6B7280', name: 'グレー' },
]

function FolderEditor() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0].value)
  const [scope, setScope] = useState<'tag' | 'friend_field'>('tag')
  const [saving, setSaving] = useState(false)
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
  usePageTitle(editId ? 'フォルダを編集' : 'フォルダを追加')

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
      .list()
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

  useEffect(loadFolder, [editId])

  const save = async () => {
    if (!name.trim() || saving || loadState !== 'ready') return
    const request = { ...activeRequestRef.current }
    setSaving(true); setError('')
    try {
      if (scope === 'tag') {
        const result = editId
          ? await api.tagGroups.update(editId, { name: name.trim(), color })
          : await api.tagGroups.create({ name: name.trim(), color })
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
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ink-secondary text-sm">タグや友だち情報欄を、運用目的ごとに整理します。</p>
          <nav className="text-ink-faint mt-3 text-xs">
            <Link href="/tags" className="text-action hover:underline">友だち属性</Link>
            <span className="mx-2">›</span>
            {editId ? 'フォルダを編集' : 'フォルダを追加'}
          </nav>
        </div>
        <Link href="/tags" className="rounded-control border-hairline bg-canvas text-ink-secondary border px-4 py-2.5 text-sm font-medium">友だち属性へ</Link>
      </header>

      <section className="rounded-card border-hairline bg-canvas mx-auto w-full max-w-[720px] border p-7 [box-shadow:1px_1px_1px_rgba(15,23,42,0.14)]">
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
                フォルダ名 <span className="bg-danger-bg text-danger rounded px-1.5 py-0.5 text-[10px]">必須</span>
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

            <div className="mt-6">
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
              <p className="text-ink-faint mt-3 text-xs">選んだ色は、フォルダと中に入れた属性の印に使われます。</p>
            </div>

            {/*
              設計 `byqIW` の「一覧での表示」。色だけ選んでも、一覧で
              どう出るかは分からない。**選んだ色のまま名前を並べて見せる。**
            */}
            <div className="rounded-card border-hairline bg-canvas-sunken mt-6 flex flex-col gap-[7px] border p-[14px]">
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

            <p className="rounded-control border-hairline bg-canvas-sunken text-ink-secondary mt-7 border p-4 text-xs leading-5">フォルダをあとで削除しても、中に入れたタグや友だち情報欄は削除されず「未分類」に残ります。</p>

            {error && <p className="text-danger mt-4 text-sm">{error}</p>}
            {/* 止まっている理由は本文に出す。押せない見た目だけにしない。 */}
            {/* 読込中・失敗・権限不足は直前の状態表示で説明済み。同じ文を二重に出さない。 */}
            {loadState === 'ready' && blockedReason && (
              <p className="text-ink-faint mt-4 text-xs">{blockedReason}</p>
            )}

            <StickyBar
              actions={(
                <>
                  <Button type="button" onClick={() => router.back()}>キャンセル</Button>
                  <Button type="button" variant="primary" disabled={saving || blockedReason !== null} onClick={() => void save()}>{saving ? '保存中…' : editId ? '保存する' : 'フォルダを追加'}</Button>
                </>
              )}
            />
          </>
        )}
      </section>
    </div>
  )
}

export default function NewTagFolderPage() {
  return <Suspense fallback={<p className="text-ink-faint p-6 text-sm">読み込んでいます</p>}><FolderEditor /></Suspense>
}
