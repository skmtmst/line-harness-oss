import { expect, it } from 'vitest'
import { oldestAttentionTarget } from './inbox-model'

const chat = (id: string, status: string, lastMessageAt: string | null) => ({ id, status, lastMessageAt }) as Parameters<typeof oldestAttentionTarget>[0][number]
const mail = (threadId: string, isUnread: boolean, lastMessageAt: string | null, lastIncomingAt: string) => ({ threadId, isUnread, lastMessageAt, lastIncomingAt })

it('未対応の中で最も古いLINE会話を選ぶ（新しい・対応済みは選ばない）', () => {
  const target = oldestAttentionTarget(
    [
      chat('new', 'unread', '2026-08-19T00:00:00.000Z'),
      chat('old', 'unread', '2026-08-11T00:00:00.000Z'),
      chat('done', 'resolved', '2026-08-01T00:00:00.000Z'),
    ],
    [],
  )
  expect(target).toEqual({ kind: 'chat', id: 'old' })
})

it('メールも混ぜて最も古い物を選ぶ（既読メールは選ばない）', () => {
  const target = oldestAttentionTarget(
    [chat('line', 'unread', '2026-08-19T00:00:00.000Z')],
    [
      mail('thread-old', true, null, '2026-08-10T00:00:00.000Z'),
      mail('thread-read', false, null, '2026-08-01T00:00:00.000Z'),
    ],
  )
  expect(target).toEqual({ kind: 'email', threadId: 'thread-old' })
})

it('時刻が無い・読めない物は選ばず、無ければ null', () => {
  expect(oldestAttentionTarget(
    [chat('no-time', 'unread', null), chat('bad-time', 'unread', 'not-a-date')],
    [mail('thread-bad', true, 'not-a-date', 'not-a-date')],
  )).toBeNull()
  expect(oldestAttentionTarget([], [])).toBeNull()
})
