'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem, MediaUsage } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import { formatStamp } from '@/lib/common-vars'
import Pagination from '@/components/shared/pagination'

/**
 * 登録メディア一覧。
 *
 * Lステップの「コンテンツ ＞ 登録メディア一覧」と同じ形にしてある。
 * 上にドロップ枠と受け付ける形式の表、その下に種別の絞り込みと検索、
 * 本体は札（カード）を並べた格子、最後にページ送りとまとめて削除。
 *
 * 以前はこの画面が「コンテンツ」1枚で、メディアと共通情報をタブで
 * 切り替えていた。サイドバーから共通情報へ直接行けなかったので、
 * 画面を2つに分けて、共通情報は /contents/vars へ移した。
 */

/** 1ページに出す枚数。Lステップと同じく、下にページ番号を並べる。 */
const PER_PAGE = 20

/**
 * 絞り込みの種別。保存できる kind は image / video / audio / file の4つ。
 * file はいま PDF だけなので、そのまま「PDF」と呼ぶ。
 */
const KINDS: Array<{ key: MediaItem['kind']; label: string }> = [
  { key: 'image', label: '画像' },
  { key: 'audio', label: '音声' },
  { key: 'video', label: '動画' },
  { key: 'file', label: 'PDF' },
]

/**
 * 受け付ける形式と上限。
 *
 * 数字は実装の実際の制限（worker の ALLOWED）に合わせる。設計は動画200MB・
 * PDF10MBだが、いまの実装は90MB・20MB。設計の数字を書くと、通らない
 * ファイルを「通る」と言うことになる。
 */
const LIMITS: Array<{ label: string; note: string }> = [
  { label: '画像', note: '10MBまで、jpg・png・gif・webp画像のみ可' },
  { label: '音声', note: '30MBまで、mp3・m4a音声のみ可' },
  { label: '動画', note: '90MBまで、mp4動画のみ可' },
  { label: 'PDF', note: '20MBまで' },
]

