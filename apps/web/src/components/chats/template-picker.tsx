'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Folder, Template } from '@line-crm/shared'
import { api } from '@/lib/api'

/**
 * テンプレートを選ぶ（設計 V2 2-1-1）。
 *
 * 受信箱の入力欄から開く。選ぶと本文が入力欄に入り、送る前に直せる。
 * 設計の「コピーして編集」はテンプレート管理側の操作なので、ここには置かない。
 *
 * 文字だけのテンプレートを選ばせる。画像やカルーセルは、そのまま入力欄に
 * 入れても文字として送られてしまうので、選べないようにしてある。
 */

export default function TemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (content: string) => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [search, setSearch] = useState('')
  const [folderId, setFolderId] = useState('')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.templates.list().then((res) => {
      if (!cancelled && res.success) setTemplates(res.data as unknown as Template[])
    })
    // 置き場（099 で templates.folder_id が入っている）。
    void api.folders.list('template').then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  /**
   * 種別のタブ。設計にある5つを出す。
   *
   * **選べるのは「メッセージ」だけ。** ここは入力欄に本文を入れる場所で、
   * リッチメッセージやカードタイプの中身は JSON なので、入れると文字として
   * そのまま送られる。クーポンとリサーチは、持つ場所そのものが無い。
   */
  const KINDS: Array<{ key: string; label: string; why?: string }> = [
    { key: 'text', label: 'メッセージ' },
    { key: 'image', label: 'リッチメッセージ', why: '中身がJSONなので、入力欄に入れると文字として送られます' },
    { key: 'flex', label: 'カードタイプ', why: '同上。カードは入力欄からは送れません' },
    { key: 'coupon', label: 'クーポン', why: 'クーポンを持つ場所がまだありません' },
    { key: 'research', label: 'リサーチ', why: 'リサーチを持つ場所がまだありません' },
  ]

  /** 文字のテンプレートだけが対象。種別タブは「メッセージ」で固定。 */
  const textTemplates = useMemo(
    () => templates.filter((t) => t.messageType === 'text'),
    [templates],
  )

  /** 置き場ごとの件数。0件でも出す（空だと分かるほうがよい）。 */
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of textTemplates) map.set(t.folderId ?? '', (map.get(t.folderId ?? '') ?? 0) + 1)
    return map
  }, [textTemplates])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return textTemplates.filter((t) => {
      if (folderId === '__none__' ? t.folderId !== null : folderId && t.folderId !== folderId) {
        return false
      }
      if (!q) return true
      return t.name.toLowerCase().includes(q) || t.messageContent.toLowerCase().includes(q)
    })
  }, [textTemplates, search, folderId])

  if (!open) return null

  const selected = templates.find((t) => t.id === selectedId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="テンプレートを選ぶ"
      onClick={onClose}
    >
      <div
        className="bg-canvas rounded-card flex max-h-[85vh] w-full max-w-2xl flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">テンプレートを選ぶ</h2>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              選ぶと、メッセージ入力欄に本文が入ります。送信前に編集できます。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-faint hover:text-ink shrink-0 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="テンプレート名・本文で検索"
          aria-label="テンプレート名・本文で検索"
          className="border-hairline rounded-control mb-2 w-full border px-3 py-2 text-sm"
        />

        {/* 種別のタブ。選べるのは「メッセージ」だけ。理由は札に出す。 */}
        <div className="border-hairline mb-3 flex flex-wrap gap-1 border-b">
          {KINDS.map((k) => (
            <button
              key={k.key}
              disabled={Boolean(k.why)}
              title={k.why}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                k.why
                  ? 'text-ink-faint border-transparent opacity-50'
                  : 'border-accent text-accent'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* 置き場。テンプレートは folder_id を持っている（099）。 */}
        <div className="border-hairline rounded-card mb-3 border p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-ink text-xs font-bold">フォルダ</span>
            <span className="text-ink-faint text-xs">{textTemplates.length} 件</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <FolderChip
              label="すべて"
              count={textTemplates.length}
              active={folderId === ''}
              onClick={() => setFolderId('')}
            />
            {folders.map((f) => (
              <FolderChip
                key={f.id}
                label={f.name}
                count={folderCounts.get(f.id) ?? 0}
                active={folderId === f.id}
                onClick={() => setFolderId(f.id)}
              />
            ))}
            <FolderChip
              label="未分類"
              count={folderCounts.get('') ?? 0}
              active={folderId === '__none__'}
              onClick={() => setFolderId('__none__')}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="text-ink-faint py-8 text-center text-sm">
              {templates.length === 0
                ? '文字のテンプレートがまだありません。'
                : '見つかりませんでした。'}
            </p>
          ) : (
            <ul className="divide-hairline divide-y">
              {shown.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    aria-pressed={selectedId === t.id}
                    className={`w-full px-3 py-2.5 text-left ${
                      selectedId === t.id ? 'bg-accent-bg' : 'hover:bg-canvas-sunken'
                    }`}
                  >
                    <p className="text-ink text-sm font-medium">{t.name}</p>
                    <p className="text-ink-faint mt-0.5 line-clamp-2 text-xs leading-relaxed">
                      {t.messageContent}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-hairline mt-3 flex justify-end gap-2 border-t pt-3">
          <button
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium"
          >
            閉じる
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onPick(selected.messageContent)
              onClose()
            }}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          >
            この内容を入れる
          </button>
        </div>
      </div>
    </div>
  )
}

function FolderChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-control inline-flex items-center gap-2 border px-3 py-1.5 text-xs ${
        active
          ? 'border-accent bg-accent-soft text-accent font-bold'
          : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
