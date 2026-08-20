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

  const selected = textTemplates.find((t) => t.id === selectedId) ?? shown[0] ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="テンプレートを選択"
      onClick={onClose}
    >
      <div
        className="flex h-[min(720px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border border-[#E5E7EB] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[#1F2937]">テンプレートを選択</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#667085]">
              選択した内容を入力欄へ入れます。この操作だけでは送信されません。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-[#667085] hover:bg-[#F2F4F7] hover:text-[#1F2937]"
          >
            ✕
          </button>
        </header>

        <div className="grid gap-3 border-b border-[#E5E7EB] px-6 py-4 md:grid-cols-[1fr_240px]">
          <div className="relative">
            <svg className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="テンプレート名・本文で検索"
              aria-label="テンプレート名・本文で検索"
              className="w-full rounded-lg border border-[#E5E7EB] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/15"
            />
          </div>
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            aria-label="フォルダ"
            className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-medium text-[#1F2937] outline-none focus:border-[#06C755]"
          >
            <option value="">すべてのフォルダ（{textTemplates.length}）</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}（{folderCounts.get(folder.id) ?? 0}）</option>
            ))}
            <option value="__none__">未分類（{folderCounts.get('') ?? 0}）</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 grid-cols-[330px_1fr] md:grid">
          <div className="min-h-0 overflow-y-auto border-r border-[#E5E7EB]">
            <div className="flex items-center justify-between px-4 py-3 text-xs font-semibold text-[#667085]">
              <span>テンプレート</span>
              <span>{shown.length}件</span>
            </div>
            {shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#98A2B3]">
                {templates.length === 0 ? '文字のテンプレートがまだありません。' : '見つかりませんでした。'}
              </p>
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {shown.map((template) => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      aria-pressed={selected?.id === template.id}
                      className={`w-full px-4 py-3 text-left ${selected?.id === template.id ? 'bg-[#EAFBF0]' : 'hover:bg-[#F7F8F6]'}`}
                    >
                      <p className="truncate text-sm font-semibold text-[#1F2937]">{template.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#667085]">{template.messageContent}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <section className="hidden min-h-0 overflow-y-auto bg-[#F7F8F6] p-6 md:block" aria-label="テンプレートのプレビュー">
            <p className="text-xs font-semibold text-[#667085]">プレビュー</p>
            {selected ? (
              <div className="mt-3 rounded-[12px] border border-[#E5E7EB] bg-white p-5 shadow-[1px_2px_2px_rgba(15,23,42,0.15)]">
                <h3 className="text-sm font-bold text-[#1F2937]">{selected.name}</h3>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#344054]">{selected.messageContent}</p>
              </div>
            ) : (
              <p className="mt-10 text-center text-sm text-[#98A2B3]">左からテンプレートを選択してください。</p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[#E5E7EB] bg-white px-6 py-4">
          <p className="text-xs text-[#667085]">入力後に文章を編集してから送信できます。</p>
          <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#667085] hover:bg-[#F7F8F6]"
          >
            キャンセル
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onPick(selected.messageContent)
              onClose()
            }}
            className="rounded-lg bg-[#06C755] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#05B94F] disabled:opacity-40"
          >
            入力欄へ挿入
          </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
