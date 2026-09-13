'use client'

import ReminderPublishFlow, {
  type ReminderPublishStage,
} from '@/components/reminders/reminder-publish-flow'
import { Suspense } from 'react'
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

function ReminderEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const rawStage = params.get('stage')
  if (rawStage === 'test' && id) {
    return <Issue469ReminderTestStage reminderId={id} />
  }
  if (rawStage && PUBLISH_STAGES.has(rawStage as ReminderPublishStage)) {
    if (!id) {
      return <p className="text-danger p-6 text-sm">リマインダが指定されていません。</p>
    }
    return <ReminderPublishFlow reminderId={id} stage={rawStage as ReminderPublishStage} />
  }
  if (!id) {
    return <p className="text-danger p-6 text-sm">リマインダが指定されていません。</p>
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
