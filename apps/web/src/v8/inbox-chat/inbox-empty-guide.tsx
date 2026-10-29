'use client'
import Button from '@/components/shared/button';
import ListState from '@/components/shared/list-state';
import { type ChatListItem } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { oldestAttentionTarget, type EmailInboxItem, type OldestAttentionTarget } from './inbox-model';

/*
 * 会話を選んでいない時の中央（ID27「次にやること」）。
 * 「会話を選ぶと、ここに表示されます」の1行で空にせず、今の状況と
 * すぐ押せる行き先を出す。件数はサーバーで数えた物だけ（読めない数は
 * 出さない）。全部片づいた時は片づいたと言う。
 */
export default function InboxEmptyGuide({ unread, overdue, slaEnabled, filtered, chats, emails, onOpenTarget }: {
  /** 未対応の件数。読めなかった時は null（0件と見せない）。 */
  unread: number | null
  /** 期限超過（SLA無しは1時間以上待ち）の件数。読めなかった時は null。 */
  overdue: number | null
  slaEnabled: boolean
  /** 今の件数が絞り込みの中の数かどうか。 */
  filtered: boolean
  chats: Pick<ChatListItem, 'id' | 'status' | 'lastMessageAt'>[]
  emails: Pick<EmailInboxItem, 'threadId' | 'isUnread' | 'lastMessageAt' | 'lastIncomingAt'>[]
  onOpenTarget: (target: OldestAttentionTarget) => void
}) {
  const parts: string[] = []
  if (unread !== null) parts.push(`未対応 ${formatNumber(unread)} 件`)
  if (overdue !== null) parts.push(`${slaEnabled ? '期限超過' : '1時間以上待ち'} ${formatNumber(overdue)} 件`)
  if (unread === 0 && overdue === 0) {
    return (
      <ListState kind="empty" emptyPreset="readonly" title="対応が必要な会話はありません" description="左の一覧から選んでください。" />
    )
  }
  if (parts.length === 0) {
    // 件数が両方読めない時は、数を出さず今までどおりの案内だけ。
    return (
      <ListState kind="empty" emptyPreset="readonly" title="会話を選ぶと、ここに表示されます" description="左の一覧から選んでください。「要返信」で、まだ返していない会話だけに絞れます。" />
    )
  }
  const target = oldestAttentionTarget(chats, emails)
  return (
    <ListState
      kind="empty"
      emptyPreset="readonly"
      title="対応が必要な会話があります"
      description={`${parts.join('・')}${filtered ? '（今の絞り込みの中）' : ''}`}
      action={target ? (
        <Button variant="primary" type="button" onClick={() => onOpenTarget(target)}>
          いちばん古い会話を開く
        </Button>
      ) : undefined}
    />
  )
}
