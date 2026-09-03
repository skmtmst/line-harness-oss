'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Folder, Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import TemplateFolderSelect, {
  type TemplateFolderOption,
  type TemplateFolderStatus,
} from './template-folder-select'

type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

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
  const { selectedAccountId } = useAccount()
  const [templates, setTemplates] = useState<Template[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [search, setSearch] = useState('')
  const [folderId, setFolderId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [category, setCategory] = useState<'all' | 'frequent' | 'reservation' | 'ec'>('all')
  const [templatesStatus, setTemplatesStatus] = useState<TemplateLoadStatus>('idle')
  const [foldersStatus, setFoldersStatus] = useState<TemplateFolderStatus>('loading')
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(selectedAccountId)
  const accountDataCurrent = loadedAccountId === selectedAccountId
  const scopedTemplates = accountDataCurrent ? templates : []
  const scopedFolders = accountDataCurrent ? folders : []
  const visibleTemplatesStatus = accountDataCurrent ? templatesStatus : 'loading'
  const visibleFoldersStatus = accountDataCurrent ? foldersStatus : 'loading'

  useEffect(() => {
    if (!open) {
      // 閉じている間に前回分を捨て、次に開いた最初の描画から
      // 未取得状態にする（effect後の一瞬だけ前アカウントを出さない）。
      setTemplates([])
      setFolders([])
      setSelectedId('')
      setFolderId('')
      setTemplatesStatus('loading')
      setFoldersStatus('loading')
      setLoadedAccountId(selectedAccountId)
      return
    }
    let cancelled = false
    // LINEアカウントを切り替えたあとに前アカウントの内容を一瞬でも
    // 見せない。開くたびに未取得へ戻し、0件と区別する。
    setTemplates([])
    setFolders([])
    setSelectedId('')
    setFolderId('')
    setTemplatesStatus('loading')
    setFoldersStatus('loading')
    setLoadedAccountId(selectedAccountId)
    void api.templates.list().then((res) => {
      if (cancelled) return
      if (res.success) {
        setTemplates(res.data as unknown as Template[])
        setTemplatesStatus('ready')
      } else {
        setTemplatesStatus('error')
      }
    }).catch(() => {
      if (!cancelled) setTemplatesStatus('error')
    })
    // 置き場（099 で templates.folder_id が入っている）。
    void api.folders.list('template').then((res) => {
      if (cancelled) return
      if (res.success) {
        setFolders(res.data)
        setFoldersStatus('ready')
      } else {
        setFoldersStatus('error')
      }
    }).catch(() => {
      if (!cancelled) setFoldersStatus('error')
    })
    return () => {
      cancelled = true
    }
  }, [open, selectedAccountId])

  /** 文字のテンプレートだけが対象。種別タブは「メッセージ」で固定。 */
  const textTemplates = useMemo(
    () => scopedTemplates.filter((t) => t.messageType === 'text'),
    [scopedTemplates],
  )

  /** 置き場ごとの件数。0件でも出す（空だと分かるほうがよい）。 */
  const folderCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of textTemplates) map.set(t.folderId ?? '', (map.get(t.folderId ?? '') ?? 0) + 1)
    return map
  }, [textTemplates])

  /** 親子1段の置き場を、設計どおり同じパネルで選べる順番へ並べる。 */
  const folderOptions = useMemo<TemplateFolderOption[]>(() => {
    const children = new Map<string | null, Folder[]>()
    for (const folder of scopedFolders) {
      const parentId = scopedFolders.some((candidate) => candidate.id === folder.parentId)
        ? folder.parentId
        : null
      children.set(parentId, [...(children.get(parentId) ?? []), folder])
    }
    const countReady = visibleTemplatesStatus === 'ready'
    const options: TemplateFolderOption[] = [
      { value: '', label: 'すべてのフォルダ', count: countReady ? textTemplates.length : null },
    ]
    for (const parent of children.get(null) ?? []) {
      const childFolders = children.get(parent.id) ?? []
      const count = countReady
        ? (folderCounts.get(parent.id) ?? 0)
          + childFolders.reduce((sum, child) => sum + (folderCounts.get(child.id) ?? 0), 0)
        : null
      options.push({ value: parent.id, label: parent.name, count })
      for (const child of childFolders) {
        options.push({
          value: child.id,
          label: child.name,
          count: countReady ? folderCounts.get(child.id) ?? 0 : null,
          depth: 1,
        })
      }
    }
    options.push({
      value: '__none__',
      label: '未分類',
      count: countReady ? folderCounts.get('') ?? 0 : null,
    })
    return options
  }, [folderCounts, scopedFolders, visibleTemplatesStatus, textTemplates.length])

  /** 親フォルダを選んだときは、その直下のフォルダも一緒に表示する。 */
  const selectedFolderIds = useMemo(() => {
    if (!folderId || folderId === '__none__') return null
    return new Set([
      folderId,
      ...scopedFolders.filter((folder) => folder.parentId === folderId).map((folder) => folder.id),
    ])
  }, [folderId, scopedFolders])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = textTemplates.filter((t) => {
      if (folderId === '__none__' ? Boolean(t.folderId) : selectedFolderIds && !selectedFolderIds.has(t.folderId ?? '')) {
        return false
      }
      if (!q) return true
      return t.name.toLowerCase().includes(q) || t.messageContent.toLowerCase().includes(q)
    })
    if (category === 'frequent') return filtered.slice(0, 5)
    if (category === 'reservation') return filtered.filter((template) => /予約|来店|前日|日程/.test(`${template.name} ${template.messageContent}`))
    if (category === 'ec') return filtered.filter((template) => /EC|注文|発送|配送|商品/.test(`${template.name} ${template.messageContent}`))
    return filtered
  }, [category, textTemplates, search, folderId, selectedFolderIds])

  if (!open) return null

  const selected = textTemplates.find((t) => t.id === selectedId) ?? shown[0] ?? null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="テンプレートを選択"
      onClick={onClose}
    >
      <div
        className="flex h-[min(720px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] border border-[#E5E7EB] bg-canvas shadow-2xl"
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
          <TemplateFolderSelect
            value={folderId}
            onChange={setFolderId}
            options={folderOptions}
            status={visibleFoldersStatus}
          />
        </div>

        <div className="min-h-0 flex-1 grid-cols-[350px_1fr] md:grid">
          <div className="min-h-0 overflow-y-auto border-r border-[#E5E7EB] bg-[#F7F8F6] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {[
                { key: 'all' as const, label: 'すべて' },
                { key: 'frequent' as const, label: 'よく使う' },
                { key: 'reservation' as const, label: '予約' },
                { key: 'ec' as const, label: 'EC' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.key)}
                  aria-pressed={category === item.key}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${category === item.key ? 'border-[#A6E7BD] bg-[#EAFBF0] text-[#057A37]' : 'border-[#E5E7EB] bg-canvas text-[#667085] hover:bg-[#F2F4F7]'}`}
                >
                  {item.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-[#98A2B3]">
                {visibleTemplatesStatus === 'ready' ? `${shown.length}件` : '—'}
              </span>
            </div>
            {visibleTemplatesStatus === 'loading' ? (
              <p className="px-4 py-10 text-center text-sm text-ink-faint">テンプレートを読み込んでいます。</p>
            ) : visibleTemplatesStatus === 'error' ? (
              <p className="px-4 py-10 text-center text-sm text-danger">テンプレートを読み込めませんでした。もう一度開き直してください。</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#98A2B3]">
                {scopedTemplates.length === 0 ? '文字のテンプレートがまだありません。' : '見つかりませんでした。'}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((template) => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      aria-pressed={selected?.id === template.id}
                      className={`w-full rounded-lg border px-3 py-3 text-left ${selected?.id === template.id ? 'border-[#A6E7BD] bg-[#EAFBF0]' : 'border-[#E5E7EB] bg-canvas hover:bg-[#F2F4F7]'}`}
                    >
                      <p className="truncate text-sm font-semibold text-[#1F2937]">{template.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#667085]">{template.messageContent}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <section className="hidden min-h-0 overflow-y-auto bg-canvas p-6 md:block" aria-label="テンプレートのプレビュー">
            {selected ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-[#1F2937]">{selected.name}</h3>
                  {category === 'frequent' && <span className="rounded-lg border border-[#F6D68A] bg-[#FFF8E7] px-2.5 py-1.5 text-xs font-semibold text-[#B45309]">☆ よく使う</span>}
                </div>
                <p className="mt-5 text-xs font-semibold text-[#667085]">送信内容のプレビュー</p>
                <div className="mt-3 min-h-[250px] rounded-[12px] bg-[#7292BD] p-5 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
                  <div className="flex justify-center"><span className="rounded-full bg-canvas/85 px-3 py-1 text-[11px] text-[#667085]">今日</span></div>
                  <div className="mt-4 max-w-[78%] rounded-[12px] rounded-tl-[4px] bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-[#344054] shadow-sm">{selected.messageContent}</div>
                </div>
                <div className="mt-3 rounded-lg bg-[#F7F8F6] px-4 py-3 text-xs leading-6 text-[#667085]">
                  この操作ではまだ送信されません。入力欄へ内容を挿入します。<br />
                  種類：テキスト
                </div>
              </div>
            ) : (
              <p className="mt-10 text-center text-sm text-[#98A2B3]">左からテンプレートを選択してください。</p>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[#E5E7EB] bg-canvas px-6 py-4">
          <p className="text-xs text-[#667085]">入力後に文章を編集してから送信できます。</p>
          <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#E5E7EB] bg-canvas px-4 py-2 text-sm font-semibold text-[#667085] hover:bg-[#F7F8F6]"
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
            className="rounded-lg bg-accent-deep px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-deep/90 disabled:opacity-40"
          >
            入力欄へ挿入
          </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
