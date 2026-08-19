'use client'

/*
 * 変更内容の履歴。
 *
 * 「いつ・だれが・何を変えたか」を出す。実体は docs/release-log/*.md で、
 * ビルド時に JSON へ変換して同梱している（apps/web/scripts/build-release-log.mjs）。
 *
 * 隣にある「履歴」（緊急操作・システム更新）とは別物なので、節を分けてある。
 * あちらは**操作の記録**、こちらは**変更の中身**。混ぜると、運用者が
 * 「先週から画面が変わったのは何だったのか」を探すときに読みにくい。
 *
 * 実行時に GitHub や DB を見に行かないのは、表示される履歴と、いま動いて
 * いるコードを必ず一致させるため。配布に失敗したときに画面だけ新しくなる、
 * ということが起きない。
 */

import { useEffect, useState } from 'react'
import releaseLog from '@/generated/release-log.json'

type Kind = 'added' | 'changed' | 'fixed'

interface ReleaseEntry {
  kind: string
  text: string
  by: string | null
  pr: number | null
  /** いつ変えたか。JSTの "YYYY-MM-DDTHH:MM"。省略できる。 */
  at: string | null
}

interface Release {
  version: string
  released: string | null
  entries: ReleaseEntry[]
}

const KIND_LABEL: Record<Kind, string> = { added: '追加', changed: '変更', fixed: '修正' }

/** 区分の色。状態色に合わせる（追加=success、修正=warning）。 */
const KIND_CLASS: Record<Kind, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  changed: 'bg-blue-100 text-blue-700',
  fixed: 'bg-amber-100 text-amber-800',
}

/** 担当の呼び名。ここに無い名前はそのまま出す。 */
const BY_LABEL: Record<string, string> = { kenta: 'kenta', masato: 'masato' }

const REPO_URL = 'https://github.com/skmtmst/line-harness-oss'

/**
 * 日時を出す。時刻まで書かれていれば時刻も出す。
 *
 * すべてJSTとして読む。運用しているのが日本の1拠点なので、時差を持たせると
 * 「この14:30は誰の14:30か」を毎回考えることになる。
 */
function formatWhen(value: string | null, opts: { fallback?: string } = {}): string {
  if (!value) return opts.fallback ?? ''
  const hasTime = /[ T]\d{2}:\d{2}/.test(value)
  const iso = value.replace(' ', 'T')
  const date = new Date(hasTime ? `${iso}:00+09:00` : `${iso}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

function formatReleased(released: string | null): string {
  return formatWhen(released, { fallback: '次回反映予定' })
}

/** 一覧の行に出す短い形。「8月19日 14:07」。 */
function formatEntryWhen(value: string | null): string {
  if (!value) return ''
  const hasTime = /[ T]\d{2}:\d{2}/.test(value)
  const iso = value.replace(' ', 'T')
  const date = new Date(hasTime ? `${iso}:00+09:00` : `${iso}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', {
    month: 'long',
    day: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export default function ReleaseLogPanel() {
  const releases = (releaseLog as { releases: Release[] }).releases ?? []
  const [role, setRole] = useState<string | null>(null)
  const [openVersion, setOpenVersion] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all')
  const [byFilter, setByFilter] = useState<'all' | string>('all')

  useEffect(() => {
    setRole(window.localStorage.getItem('lh_staff_role'))
    // 既定でいちばん上（未リリース、無ければ最新版）を開いておく。
    setOpenVersion(releases[0]?.version ?? null)
    // releases はビルド時に固定される。開き直しは要らない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * 「次回反映予定」は、まだ出ていない機能なので全員には見せない。
   * 役割が読めないあいだも隠す（読めてから出す）。
   */
  const canSeeUnreleased = role === 'owner' || role === 'admin'
  const visible = releases.filter((r) => r.released !== null || canSeeUnreleased)

  const people = [...new Set(releases.flatMap((r) => r.entries.map((e) => e.by).filter(Boolean)))] as string[]

  if (visible.length === 0) {
    return (
      <div className="border-hairline rounded-card overflow-hidden border bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">変更内容</h2>
        </div>
        <p className="p-8 text-center text-xs text-gray-500">まだ記録がありません。</p>
      </div>
    )
  }

  return (
    <div className="border-hairline rounded-card overflow-hidden border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">変更内容</h2>
          <p className="mt-0.5 text-xs text-gray-500">いつ・だれが・何を変えたか</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | Kind)}
            className="border-hairline rounded-control min-h-9 border bg-white px-3 text-xs"
            aria-label="区分でしぼる"
          >
            <option value="all">すべての区分</option>
            <option value="added">追加</option>
            <option value="changed">変更</option>
            <option value="fixed">修正</option>
          </select>
          {people.length > 1 && (
            <select
              value={byFilter}
              onChange={(e) => setByFilter(e.target.value)}
              className="border-hairline rounded-control min-h-9 border bg-white px-3 text-xs"
              aria-label="担当でしぼる"
            >
              <option value="all">すべての担当</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {BY_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {visible.map((release) => {
          const entries = release.entries.filter(
            (e) =>
              (kindFilter === 'all' || e.kind === kindFilter) &&
              (byFilter === 'all' || e.by === byFilter),
          )
          const open = openVersion === release.version
          return (
            <div key={release.version}>
              <button
                type="button"
                onClick={() => setOpenVersion(open ? null : release.version)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">
                    {release.released ? release.version : '次回反映予定'}
                  </span>
                  <span className="text-xs text-gray-500">{formatReleased(release.released)}</span>
                  {!release.released && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                      まだ反映されていません
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {entries.length}件{open ? '' : '（押すと開きます）'}
                </span>
              </button>

              {open &&
                (entries.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-gray-500">
                    しぼり込みに当てはまるものがありません。
                  </p>
                ) : (
                  <ul className="space-y-2 px-4 pb-4">
                    {entries.map((entry, i) => (
                      <li
                        key={`${release.version}-${i}`}
                        className="grid gap-2 md:grid-cols-[64px_150px_1fr_auto] md:items-start"
                      >
                        <span
                          className={`w-fit rounded-full px-2.5 py-1 text-center text-[11px] font-bold ${
                            KIND_CLASS[entry.kind as Kind] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {KIND_LABEL[entry.kind as Kind] ?? entry.kind}
                        </span>
                        <time className="text-xs text-gray-500">
                          {formatEntryWhen(entry.at) || '—'}
                        </time>
                        <p className="text-sm leading-relaxed text-gray-800">{entry.text}</p>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                          {entry.by && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-bold text-gray-700">
                              {BY_LABEL[entry.by] ?? entry.by}
                            </span>
                          )}
                          {entry.pr && (
                            <a
                              href={`${REPO_URL}/pull/${entry.pr}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-700 hover:underline"
                            >
                              #{entry.pr}
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
