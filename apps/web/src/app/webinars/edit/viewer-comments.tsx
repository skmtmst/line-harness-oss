'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import { ApiError, webinarApi, type WebinarUserComment } from '@/lib/api'
import { fmtSec, ParticipantAvatar } from './participants-shared'

/** 分析の補助欄。コメントの取得失敗で分析や参加者を消さない。 */
export default function ViewerComments({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarUserComment[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setComments(null); setError('')
    void webinarApi.userComments(webinarId).then((response) => {
      if (!Array.isArray(response.data)) throw new Error('invalid_comments')
      if (active) setComments(response.data)
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError && cause.status === 403
        ? '視聴者コメントを確認する権限がありません。管理者に確認してください。'
        : '視聴者コメントを読み込めませんでした。')
    })
    return () => { active = false }
  }, [webinarId, attempt])

  return <Disclosure size="compact" title={<span className="inline-flex items-center gap-1">視聴者コメント<HelpTip label="視聴者コメントの説明">実際の視聴者が送ったコメントです。時刻は動画の開始からの経過時間で、開始前はマイナスで表示します。名前を押すとその友だちとのチャットを開きます。</HelpTip></span>} hint={comments ? `${comments.length}件` : '—'}>
    {error ? <div role="alert" className="text-ink-secondary text-xs">{error}<Button size="compact" className="ml-2" onClick={() => setAttempt((count) => count + 1)}>もう一度読み込む</Button></div>
      : comments === null ? <p role="status" className="text-ink-faint text-xs">コメントを読み込んでいます…</p>
        : comments.length === 0 ? <p className="text-ink-faint text-xs">まだコメントはありません。</p>
          : <ul className="divide-hairline divide-y">
            {comments.map((comment) => {
              const name = comment.friendName ?? `友だち ${comment.friendId.slice(0, 6)}`
              return <li key={comment.id} className="py-3">
                <Link href={`/chats?friend=${encodeURIComponent(comment.friendId)}`} className="flex min-w-0 items-center gap-2 text-xs">
                  <ParticipantAvatar name={name} pictureUrl={comment.pictureUrl} size="sm" />
                  <span className="text-ink min-w-0 flex-1 truncate font-semibold" title={name}>{name}</span>
                  <span className="text-ink-faint shrink-0 whitespace-nowrap">{fmtSec(comment.atSeconds)}</span>
                </Link>
                <p className="text-ink-secondary mt-2 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
              </li>
            })}
          </ul>}
  </Disclosure>
}
