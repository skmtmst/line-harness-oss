'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { CommonVar, CommonVarSchedule, MediaItem, MediaUsage } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'

const TABS = [
  { key: 'media', label: 'メディア' },
  { key: 'vars', label: '共通情報' },
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

function MediaTab() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [usagesFor, setUsagesFor] = useState<{ id: string; items: MediaUsage[] } | null>(null)
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

  const upload = async (file: File) => {
    setUploading(true)
    setError('')
    try {
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
        setError(res.error)
        return
      }
      void load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const showUsages = async (item: MediaItem) => {
    setError('')
    try {
      const res = await api.media.usages(item.id)
      if (res.success) setUsagesFor({ id: item.id, items: res.data })
    } catch {
      setError('使用箇所の読み込みに失敗しました')
    }
  }

  const remove = async (item: MediaItem) => {
    setError('')
    try {
      const res = await api.media.delete(item.id)
      if (!res.success) {
        setError(res.error)
        return
      }
      void load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 使用中。件数を出したうえで、消すかどうかを聞く。
        if (!confirm(`${e.message}\n\nそれでも削除しますか？`)) return
        try {
          await api.media.delete(item.id, { force: true })
          void load()
        } catch {
          setError('削除に失敗しました')
        }
        return
      }
      setError('削除に失敗しました')
    }
  }

  const copyUrl = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.url)
    } catch {
      // クリップボードが使えない環境もある。URLは画面に出ている。
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-secondary text-sm">
          画像・動画・PDFを1か所に置いて、テンプレートやリッチメニューから使い回します。
        </p>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
            className="hidden"
            id="media-upload"
          />
          <label
            htmlFor="media-upload"
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control cursor-pointer px-4 py-2 text-sm font-medium transition-colors"
          >
            {uploading ? 'アップロード中...' : '＋ アップロード'}
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          ファイルがまだありません。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="bg-canvas rounded-card border-hairline border p-3">
              <div className="bg-canvas-sunken mb-2 flex h-32 items-center justify-center overflow-hidden rounded">
                {item.kind === 'image' ? (
                  // 静的書き出しのため next/image の最適化は使えない。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.filename} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-ink-faint text-xs">
                    {item.kind === 'video'
                      ? '動画'
                      : item.kind === 'audio'
                        ? '音声'
                        : 'ファイル'}
                  </span>
                )}
              </div>
              <p className="text-ink truncate text-xs font-medium" title={item.filename}>
                {item.filename}
              </p>
              <p className="text-ink-faint text-[11px] tabular-nums">{formatSize(item.sizeBytes)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  onClick={() => copyUrl(item)}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                >
                  URLをコピー
                </button>
                <button
                  onClick={() => showUsages(item)}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-[11px]"
                >
                  使用箇所
                </button>
                <button
                  onClick={() => remove(item)}
                  className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-[11px]"
                >
                  削除
                </button>
              </div>

              {usagesFor?.id === item.id && (
                <div className="border-hairline mt-2 border-t pt-2">
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
          ))}
        </div>
      )}

      <p className="text-ink-faint mt-4 text-xs leading-relaxed">
        画像は10MB、動画は90MB、PDFは20MBまでです。
        中身の形式とファイル名の拡張子が食い違うものは保存できません。
      </p>
    </div>
  )
}

