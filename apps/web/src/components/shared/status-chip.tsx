import React from 'react'
import StatusBadge, { type StatusBadgeTone } from './status-badge'

/** 設計 B（★V7「監査の直し」）の6つの状態。画面ごとの言い方はやめ、これに寄せる。 */
export type StatusChipStatus = 'draft' | 'ready' | 'reserved' | 'running' | 'paused' | 'ended'

const LABEL: Record<StatusChipStatus, string> = {
  draft: '下書き',
  ready: '準備完了',
  reserved: '予約中',
  running: '稼働中',
  paused: '停止中',
  ended: '終了',
}

const TONE: Record<StatusChipStatus, StatusBadgeTone> = {
  draft: 'neutral',
  ready: 'info',
  reserved: 'info',
  running: 'success',
  paused: 'warning',
  ended: 'neutral',
}

/**
 * 札の言葉の意味（設計 B）。「？」に入れるときに使う。
 * 表の列では見出しの「？」にまとめるか、何も付けない（1行ごとに付けない）。
 */
export const STATUS_CHIP_HELP: Record<StatusChipStatus, string> = {
  draft: 'まだ作っている途中。お客さんには何も起きない',
  ready: '中身はそろった。始める日時か、始める操作を待っている',
  reserved: '日時が決まっていて、その時に自動で始まる',
  running: 'いま動いている（送る・数える・受け付ける）',
  paused: '運用者が止めた。再開すると続きから動く',
  ended: '決めた期間が終わった・送り終わった',
}

/**
 * 状態の札（★V7 共通部品。設計 B の6つ）。
 * 色だけにしない（札の文字で分かる）。緑は「正常・うまくいっている」だけに使う。
 */
export default function StatusChip({
  status,
  size = 'compact',
  withHelp = false,
}: {
  status: StatusChipStatus
  size?: 'default' | 'compact'
  /** 札の意味を「？」に入れる（1つの札だけの場所で使う。表の行ごとは付けない）。 */
  withHelp?: boolean
}) {
  return (
    <StatusBadge
      tone={TONE[status]}
      size={size}
      help={withHelp ? STATUS_CHIP_HELP[status] : undefined}
      helpLabel={LABEL[status]}
    >
      {LABEL[status]}
    </StatusBadge>
  )
}
