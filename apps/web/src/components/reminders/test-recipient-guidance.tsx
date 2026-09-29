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

export type ReminderTestRecipientKind = 'self' | 'registered'

/**
 * REMINDER-12: 届け先の種別。「送ったあと」の応答が種別を持っていれば
 * そちらが正本（表示の再読込より新しい実送信結果）。無ければ表示用の
 * 解決結果を使う。どちらにも無ければ null＝種別が決まっていない。
 */
function recipientKindOf(
  view: ReminderTestRecipientView,
  sentKind: ReminderTestRecipientKind | null,
): ReminderTestRecipientKind | null {
  return sentKind ?? (view.kind === 'ready' ? view.recipientKind : null)
}

/**
 * 「テスト対象」パネルの注記。届け先の種別が分かっているときだけ
 * 「誰へ届くか」を名乗る。未確定のあいだは本人・登録のどちらも名乗らない。
 */
export function testRecipientNote(
  view: ReminderTestRecipientView,
  sentKind: ReminderTestRecipientKind | null = null,
): string {
  const kind = recipientKindOf(view, sentKind)
  if (kind === 'self') return '自分のLINEへ確認用メッセージを送ります。'
  if (kind === 'registered') return '登録済みのテスト送信先へ確認用メッセージを送ります。'
  return 'テスト送信先へ確認用メッセージを送ります。'
}

/**
 * 要約カード・送信先メトリクスの表示。登録宛先は「自分のLINE」と見分けが
 * つくよう種別つきで出し、実名も必ず添える。
 */
export function testRecipientDestinationLabel(
  view: ReminderTestRecipientView,
  sentRecipientName: string | null,
  sentKind: ReminderTestRecipientKind | null = null,
): string {
  const name = testRecipientLabel(view, sentRecipientName)
  const kind = recipientKindOf(view, sentKind)
  if (kind === 'self') return `自分のLINE（${name}）`
  if (kind === 'registered') return `登録済みテスト宛先（${name}）`
  return name
}

/**
 * 確認窓の説明文。本人以外へ送る場合は必ず「登録済みテスト宛先」と
 * 実名を明示して、本人へ届くという取り違えを防ぐ。
 */
export function testSendConfirmDescription(
  view: ReminderTestRecipientView,
  sentRecipientName: string | null,
  sentKind: ReminderTestRecipientKind | null = null,
): string {
  const kind = recipientKindOf(view, sentKind)
  const name = testRecipientLabel(view, sentRecipientName)
  if (kind === 'self') return `自分のLINE（${name}）へ確認用メッセージを1通送信します。`
  if (kind === 'registered') return `登録済みのテスト送信先「${name}」へ確認用メッセージを1通送信します。`
  return 'テスト送信先へ確認用メッセージを1通送信します。'
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
