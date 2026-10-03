'use client'

/*
 * ★V8-B イベント予約の「イベントを作る」（板 `d4adD4`）。
 *
 * 入力そのものは今の作り（`EventWizard` の3段階：概要・予約枠・公開設定）
 * をそのまま使う。V8 の枠（戻る口・題・説明・板ID）だけを足す。
 * v7 を直す必要が出たら new/page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */

import Link from 'next/link'
import EventWizard from '@/components/events/event-wizard'
import { usePageTitle } from '@/components/shell/page-chrome'
import styles from './events-new-v8.module.css'

export default function EventsNewV8({
  accountId,
  eventId,
  step,
}: {
  accountId: string | null
  eventId: string | null
  step: 1 | 2 | 3
}) {
  usePageTitle('イベントを作る')
  return (
    <div className={styles.board} data-design-node="d4adD4">
      <div>
        <Link href="/events" className={styles.backLink}>
          ← イベント予約へ
        </Link>
        <h2 className={styles.headTitle}>イベントを作る</h2>
        <p className={styles.headDescription}>
          中身・日程と定員・申し込みのきまりを決めます。下書きのあいだは、お客さまには見えません。
        </p>
      </div>
      {!accountId ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          サイドバーでアカウントを選択してください
        </div>
      ) : (
        <EventWizard accountId={accountId} eventId={eventId} step={step} />
      )}
    </div>
  )
}
