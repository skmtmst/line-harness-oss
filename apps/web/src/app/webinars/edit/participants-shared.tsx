import React from 'react'
import type { WebinarParticipantClassification, WebinarParticipantPage } from '@/lib/api'

/*
 * ウェビナー参加者の段の小物置き場。v7 の段（`page.tsx`）と
 * V8 の段（`participants-v8.tsx`）の両方から使う。
 * 分類の言葉はサーバーの一つのルールに合わせ、2か所でずらさない。
 */

export function fmtSec(sec: number): string {
  // 負 = 開始前 (待機ルーム) の相対時刻。-330 → -5:30
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${sign}${m}:${String(s).padStart(2, '0')}`
}

export function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '—'
}

export function ParticipantAvatar({
  name,
  pictureUrl,
  size = 'md',
}: {
  name: string
  pictureUrl: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = size === 'lg' ? 'h-11 w-11 text-sm' : size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  // 外部 URL は https だけ読み、http 等は頭文字表示に落とす。
  if (pictureUrl && pictureUrl.startsWith('https://')) {
    return (
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`${sizeClass} shrink-0 rounded-pill bg-canvas-sunken object-cover ring-2 ring-canvas`}
      />
    )
  }
  return (
    <span className={`${sizeClass} flex shrink-0 items-center justify-center rounded-pill bg-info-bg font-bold text-info ring-2 ring-canvas`}>
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

/* 参加者一覧の1頁ぶん。サーバーは最大200件まで返す。 */
export const PARTICIPANTS_PAGE_SIZE = 50

/*
 * 参加者の分類フィルタ（IDEA-10）。分類ルールはサーバーが持ち、
 * 画面はラベルだけを決める。計測外 = 外部動画などで個人の視聴を
 * 取得できず、視聴データが無いことを未視聴と断定しない区分。
 */
export const PARTICIPANT_FILTER_OPTIONS: Array<{ value: '' | WebinarParticipantClassification; label: string }> = [
  { value: '', label: 'すべての申込・参加者' },
  { value: 'unviewed', label: '未参加（申込のみ・入場記録なし）' },
  { value: 'dropped_off', label: '途中離脱（入場したが未完了）' },
  { value: 'completed', label: '視聴完了' },
  { value: 'unmeasured', label: '計測外' },
]

export type ParticipantRow = WebinarParticipantPage['items'][number]

/**
 * 参加者行の分類表示。サーバーの classification を優先し、
 * 無い古い応答だけ従来の推測へ落とす。
 */
export function participantStateLabel(participant: ParticipantRow, durationSeconds: number): string {
  const rate = Math.min(100, Math.round((participant.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
  const hasWatchError = participant.staffIntegrationStatus === 'needs_attention' || Boolean(participant.errorDetail)
  if (participant.classification === undefined) {
    return participant.maxWatchedSeconds === 0
      ? hasWatchError ? '視聴エラー' : participant.latestJoinedAt ? '視聴開始直後' : '未視聴'
      : rate >= 90 ? `視聴完了 ${rate}%` : rate > 0 ? `視聴中 ${rate}%` : '未視聴'
  }
  switch (participant.classification) {
    case 'unmeasured': return '計測外'
    case 'unviewed': return '未参加'
    case 'completed': return `視聴完了 ${rate}%`
    case 'dropped_off':
      return participant.maxWatchedSeconds === 0
        ? hasWatchError ? '視聴エラー' : '入場のみ（再生を確認できず）'
        : `途中離脱 ${rate}%`
  }
}

/** 入場がライブ時間内か終了後（録画）かを回数つきで短く示す。 */
export function joinKindLabel(participant: ParticipantRow): string {
  const live = participant.liveSessions ?? 0
  const replay = participant.replaySessions ?? 0
  if (live === 0 && replay === 0) return ''
  const parts: string[] = []
  if (live > 0) parts.push(`ライブ${live}`)
  if (replay > 0) parts.push(`録画${replay}`)
  return `（${parts.join('・')}）`
}