/** 使用箇所の種別を運用者の言葉にする。 */
const REF_KIND_LABELS: Record<string, string> = {
  template: 'テンプレート',
  broadcast: '一斉配信',
  rich_menu: 'リッチメニュー',
  scenario_step: 'シナリオのステップ',
  nen_column: 'NENコラム',
  event: 'イベント',
  webinar: 'ウェビナー',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function MediaLibraryPage() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [kinds, setKinds] = useState<Set<MediaItem['kind']>>(
    () => new Set(KINDS.map((k) => k.key)),
  )
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /** 名前を直している札。null なら誰も直していない。 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [usagesFor, setUsagesFor] = useState<{ id: string; items: MediaUsage[] } | null>(null)
  /** 大きく出している札。押した札の中身を原寸で見せる。 */
  const [preview, setPreview] = useState<MediaItem | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.media.list()
      if (res.success) setItems(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        // FileReader の結果は data: URL。サーバー側がその形も受け付ける。
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('読み取りに失敗しました'))
          reader.readAsDataURL(file)
        })
        const res = await api.media.upload({
          filename: file.name,
          mimeType: file.type,
          data: dataUrl,
        })
        if (!res.success) {
          // 1枚でも弾かれたら、そこで止めて理由を出す。残りを黙って
          // 上げ続けると、どれが通ってどれが落ちたか分からなくなる。
          setError(`${file.name}: ${res.error}`)
          break
        }
      }
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const rename = async () => {
    if (!renaming) return
    const filename = renaming.value.trim()
    if (!filename) return
    setError('')
    try {
      const res = await api.media.update(renaming.id, { filename })
      if (!res.success) {
        setError(res.error)
        return
      }
      setRenaming(null)
      void load()
    } catch {
      setError('名前の変更に失敗しました')
    }
  }

  const showUsages = async (item: MediaItem) => {
    setError('')
    if (usagesFor?.id === item.id) {
      setUsagesFor(null)
      return
    }
    try {
      const res = await api.media.usages(item.id)
      if (res.success) setUsagesFor({ id: item.id, items: res.data })
    } catch {
      setError('使用箇所の読み込みに失敗しました')
    }
  }

  /** 選んだ札をまとめて消す。使用中は件数を出して、もう一度聞く。 */
  const removeSelected = async () => {
    if (selected.size === 0) return
    if (!confirm(`${selected.size}件のメディアを削除しますか？`)) return
    setError('')
    for (const id of selected) {
      try {
        await api.media.delete(id)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const name = items.find((m) => m.id === id)?.filename ?? id
          if (!confirm(`${name}\n${e.message}\n\nそれでも削除しますか？`)) continue
          try {
            await api.media.delete(id, { force: true })
          } catch {
            setError('削除に失敗しました')
          }
          continue
        }
        setError('削除に失敗しました')
      }
    }
    setSelected(new Set())
    void load()
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter(
      (item) =>
        kinds.has(item.kind) && (!needle || item.filename.toLowerCase().includes(needle)),
    )
  }, [items, kinds, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const allSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id))

  return (
    <div>
      <div data-design="Head">
        <Header
          title="登録メディア一覧"
          description="配信やリッチメニューで使う画像・動画・PDFをここにまとめます。どこで使われているかも一緒に管理します。"
          action={
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
          }
        />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {/* ドロップ枠と、受け付ける形式の表。Lステップと同じく左右に並べる。 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void upload([...e.dataTransfer.files])
        }}
        className={`rounded-card mb-4 grid gap-6 border border-dashed p-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] ${
          dragOver ? 'border-accent bg-accent-soft' : 'border-hairline bg-canvas'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-ink text-sm font-semibold">ここにファイルをドロップ</p>
          <p className="text-ink-faint text-xs">または</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf"
            onChange={(e) => void upload([...(e.target.files ?? [])])}
            className="hidden"
            id="media-upload"
          />
          <label
            htmlFor="media-upload"
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control cursor-pointer px-4 py-2 text-sm font-medium transition-colors"
          >
            {uploading ? 'アップロード中...' : 'ファイルを選択する'}
          </label>
          <p className="text-danger text-xs leading-relaxed">
            ※ 公開リンクが作られるため、個人情報の取り扱いに注意してください
          </p>
        </div>

        <dl className="text-xs">
          {LIMITS.map((limit) => (
            <div key={limit.label} className="flex gap-4 py-1">
              <dt className="text-ink-secondary w-24 shrink-0 font-medium">{limit.label}</dt>
              <dd className="text-ink-faint">{limit.note}</dd>
            </div>
          ))}
          <div className="flex gap-4 py-1">
            <dt className="text-ink-secondary w-24 shrink-0 font-medium">形式の確認</dt>
            <dd className="text-ink-faint">
              中身の形式とファイル名の拡張子が食い違うものは保存できません
            </dd>
          </div>
        </dl>
      </div>

      {/* 種別の絞り込みと検索。Lステップと同じく格子の右肩に置く。 */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        {KINDS.map((kind) => (
          <label key={kind.key} className="text-ink-secondary flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={kinds.has(kind.key)}
              onChange={() => {
                setPage(1)
                setKinds((prev) => {
                  const next = new Set(prev)
                  if (next.has(kind.key)) next.delete(kind.key)
                  else next.add(kind.key)
                  return next
                })
              }}
              className="accent-green-500"
            />
            {kind.label}
          </label>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder="メディア名を検索"
          aria-label="メディア名を検索"
          className="border-hairline rounded-control focus:ring-accent w-56 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : current.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          {items.length === 0 ? 'ファイルがまだありません。' : 'この条件に合うメディアはありません。'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {current.map((item) => (
            <div
              key={item.id}
              className="bg-canvas rounded-card border-hairline flex flex-col overflow-hidden border"
            >
              <button
                onClick={() => setPreview(item)}
                title="プレビューを見る"
                className="bg-canvas-sunken flex h-32 items-center justify-center overflow-hidden"
              >
                {item.kind === 'image' ? (
                  // 静的書き出しのため next/image の最適化は使えない。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.filename} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-ink-faint text-xs">
                    {item.kind === 'video' ? '動画' : item.kind === 'audio' ? '音声' : 'ファイル'}
                  </span>
                )}
              </button>

              <div className="flex flex-1 flex-col gap-1 p-2">
                {renaming?.id === item.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      aria-label="ファイル名"
                      className="border-accent rounded-control w-full border px-2 py-1 text-xs"
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setRenaming(null)}
                        className="border-hairline text-ink-secondary rounded border px-2 py-1 text-[11px]"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => void rename()}
                        className="bg-accent text-on-accent rounded px-2 py-1 text-[11px]"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(item.id)) next.delete(item.id)
                            else next.add(item.id)
                            return next
                          })
                        }
                        aria-label={`${item.filename}を選ぶ`}
                        className="accent-green-500 mt-0.5"
                      />
                      <span className="bg-ink-secondary text-on-accent rounded px-1 py-0.5 text-[10px] leading-none">
                        {KINDS.find((k) => k.key === item.kind)?.label ?? 'ファイル'}
                      </span>
                      <span className="text-ink min-w-0 flex-1 truncate text-xs font-medium" title={item.filename}>
                        {item.filename}
                      </span>
                    </label>
                    <p className="text-ink-faint text-[11px] tabular-nums">
                      登録：{formatStamp(item.createdAt)}・{formatSize(item.sizeBytes)}
                    </p>
                  </>
                )}

                <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                  <button
                    onClick={() => void showUsages(item)}
                    title="使用箇所を見る"
                    aria-label={`${item.filename}の使用箇所`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    使用箇所
                  </button>
                  <button
                    onClick={() => setRenaming({ id: item.id, value: item.filename })}
                    title="名前を変える"
                    aria-label={`${item.filename}の名前を変える`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    編集
                  </button>
                  <a
                    href={item.url}
                    download={item.filename}
                    title="ダウンロード"
                    aria-label={`${item.filename}をダウンロード`}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                  >
                    保存
                  </a>
                </div>

                {usagesFor?.id === item.id && (
                  <div className="border-hairline mt-1 border-t pt-1">
                    {usagesFor.items.length === 0 ? (
                      <p className="text-ink-faint text-[11px]">
                        どこでも使われていません。
                        <br />
                        （本文の走査が済んだ時点の情報です）
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {usagesFor.items.map((u) => (
                          <li key={`${u.refKind}-${u.refId}`} className="text-ink-secondary text-[11px]">
                            {REF_KIND_LABELS[u.refKind] ?? u.refKind}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-ink-secondary flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected((prev) => {
                  if (allSelected) return new Set<string>()
                  const next = new Set(prev)
                  for (const item of filtered) next.add(item.id)
                  return next
                })
              }
              className="accent-green-500"
            />
            全てのメディアを選択
          </label>
          <button
            onClick={() => void removeSelected()}
            disabled={selected.size === 0}
            className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            選択したメディアを削除
            {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
          </button>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.filename}のプレビュー`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreview(null)
          }}
        >
          <button
            onClick={() => setPreview(null)}
            aria-label="プレビューを閉じる"
            className="text-on-accent absolute top-4 right-6 text-2xl leading-none"
          >
            ×
          </button>
          {preview.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={preview.filename}
              className="max-h-full max-w-full object-contain"
            />
          ) : preview.kind === 'video' ? (
            <video src={preview.url} controls className="max-h-full max-w-full" />
          ) : preview.kind === 'audio' ? (
            <audio src={preview.url} controls />
          ) : (
            <div className="rounded-card bg-canvas p-6 text-center text-sm">
              <p className="text-ink font-medium">{preview.filename}</p>
              <a href={preview.url} target="_blank" rel="noreferrer" className="text-info mt-2 inline-block hover:underline">
                別のタブで開く
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
