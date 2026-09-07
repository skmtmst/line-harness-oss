'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Notice from '@/components/shared/notice'

/**
 * 受信箱の「この条件を保存」（設計 Pencil `Ln4zS` 保存した検索名入力モーダル）。
 *
 * 前は保存した検索のパネルの中に、名前の入力欄と保存ボタンが**直接**
 * 並んでいました。**何を保存しようとしているのかが書いていない**ので、
 * 絞り込みを変えたつもりで前の条件を保存してしまいます。設計は名前と
 * 「保存する条件」を並べて見せてから保存させます。
 *
 * 名前の上限は40文字。**残りではなく「11 / 40文字」と出す。**
 * 残り字数だけだと、上限が何文字なのかが分かりません。
 */

const NAME_LIMIT = 40

export type SavedViewSaveResult =
  | { success: true }
  | { success: false; error: string }

export type SavedViewDraft = {
  name: string
  status: 'all' | 'unread' | 'in_progress' | 'on_hold' | 'resolved'
  due: 'all' | 'overdue'
  channel: 'all' | 'line' | 'email'
  assignee: string
  favorite: boolean
}

export default function SavedViewDialog({
  open,
  initialValue,
  operators,
  existingNames,
  saving,
  onSave,
  onClose,
}: {
  open: boolean
  initialValue: Omit<SavedViewDraft, 'name'>
  operators: Array<{ id: string; name: string }>
  /** 同じ名前があるかを見るための一覧 */
  existingNames: string[]
  saving: boolean
  /** 保存先が成功を返したときだけ、完了画面へ進める。 */
  onSave: (draft: SavedViewDraft) => Promise<SavedViewSaveResult>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [status, setStatus] = useState(initialValue.status)
  const [due, setDue] = useState(initialValue.due)
  const [channel, setChannel] = useState(initialValue.channel)
  const [assignee, setAssignee] = useState(initialValue.assignee)
  const [favorite, setFavorite] = useState(initialValue.favorite)

  useEffect(() => {
    if (!open) return
    setName('')
    setError('')
    setDone(false)
    setStatus(initialValue.status)
    setDue(initialValue.due)
    setChannel(initialValue.channel)
    setAssignee(initialValue.assignee)
    setFavorite(initialValue.favorite)
  }, [open, initialValue.status, initialValue.due, initialValue.channel, initialValue.assignee, initialValue.favorite])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  /*
    **名前が空のあいだは、最初から押せない。**

    前は空のまま押せて、押してはじめて「検索名を入力してください」と赤字が
    出た。**押せる形で置いてあるものは、押せば進むと読む。** 押してから
    断るのではなく、何をすれば進めるかを先に書く。
  */
  const nameMissing = name.trim() === ''

  const submit = async () => {
    const trimmed = name.trim()
    /*
      **空と重複を、別の文だけで言い分ける。** 「保存できません」だけだと、
      名前を書けばいいのか、別の名前にすればいいのかが分からない。
    */
    if (!trimmed) {
      setError('検索名を入力してください')
      return
    }
    if (existingNames.some((existing) => existing.trim() === trimmed)) {
      setError('同じ名前の保存した検索があります。別の名前を入力してください。')
      return
    }
    setError('')
    const result = await onSave({ name: trimmed, status, due, channel, assignee, favorite })
    if (!result.success) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[rgb(16_24_40/33%)] p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="保存した検索を作成"
        data-qa-dialog="saved-view"
        className="bg-canvas rounded-panel flex w-[560px] max-w-full flex-col overflow-hidden shadow-2xl"
      >
        <header className="border-hairline flex items-start gap-4 border-b px-6 py-5">
          <div>
            <h2 className="text-ink text-base font-bold">保存した検索を作成</h2>
            <p className="text-ink-secondary mt-1 text-xs">検索名と絞り込み条件を変更して保存できます</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-ink-faint ml-auto text-lg leading-none">✕</button>
        </header>

        {done ? (
          <div className="px-6 py-8">
            <p className="text-accent text-sm font-bold">保存しました</p>
            <p className="text-ink-secondary mt-1.5 text-xs">
              「保存した検索」から、いつでもこの条件を呼び出せます。
            </p>
          </div>
        ) : (
          <div className="space-y-5 px-6 py-5">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="saved-view-name" className="text-ink-secondary text-xs font-medium">検索名</label>
                {/* 残りではなく「11 / 40文字」。上限が何文字かが分かる。 */}
                <span className="text-ink-faint text-[11px] tabular-nums">{name.length} / {NAME_LIMIT}文字</span>
              </div>
              <input
                id="saved-view-name"
                value={name}
                onChange={(event) => { setName(event.target.value); setError('') }}
                maxLength={NAME_LIMIT}
                placeholder="検索名を入力してください"
                /*
                  **空のあいだも枠を赤くする。** 設計 `AuSDY`（2-16）は
                  未入力の欄を赤い枠で描く。押してから赤くするのでは、
                  **どこを直せばよいかが押すまで分からない。**
                */
                aria-invalid={Boolean(error) || nameMissing}
                aria-describedby={error ? 'saved-view-error' : nameMissing ? 'saved-view-name-hint' : undefined}
                className={`rounded-control text-ink mt-1.5 h-11 w-full border px-3 text-sm outline-none ${error || nameMissing ? 'border-danger' : 'border-hairline'}`}
              />
            </div>

            <div>
              <p className="text-ink-secondary text-xs font-medium">保存する条件</p>
              <dl className="border-hairline rounded-control mt-1.5 divide-y divide-[color:var(--color-hairline)] border">
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt className="text-ink-secondary text-xs">対応状況</dt>
                  <dd>
                    <select aria-label="保存する対応状況" value={status} onChange={(event) => setStatus(event.target.value as SavedViewDraft['status'])} className="border-hairline rounded-control bg-canvas text-ink h-9 w-40 border px-2 text-xs font-medium">
                      <option value="all">すべて</option>
                      <option value="unread">未対応</option>
                      <option value="in_progress">対応中</option>
                      <option value="on_hold">保留</option>
                      <option value="resolved">対応済み</option>
                    </select>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt className="text-ink-secondary text-xs">期限</dt>
                  <dd>
                    <select aria-label="保存する期限" value={due} onChange={(event) => setDue(event.target.value as SavedViewDraft['due'])} className="border-hairline rounded-control bg-canvas text-ink h-9 w-40 border px-2 text-xs font-medium">
                      <option value="all">すべて</option>
                      <option value="overdue">期限超過</option>
                    </select>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt className="text-ink-secondary text-xs">受信経路</dt>
                  <dd>
                    <select aria-label="保存する受信経路" value={channel} onChange={(event) => setChannel(event.target.value as SavedViewDraft['channel'])} className="border-hairline rounded-control bg-canvas text-ink h-9 w-40 border px-2 text-xs font-medium">
                      <option value="all">LINE・MAIL</option>
                      <option value="line">LINE</option>
                      <option value="email">MAIL</option>
                    </select>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <dt className="text-ink-secondary text-xs">担当者</dt>
                  <dd>
                    <select aria-label="保存する担当者" value={assignee} onChange={(event) => setAssignee(event.target.value)} className="border-hairline rounded-control bg-canvas text-ink h-9 w-40 border px-2 text-xs font-medium">
                      <option value="all">すべて</option>
                      <option value="unassigned">未割り当て</option>
                      {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                    </select>
                  </dd>
                </div>
              </dl>
            </div>

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="text-ink block text-xs font-medium">よく使うに追加</span>
                <span className="text-ink-faint text-micro mt-0.5 block">保存した検索一覧の上部に表示します</span>
              </span>
              <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} aria-label="よく使うに追加" className="peer sr-only" />
                <span className="bg-canvas-sunken peer-checked:bg-accent-deep absolute inset-0 rounded-full transition-colors" />
                <span className="bg-canvas absolute left-1 h-4 w-4 rounded-full shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>

            {/* 設計 `AuSDY` と同じく、直す場所を見たあとに理由を読む。 */}
            {error || nameMissing ? (
              <Notice
                id={error ? 'saved-view-error' : 'saved-view-name-hint'}
                tone="error"
                message={error || '検索名を入力してください。'}
              />
            ) : (
              <Notice
                tone="validation"
                message="保存されるのは検索条件です。受信件数は最新の状態に自動更新されます。"
              />
            )}
          </div>
        )}

        <footer className="border-hairline flex items-center justify-end gap-3 border-t px-6 py-4">
          {done ? (
            <button type="button" onClick={onClose} className="rounded-control bg-accent-deep text-on-accent px-5 py-2 text-sm font-bold">
              閉じる
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="border-hairline rounded-control text-ink-secondary border px-4 py-2 text-sm">
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving || nameMissing}
                title={nameMissing ? '検索名を入力してください' : undefined}
                /* 主ボタンの緑は本流が `accent-deep` へそろえた（白文字の読みやすさ）。 */
                className="rounded-control bg-accent-deep text-on-accent px-5 py-2 text-sm font-bold disabled:opacity-40"
              >
                {saving ? '保存中' : '検索条件を保存'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  )
}
