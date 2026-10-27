import type { Webinar, WebinarEditor } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** 保存済みの値だけを要約し、未取得を完了した設定へ見せかけない。 */
export function webinarStepSummaries(webinar: Webinar, editor: WebinarEditor, ctaCount: number) {
  return {
    basic: webinar.title,
    video: `${webinar.videoPrefix || webinar.videoMediaId ? '動画あり' : '動画未設定'}・配信枠 ${formatNumber(webinar.schedule.length)}件`,
    cta: `案内ボタン ${formatNumber(ctaCount)}件・${editor.publicPage.form?.name ?? '申込フォーム未設定'}`,
    notifications: `通知文 ${Object.values(editor.notificationMessages).filter(value => value.trim()).length}種類`,
  }
}
