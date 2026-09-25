'use client'

import Button from './button'
import Chip, { type ChipTone } from './chip'

/**
 * 版の履歴（汎用）。テンプレート #820・写真の報酬 #817・
 * アフィリエイト案件 #823 で同じ部品を使う。
 *
 * 版そのものは持たない。呼び出し側が `versions` に寄せて渡す。
 * 札は3つだけ。予約 / 使用中 / 過去。
 */
export type VersionStatus = 'in_use' | 'reserved' | 'past'

export interface HistoryVersion {
  versionNumber: number
  /** 「第3版」など。数え方は呼び出し側が決める。 */
  title: string
  status: VersionStatus
  /** 札の横の短い注。「10/1から使う」「いま使っている」など。 */
  statusNote?: string | null
  /** 版の中身のひとこと。「報酬を5pt→10ptに」など。 */
  summary?: string | null
  author?: string | null
  at?: string | null
}

const STATUS_META: Record<VersionStatus, { label: string; tone: ChipTone }> = {
  in_use: { label: '使用中', tone: 'ok' },
  reserved: { label: '予約', tone: 'warn' },
  past: { label: '過去', tone: 'neutral' },
}

export function versionStatusMeta(status: VersionStatus) {
  return STATUS_META[status]
}

export default function VersionHistory({
  versions,
  selectedVersionNumber,
  onSelect,
  compareLabel,
  onCompare,
  revertLabel,
  onRevert,
  canRevert = true,
  revertDisabledReason,
  busy = false,
}: {
  versions: HistoryVersion[]
  selectedVersionNumber: number | null
  onSelect: (versionNumber: number) => void
  compareLabel: string
  onCompare: () => void
  revertLabel: string
  onRevert: () => void
  canRevert?: boolean
  revertDisabledReason?: string
  busy?: boolean
}) {
  if (versions.length === 0) {
    return <p className="text-ink-faint text-xs">版はまだありません。</p>
  }
  const selected = versions.find((v) => v.versionNumber === selectedVersionNumber) ?? null
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {versions.map((version) => {
          const meta = STATUS_META[version.status]
          const active = version.versionNumber === selectedVersionNumber
          return (
            <li
              key={version.versionNumber}
              className={
                active
                  ? 'rounded-card border border-accent bg-canvas'
                  : 'rounded-card border border-hairline bg-canvas'
              }
            >
              <button
                type="button"
                onClick={() => onSelect(version.versionNumber)}
                aria-pressed={active}
                className="block w-full p-3 text-left"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ink text-sm font-semibold">{version.title}</span>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                  {version.statusNote ? (
                    <span className="text-ink-faint text-xs">{version.statusNote}</span>
                  ) : null}
                </span>
                {version.summary ? (
                  <span className="text-ink-secondary mt-1 block truncate text-xs" title={version.summary}>
                    {version.summary}
                  </span>
                ) : null}
                {version.author || version.at ? (
                  <span className="text-ink-faint mt-0.5 block text-xs">
                    {[version.author, version.at].filter(Boolean).join(' ・ ')}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!selected || busy}
          onClick={onCompare}
        >
          {compareLabel}
        </Button>
        <Button
          variant="secondary"
          disabled={!selected || !canRevert || busy}
          title={!selected ? undefined : revertDisabledReason}
          onClick={onRevert}
        >
          {revertLabel}
        </Button>
      </div>
    </div>
  )
}
