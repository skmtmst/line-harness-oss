'use client'

import Chip from '@/components/shared/chip';
import HelpTip from '@/components/shared/help-tip';
import type { ApiBroadcast } from '@/lib/api';
import { formatDateTime } from '@/lib/format';



/*
 * 一斉配信の二者承認の見た目（m12a / 設計 A）。
 *
 * A-1 送る前の確認（承認する人の選択・ひとこと）
 * A-2 承認待ちの札・帯（依頼の取り消し・もう一度知らせる）
 * A-3 承認する人の操作（承認する人にだけ出す）
 * A-4 1人運用の人数の確認
 *
 * 既存の共有部品だけを使う。新しい見た目の決まりは作らない。
 * 緑の塗りボタンは置かない（押すボタンは呼び出し側の確認ダイアログが持つ）。
 */

export type ApprovalStatus = NonNullable<ApiBroadcast['approvalStatus']>


/**
 * 承認まわりの日時（例：8月24日（月）10:00）。
 * 配信の確認で使う書き方にそろえる。壊れた値は「—」にする。
 */
export function formatApprovalDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDateTime(date)
}


/** A-2 一覧の札。承認待ちと期限切れだけ出す。 */
export function ApprovalBadge({ status }: { status: ApprovalStatus | undefined }) {
  if (status === 'pending') {
    return (
      <>
        <Chip tone="info">承認待ち</Chip>
        <HelpTip label="承認待ちの説明">承認する人が中身を見て決めるのを待っています。</HelpTip>
      </>
    )
  }
  if (status === 'expired') {
    return (
      <>
        <Chip tone="neutral">期限切れ</Chip>
        <HelpTip label="期限切れの説明">承認の期限が過ぎました。頼み直してください。</HelpTip>
      </>
    )
  }
  return null
}