function VarsTab() {
  const [items, setItems] = useState<CommonVar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [schedulesFor, setSchedulesFor] = useState<{
    id: string
    items: CommonVarSchedule[]
  } | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newValue, setNewValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.commonVars.list()
      if (res.success) {
        setItems(res.data)
        const next: Record<string, string> = {}
        for (const v of res.data) next[v.id] = v.value
        setDrafts(next)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (item: CommonVar) => {
    setError('')
    try {
      const res = await api.commonVars.update(item.id, { value: drafts[item.id] ?? '' })
      if (!res.success) {
        setError(res.error)
        return
      }
      void load()
    } catch {
      setError('保存に失敗しました')
    }
  }

  const remove = async (item: CommonVar) => {
    if (
      !confirm(
        `「${item.name}」を削除しますか？\nテンプレートに {{var.${item.varKey}}} が残っていると、その部分が空になります。`,
      )
    )
      return
    setError('')
    try {
      await api.commonVars.delete(item.id)
      void load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const openSchedules = async (item: CommonVar) => {
    setError('')
    try {
      const res = await api.commonVars.schedules(item.id)
      if (res.success) setSchedulesFor({ id: item.id, items: res.data })
    } catch {
      setError('予約の読み込みに失敗しました')
    }
  }

  const addSchedule = async (item: CommonVar) => {
    if (!newDate) return
    setError('')
    try {
      const res = await api.commonVars.addSchedule(item.id, {
        effectiveFrom: newDate,
        value: newValue,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setNewDate('')
      setNewValue('')
      void openSchedules(item)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '予約に失敗しました')
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-secondary text-sm">
          営業時間や電話番号のように、いくつものテンプレートに同じ文字が出るものを1か所にまとめます。
          テンプレートには <code className="bg-canvas-sunken rounded px-1">{'{{var.差し込み名}}'}</code>{' '}
          と書きます。
        </p>
        <a
          href="/contents/vars/new"
          className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
        >
          ＋ 共通情報を追加
        </a>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          共通情報がまだありません。
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-canvas rounded-card border-hairline border p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-ink text-sm font-medium">{item.name}</p>
                  <code className="text-ink-faint text-xs">{`{{var.${item.varKey}}}`}</code>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openSchedules(item)}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-xs"
                  >
                    日付で切り替える
                  </button>
                  <button
                    onClick={() => remove(item)}
                    className="text-danger hover:bg-danger-bg rounded px-2 py-1 text-xs"
                  >
                    削除
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={drafts[item.id] ?? ''}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  aria-label={`${item.name}の値`}
                  className="border-hairline rounded-control min-w-[16rem] flex-1 border px-3 py-2 text-sm"
                />
                <button
                  onClick={() => save(item)}
                  disabled={(drafts[item.id] ?? '') === item.value}
                  className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm font-medium disabled:opacity-40"
                >
                  保存
                </button>
              </div>

              {schedulesFor?.id === item.id && (
                <div className="border-hairline mt-3 border-t pt-3">
                  <p className="text-ink-faint mb-2 text-xs font-semibold">切り替えの予約</p>
                  {schedulesFor.items.length === 0 ? (
                    <p className="text-ink-faint text-xs">予約はありません。</p>
                  ) : (
                    <ul className="mb-2 space-y-1">
                      {schedulesFor.items.map((s) => (
                        <li key={s.id} className="text-ink-secondary flex gap-2 text-xs">
                          <span className="tabular-nums">
                            {s.effectiveFrom.replace('T', ' ')}
                          </span>
                          <span>→</span>
                          <span className="break-all">{s.value}</span>
                          {s.appliedAt && <span className="text-success">反映済み</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <input
                      type="datetime-local"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      aria-label="切り替える日時"
                      className="border-hairline rounded-control border px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="切り替えたあとの値"
                      aria-label="切り替えたあとの値"
                      className="border-hairline rounded-control w-56 border px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => addSchedule(item)}
                      disabled={!newDate}
                      className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-sm disabled:opacity-40"
                    >
                      予約する
                    </button>
                  </div>
                  <p className="text-ink-faint mt-1 text-[11px]">
                    過去の日時は指定できません。指定した時刻を過ぎると、自動で値が入れ替わります。
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ContentsInner() {
  const tab = useMergedTab(TABS)
  return (
    <div>
      <Header
        title="コンテンツ"
        description="画像や動画、そして何度も使う文字を1か所にまとめます。"
      />
      <MergedTabs basePath="/contents" tabs={TABS} active={tab} />
      {tab === 'media' && <MediaTab />}
      {tab === 'vars' && <VarsTab />}
    </div>
  )
}

export default function ContentsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ContentsInner />
    </Suspense>
  )
}
