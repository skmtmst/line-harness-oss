'use client'

import Link from 'next/link'
import Button from '@/components/shared/button'
import type { ReminderTestRecipientView } from './use-reminder-test-recipient'

/**
 * テスト送信先の表示（N-070）。
 *
 * 「送信先」の欄に出す文字と、未設定・届かない・読み込み失敗のときの
 * 案内を1か所に置く。公開フロー側と Issue469 側の2画面が同じ判定を使う。
 */

export function testRecipientLabel(
  view: ReminderTestRecipientView,
  sentRecipientName: string | null,
): string {
  if (sentRecipientName) return sentRecipientName
  switch (view.kind) {
    case 'ready':
      return view.recipient.displayName
    case 'unset':
      return '未設定'
    case 'unavailable':
      return '届けられません'
    case 'error':
      return '読み込めませんでした'
    default:
      return '確認中'
  }
}

/** 未設定・届かない・読み込み失敗のときだけ出る案内と再確認の操作。 */
export function TestRecipientGuidance({
  view,
  accountId,
  onRecheck,
}: {
  view: ReminderTestRecipientView
  accountId: string
  onRecheck: () => void
}) {
  if (view.kind === 'ready' || view.kind === 'loading' || view.kind === 'idle') return null
  const settingsHref = `/accounts/detail?id=${encodeURIComponent(accountId)}`
  return (
    <div className="text-ink-secondary mt-2 text-xs">
      {view.kind === 'unset' ? (
        <p>
          テスト送信先がまだ設定されていません。
          <Link href={settingsHref} className="text-action mx-1 hover:underline">アカウント設定</Link>
          で送信先を登録してから「送信先を再確認」を押してください。
        </p>
      ) : null}
      {view.kind === 'unavailable' ? (
        <p>
          設定済みのテスト送信先がこのアカウントで利用できません。
          <Link href={settingsHref} className="text-action mx-1 hover:underline">アカウント設定</Link>
          で別の送信先を選び直してください。
        </p>
      ) : null}
      {view.kind === 'error' ? <p>テスト送信先を読み込めませんでした。通信状態を確認してください。</p> : null}
      <Button variant="secondary" className="mt-2" onClick={onRecheck}>
        送信先を再確認
      </Button>
    </div>
  )
}
