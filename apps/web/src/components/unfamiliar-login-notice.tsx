'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminSessionHeaders } from '@/lib/admin-session'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import NoteBar from '@/components/shared/note-bar'

/**
 * V-2: いつもと違う端末・場所からのログイン帯（v6-30 §14）。
 *
 * /api/auth/session が unfamiliarAt を返すときだけ描く。帯は AuthGuard の
 * 内側に載るので、答えは AuthGuard が取ったものを読む（readSessionSnapshot）。
 * 手元に無いときだけ自分で取りに行く。
 *
 * この帯が出ているあいだ、そのセッションの大事な操作は毎回の本人確認が要る
 * （Worker側で強制）。心当たりがない人の逃げ道として、セッション管理への
 * リンク（他の端末のログイン解除）を右に置く。
 */
export default function UnfamiliarLoginNotice() {
  const [unfamiliarAt, setUnfamiliarAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const known = readSessionSnapshot()
    const fetchWhenMissing = () =>
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session`, {
        credentials: 'include',
        headers: adminSessionHeaders(),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { data?: { unfamiliarAt?: string | null } } | null) => body?.data?.unfamiliarAt ?? null)
    const resolved = known ? Promise.resolve(known.unfamiliarAt) : fetchWhenMissing()
    resolved
      .then((value) => { if (!cancelled) setUnfamiliarAt(value) })
      .catch(() => { if (!cancelled) setUnfamiliarAt(null) })
    return () => { cancelled = true }
  }, [])

  if (!unfamiliarAt) return null
  return (
    <NoteBar
      tone="warn"
      action={
        <Link href="/staff" className="text-action whitespace-nowrap text-xs font-bold underline underline-offset-2">
          ログイン中の端末を確認する
        </Link>
      }
    >
      いつもと違う端末・場所からのログインです。このログイン中は大事な操作の前に毎回の本人確認を求めます。心当たりがなければ、他の端末のログインを終了してパスワードを変更してください。
    </NoteBar>
  )
}
