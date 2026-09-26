'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Folder, Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import TemplateFolderSelect, {
  type TemplateFolderOption,
  type TemplateFolderStatus,
} from './template-folder-select'

type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 一覧口が返す使用数。shared の `Template` には無いが、GET /api/templates
 * は usageCount・月間/累計の送信数を返す。「よく使う」はこれで並べる。
 */
type UsageAwareTemplate = Template & {
  usageCount?: number
  monthlySendCount?: number | null
  totalSendCount?: number | null
}

/** 「よく使う」の並べ方。直近の送信数→累計→使用箇所数の順で見る。 */
function usageScore(template: UsageAwareTemplate): number {
  return template.monthlySendCount ?? template.totalSendCount ?? template.usageCount ?? 0
}

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
  onPickPack,
  chatId,
}: {
  open: boolean
  onClose: () => void
  onPick: (content: string) => void
  /*
   * G-4: テンプレートのパック呼出し。複数選んだ本文を選んだ順の配列で
   * 渡す。渡された画面だけ「まとめて選ぶ」の切替が出る。
   * （受信箱は1回のpushで最大5通まとめて送れる。）
   */
  onPickPack?: (contents: string[]) => void
  // N-026: 差し込みを含むテンプレートのプレビューを、送信と同じ解決器で
  // 表示するために会話IDを受け取る。無いときは生の本文を見せる従来表示。
  chatId?: string | null
}) {
  const { selectedAccountId } = useAccount()
  // PERF-12: templates は「届いた区画」だけ。全件を持たず、絞り込みは
  // サーバーに任せる。total は絞り込み後の総数。
  const [templates, setTemplates] = useState<UsageAwareTemplate[]>([])
  const [total, setTotal] = useState(0)
  const [folderCounts, setFolderCounts] = useState<Record<string, number> | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [folderId, setFolderId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [category, setCategory] = useState<'all' | 'frequent' | 'reservation' | 'ec'>('all')
  // パック呼出しの下書き。選んだ順が送る順になる（あいさつ→案内→締め）。
  // 本文ごと持つのは、絞り込みを変えて一覧から外れても選んだものが
  // 消えないようにするため。
  const [packMode, setPackMode] = useState(false)
  const [packItems, setPackItems] = useState<Array<{ id: string; name: string; content: string }>>([])
  const [templatesStatus, setTemplatesStatus] = useState<TemplateLoadStatus>('idle')
  const [foldersStatus, setFoldersStatus] = useState<TemplateFolderStatus>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(selectedAccountId)
  const [resolvedPreview, setResolvedPreview] = useState<{
    forId: string
    content: string
    unresolved: string[]
  } | null>(null)
  const accountDataCurrent = loadedAccountId === selectedAccountId
  const emptyTemplates = useMemo<UsageAwareTemplate[]>(() => [], [])
  const emptyFolders = useMemo<Folder[]>(() => [], [])
  const scopedTemplates = accountDataCurrent ? templates : emptyTemplates
  const scopedFolders = accountDataCurrent ? folders : emptyFolders
  const visibleTemplatesStatus = accountDataCurrent ? templatesStatus : 'loading'
  const visibleFoldersStatus = accountDataCurrent ? foldersStatus : 'loading'
  // 連打・連続入力で遅れて届いた古い応答を混ぜない。
  const listGenRef = useRef(0)
  // 次に取るページ番号。重複除去で件数とページがずれても狂わないよう、
  // 件数からは割り出さずに持つ。
  const nextPageRef = useRef(1)

  /*
   * INBOX-14: 共通のオーバーレイ約束。開いたら窓の中へフォーカス、
   * Tab は窓の中で回し、Escape で閉じ、閉じたら起点（テンプレートを
   * 開いたボタン）へフォーカスを戻す。未挿入で閉じても下書きは変えない。
   */
  const dialogRef = useOverlayFocus(open, onClose)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /*
   * 初期フォーカスは検索欄へ。useOverlayFocus は先頭の閉じるボタンへ
   * 合わせるため、同じフレームの後に続くこの予約で検索欄へ移す。
   */
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) {
      // 閉じている間に前回分を捨て、次に開いた最初の描画から
      // 未取得状態にする（effect後の一瞬だけ前アカウントを出さない）。
      listGenRef.current += 1
      setTemplates([])
      setTotal(0)
      setFolderCounts(null)
      setFolders([])
      setSelectedId('')
      setFolderId('')
      setSearch('')
      setDebouncedSearch('')
      setCategory('all')
      setPackMode(false)
      setPackItems([])
      setTemplatesStatus('loading')
      setFoldersStatus('loading')
      setLoadedAccountId(selectedAccountId)
      return
    }
    let cancelled = false
    // LINEアカウントを切り替えたあとに前アカウントの内容を一瞬でも
    // 見せない。開くたびに未取得へ戻し、0件と区別する。
    setFolders([])
    setFoldersStatus('loading')
    // 置き場（099 で templates.folder_id が入っている）。
    // テンプレートと同じく選択中アカウントで絞る。渡さないと
    // 可視範囲の全部が並び、別アカウントの置き場が出る（N-147）。
    void api.folders.list('template', selectedAccountId ?? undefined).then((res) => {
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

  // 検索欄は1打鍵ごとに取りに行かず、少し間を置いてから確定する。
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search, open])

  /*
   * PERF-12: 一覧の区画取得。検索・フォルダ・分類が変わるたびに
   * 1ページ目から取り直す。サーバー側で絞り込みを済ませてから切るので、
   * 「届いた分だけを絞った偽の0件」にはならない。
   */
  useEffect(() => {
    if (!open) return
    const myGen = ++listGenRef.current
    const account = selectedAccountId ?? undefined
    setTemplatesStatus('loading')
    void api.templates.listPage({
      accountId: account,
      q: debouncedSearch.trim() || undefined,
      folderId: folderId || undefined,
      quick: category === 'all' ? undefined : category,
      messageType: 'text',
      page: 1,
      limit: 100,
      folderCounts: true,
    }).then((res) => {
      if (listGenRef.current !== myGen) return
      if (res.success) {
        setTemplates(res.data.items as unknown as UsageAwareTemplate[])
        setTotal(res.data.total)
        if (res.data.folderCounts) setFolderCounts(res.data.folderCounts)
        nextPageRef.current = 2
        setTemplatesStatus('ready')
      } else {
        setTemplatesStatus('error')
      }
    }).catch(() => {
      if (listGenRef.current === myGen) setTemplatesStatus('error')
    })
  }, [open, selectedAccountId, debouncedSearch, folderId, category])

  /** 次の区画を下へ足す。区画の間で重なった分は id で除く。 */
  const loadMore = () => {
    if (loadingMore || templates.length >= total) return
    const myGen = ++listGenRef.current
    const page = nextPageRef.current
    setLoadingMore(true)
    void api.templates.listPage({
      accountId: selectedAccountId ?? undefined,
      q: debouncedSearch.trim() || undefined,
      folderId: folderId || undefined,
      quick: category === 'all' ? undefined : category,
      messageType: 'text',
      page,
      limit: 100,
    }).then((res) => {
      if (listGenRef.current !== myGen) return
      if (res.success) {
        setTemplates((prev) => {
          const seen = new Set(prev.map((t) => t.id))
          return [...prev, ...(res.data.items as unknown as UsageAwareTemplate[]).filter((t) => !seen.has(t.id))]
        })
        setTotal(res.data.total)
        nextPageRef.current = page + 1
      }
    }).catch(() => undefined).finally(() => {
      if (listGenRef.current === myGen) setLoadingMore(false)
    })
  }

  /** 置き場ごとの件数はサーバー集計。届くまでは数を出さない。 */
  const folderOptions = useMemo<TemplateFolderOption[]>(() => {
    const children = new Map<string | null, Folder[]>()
    for (const folder of scopedFolders) {
      const parentId = scopedFolders.some((candidate) => candidate.id === folder.parentId)
        ? folder.parentId
        : null
      children.set(parentId, [...(children.get(parentId) ?? []), folder])
    }
    const countOf = (id: string) => folderCounts?.[id] ?? 0
    const countReady = folderCounts !== null
    const allCount = countReady
      ? Object.values(folderCounts).reduce((sum, n) => sum + n, 0)
      : null
    const options: TemplateFolderOption[] = [
      { value: '', label: 'すべてのフォルダ', count: allCount },
    ]
    for (const parent of children.get(null) ?? []) {
      const childFolders = children.get(parent.id) ?? []
      const count = countReady
        ? countOf(parent.id) + childFolders.reduce((sum, child) => sum + countOf(child.id), 0)
        : null
      options.push({ value: parent.id, label: parent.name, count })
      for (const child of childFolders) {
        options.push({
          value: child.id,
          label: child.name,
          count: countReady ? countOf(child.id) : null,
          depth: 1,
        })
      }
    }
    options.push({
      value: '__none__',
      label: '未分類',
      count: countReady ? countOf('') : null,
    })
    return options
  }, [folderCounts, scopedFolders])

  /*
   * PERF-12: 絞り込みはサーバー済み。「よく使う」もサーバーが実績順で
   * 返すので、ここでは先頭5件を切るだけ。
   */
  const shown = useMemo(
    () => category === 'frequent' ? scopedTemplates.slice(0, 5) : scopedTemplates,
    [category, scopedTemplates],
  )

  /*
   * INBOX-13: 選択は「いま見えている候補」の中だけで解決する。
   * 検索・フォルダ・分類で一覧から外れたテンプレートを選んだままに
   * しない。選択が結果外になったら結果の先頭へ明示的に切り替え、
   * 0件なら未選択（挿入不可）にする。
   */
  const selectedTemplate = useMemo(
    () => shown.find((t) => t.id === selectedId) ?? shown[0] ?? null,
    [selectedId, shown],
  )

  /* INBOX-15: よく使うの実績が1件も無いときは、推測と実績を区別して断る。 */
  const frequentHasUsage = useMemo(
    () => category === 'frequent' && shown.some((t) => usageScore(t as UsageAwareTemplate) > 0),
    [category, shown],
  )

  // N-026: 差し込みを含むテンプレートは、送信と同じ解決器の結果をプレビューに
  // 出す。生の `{{name}}` のまま見せると「送ったらどう届くか」が分からず、
  // 解決できない差し込みも送信まで気づけない。
  useEffect(() => {
    if (!open || !selectedTemplate || !chatId || !selectedTemplate.messageContent.includes('{{')) {
      setResolvedPreview(null)
      return
    }
    let cancelled = false
    const templateId = selectedTemplate.id
    void api.chats.renderPreview(chatId, {
      content: selectedTemplate.messageContent,
      messageType: 'text',
    }).then((res) => {
      if (cancelled) return
      setResolvedPreview(
        res.success
          ? { forId: templateId, content: res.data.content, unresolved: res.data.unresolved }
          : null,
      )
    }).catch(() => {
      if (!cancelled) setResolvedPreview(null)
    })
    return () => {
      cancelled = true
    }
  }, [open, selectedTemplate, chatId])

  if (!open) return null

  const selected = selectedTemplate
  const previewContent =
    resolvedPreview && selected && resolvedPreview.forId === selected.id
      ? resolvedPreview.content
      : null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="テンプレートを選択"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
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
              ref={searchInputRef}
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

        {/*
          * 狭い画面では左の一覧と右のプレビューを縦に積み、この領域ごと
          * スクロールする。プレビューを md 以上だけにすると、狭い画面では
          * 挿入前に全文を確かめる場所がなくなる（IDEA-11）。
          */}
        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[350px_1fr] md:overflow-visible">
          {/*
            INBOX-34: 狭い画面でも一覧は自分の領域で最後までスクロールする。
            md 未満では高さを画面の45%に留め、下のプレビューと操作へ
            続けて届くようにする。md 以上はグリッドの残り高を使う。
          */}
          <div className="max-h-[45dvh] min-h-0 overflow-y-auto border-b border-[#E5E7EB] bg-[#F7F8F6] p-3 md:max-h-none md:border-b-0 md:border-r">
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
              {onPickPack ? (
                <button
                  type="button"
                  onClick={() => {
                    setPackMode((prev) => !prev)
                    setPackItems([])
                  }}
                  aria-pressed={packMode}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${packMode ? 'border-[#A6E7BD] bg-[#EAFBF0] text-[#057A37]' : 'border-[#E5E7EB] bg-canvas text-[#667085] hover:bg-[#F2F4F7]'}`}
                >
                  まとめて選ぶ
                </button>
              ) : null}
              <span className="ml-auto text-[11px] text-[#98A2B3]">
                {visibleTemplatesStatus === 'ready' ? `${total}件` : '—'}
              </span>
            </div>
            {/*
              INBOX-15: 「よく使う」は送信数・使用箇所の多い順。実績がまだ
              1件も無いときは、推測ではなく実績が無いことを先に断る。
            */}
            {category === 'frequent' && visibleTemplatesStatus === 'ready' && shown.length > 0 && !frequentHasUsage ? (
              <p className="mb-2 text-[11px] leading-relaxed text-[#98A2B3]">
                まだ送信・使用の実績がないため、実績順ではなく登録順で表示しています。
              </p>
            ) : null}
            {visibleTemplatesStatus === 'loading' ? (
              <p className="px-4 py-10 text-center text-sm text-ink-faint">テンプレートを読み込んでいます。</p>
            ) : visibleTemplatesStatus === 'error' ? (
              <p className="px-4 py-10 text-center text-sm text-danger">テンプレートを読み込めませんでした。もう一度開き直してください。</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#98A2B3]">
                {/*
                  PERF-12: 絞り込み中の0件は「見つからない」、無条件の0件は
                  「まだ無い」。届いた分だけを絞った見かけ上の0と区別する。
                */}
                {search.trim() || folderId || category !== 'all' ? '見つかりませんでした。' : '文字のテンプレートがまだありません。'}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((template) => {
                  const packIndex = packItems.findIndex((item) => item.id === template.id)
                  const inPack = packIndex >= 0
                  return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(template.id)
                        if (!packMode) return
                        setPackItems((prev) =>
                          inPack
                            ? prev.filter((item) => item.id !== template.id)
                            : prev.length >= 5
                              ? prev
                              : [...prev, { id: template.id, name: template.name, content: template.messageContent }],
                        )
                      }}
                      aria-pressed={packMode ? inPack : selected?.id === template.id}
                      className={`w-full rounded-lg border px-3 py-3 text-left ${inPack || (!packMode && selected?.id === template.id) ? 'border-[#A6E7BD] bg-[#EAFBF0]' : 'border-[#E5E7EB] bg-canvas hover:bg-[#F2F4F7]'}`}
                    >
                      <p className="truncate text-sm font-semibold text-[#1F2937]" title={template.name}>
                        {inPack ? `${packIndex + 1}. ` : ''}{template.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#667085]">{template.messageContent}</p>
                    </button>
                  </li>
                  )
                })}
              </ul>
            )}
            {/*
              PERF-12: 届いていない区画があれば下へ足す。「よく使う」は
              上位5件だけ見せる決まりなので続きは出さない。
            */}
            {visibleTemplatesStatus === 'ready' && category !== 'frequent' && templates.length < total ? (
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-[#E5E7EB] bg-canvas px-3 py-1.5 text-xs font-semibold text-[#2563EB] hover:bg-[#F2F4F7] disabled:opacity-50"
                >
                  {loadingMore ? '読み込み中...' : `さらに表示（残り${total - templates.length}件）`}
                </button>
              </div>
            ) : null}
          </div>

          <section className="min-h-0 bg-canvas p-6 md:overflow-y-auto" aria-label="テンプレートのプレビュー">
            {packMode && packItems.length > 0 ? (
              <div className="mb-4 rounded-lg border border-[#E5E7EB] bg-[#F7F8F6] p-3">
                <p className="text-xs font-semibold text-[#344054]">まとめて送る順番（{packItems.length}/5通）</p>
                <ol className="mt-2 space-y-1">
                  {packItems.map((item, index) => (
                    <li key={item.id} className="flex items-center gap-2 text-xs text-[#667085]">
                      <span className="w-4 shrink-0 text-right font-semibold text-[#344054]">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
                      <button
                        type="button"
                        onClick={() => setPackItems((prev) => prev.filter((p) => p.id !== item.id))}
                        aria-label={`${item.name}をまとめ送りから外す`}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[#98A2B3] hover:bg-[#E5E7EB] hover:text-[#344054]"
                      >
                        外す
                      </button>
                    </li>
                  ))}
                </ol>
                {packItems.length >= 5 ? (
                  <p className="mt-2 text-[11px] text-[#B45309]">1回に送れるのは5通までです。</p>
                ) : null}
              </div>
            ) : null}
            {selected ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-[#1F2937]">{selected.name}</h3>
                  {category === 'frequent' && <span className="rounded-lg border border-[#F6D68A] bg-[#FFF8E7] px-2.5 py-1.5 text-xs font-semibold text-[#B45309]">☆ よく使う</span>}
                </div>
                <p className="mt-5 text-xs font-semibold text-[#667085]">送信内容のプレビュー</p>
                <div className="mt-3 min-h-[250px] rounded-[12px] bg-[#7292BD] p-5 shadow-card">
                  <div className="flex justify-center"><span className="rounded-full bg-canvas/85 px-3 py-1 text-[11px] text-[#667085]">今日</span></div>
                  <div className="mt-4 max-w-[78%] rounded-[12px] rounded-tl-[4px] bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-[#344054] shadow-sm">{previewContent ?? selected.messageContent}</div>
                </div>
                {previewContent !== null && resolvedPreview?.unresolved.length ? (
                  <p className="mt-3 text-xs leading-6 text-danger" role="alert">
                    解決できない差し込みがあります: {resolvedPreview.unresolved.map((v) => `{{${v}}}`).join(' ')}。このまま送信するとエラーになります。
                  </p>
                ) : null}
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

        {/*
          INBOX-18: 説明文は操作より上の独立した行へ。操作は専用の行にして
          折り返さない（以前は同じ flex 行で、説明に押されてボタンの
          文字が1文字ずつ縦に割れていた）。
          INBOX-13: 狭い画面では一覧とプレビューが縦に積まれるため、
          現在の選択名を操作の直上に固定して出す。押す直前に
          何を挿入するかが画面に残る。
        */}
        <footer className="border-t border-[#E5E7EB] bg-canvas px-6 py-4">
          {selected ? (
            <p className="mb-1 truncate text-xs font-semibold text-[#344054] md:hidden" title={selected.name}>
              選択中: {selected.name}
            </p>
          ) : (
            <p className="mb-1 text-xs text-[#98A2B3] md:hidden">テンプレートが選択されていません</p>
          )}
          <p className="text-xs text-[#667085]">
            {packMode
              ? '選んだ順にまとめて送ります。送る前に確認画面が出ます。'
              : '入力後に文章を編集してから送信できます。'}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              onClick={onClose}
              className="min-h-11 whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-canvas px-4 py-2 text-sm font-semibold text-[#667085] hover:bg-[#F7F8F6]"
            >
              キャンセル
            </button>
            {packMode && onPickPack ? (
              <button
                disabled={packItems.length === 0}
                onClick={() => {
                  if (packItems.length === 0) return
                  onPickPack(packItems.map((item) => item.content))
                  onClose()
                }}
                className="min-h-11 whitespace-nowrap rounded-lg bg-accent-deep px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-deep/90 disabled:opacity-40"
              >
                まとめて送る（{packItems.length}通）
              </button>
            ) : (
              <button
                disabled={!selected}
                onClick={() => {
                  if (!selected) return
                  onPick(selected.messageContent)
                  onClose()
                }}
                className="min-h-11 whitespace-nowrap rounded-lg bg-accent-deep px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-deep/90 disabled:opacity-40"
              >
                入力欄へ挿入
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
