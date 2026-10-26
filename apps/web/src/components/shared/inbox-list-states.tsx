import { MessageCircle } from 'lucide-react'
import Button from './button'
import ListState from './list-state'
import Notice from './notice'

/**
 * 受信箱の一覧の空と失敗。ほかの一覧と同じ形（空は印・題・説明、失敗は知らせ1つ・もう一度読み込む1つ）。
 * 会話とメールが両方失敗しても、知らせとボタンは1つにまとめる（押せば失敗した物を全部読み直す）。
 */
export function InboxListEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div data-inbox-list-state={filtered ? 'filtered-empty' : 'empty'}>
      <ListState
        kind="empty"
        emptyPreset={filtered ? 'filtered' : 'readonly'}
        icon={<MessageCircle aria-hidden="true" size={20} />}
        title={filtered ? '条件に一致する会話がありません' : 'まだ会話がありません'}
        description={filtered ? '条件を変えるか、絞り込みを外してください。' : 'LINE で話しかけられるとここに出ます。'}
        action={filtered ? <Button onClick={onClear}>絞り込みを外す</Button> : undefined}
      />
    </div>
  )
}

export function InboxListFailure({ messages, onRetry }: { messages: readonly string[]; onRetry: () => void }) {
  if (messages.length === 0) return null
  return (
    <div data-inbox-list-failure="">
      <Notice tone="danger" role="alert" action={<Button size="field" onClick={onRetry}>もう一度読み込む</Button>}>
        {messages.map((message) => <p key={message}>{message}</p>)}
      </Notice>
    </div>
  )
}
