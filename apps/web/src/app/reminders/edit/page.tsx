'use client'

import ReminderPublishFlow, {
  type ReminderPublishStage,
} from '@/components/reminders/reminder-publish-flow'
import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Issue469ReminderStepEditor, Issue469ReminderTestStage } from './issue469-reminder-screens'

/**
 * リマインダの編集。
 *
 * 作れるのに直せない状態だった。名前を打ち間違えても、送る時刻を変えたくなっても、
 * 作り直すしかなかった。
 *
 * **配信方式（○日前の●時／残り時間）はここで変えられない。** 途中で変えると、
 * すでに登録済みの人の配信予定がすべて変わる。「3日前」で予約が入っている人が、
 * 突然「4320分前」の解釈に切り替わる。作るときに決めたものを守る。
 */

/**
 * 公開までの段（設計 7-1-C〜G）。`?stage=` が付いていたらそちらへ渡す。
 *
 * **同じ `/reminders/edit` のまま段を切り替える。** 別のルートにすると、
 * 直しに戻るたびに URL が変わり、どこまで進んだのか分からなくなる。
 */
const PUBLISH_STAGES = new Set<ReminderPublishStage>(['target', 'preview', 'test', 'confirm', 'done'])

/*
 * U097: 「指定されていません」と言うだけでは戻れない。一覧へ戻る
 * 操作を文のそばに置く。
 */
function MissingReminder() {
  return (
    <div className="p-6">
      <p className="text-danger text-sm">編集するリマインダが指定されていません。</p>
      <p className="text-ink-secondary mt-1 text-sm">一覧から編集するリマインダを選び直してください。</p>
      <Link href="/reminders" className="text-action mt-3 inline-block text-sm font-semibold hover:underline">
        リマインダ一覧へ戻る
      </Link>
    </div>
  )
}

function ReminderEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const rawStage = params.get('stage')
  if (rawStage === 'test' && id) {
    return <Issue469ReminderTestStage reminderId={id} />
  }
  if (rawStage && PUBLISH_STAGES.has(rawStage as ReminderPublishStage)) {
    if (!id) {
      return <MissingReminder />
    }
    return <ReminderPublishFlow reminderId={id} stage={rawStage as ReminderPublishStage} />
  }
  if (!id) {
    return <MissingReminder />
  }
  return <Issue469ReminderStepEditor reminderId={id} />
}

export default function ReminderEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<p className="text-ink-faint p-6 text-sm">読み込み中...</p>}>
      <ReminderEditInner />
    </Suspense>
  )
}
