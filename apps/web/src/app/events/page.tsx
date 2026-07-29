import { redirect } from 'next/navigation'

/**
 * 美容サロン運用ではイベント側の概要・予約枠を使わず、
 * スタッフシフトを唯一の予約可能時間として扱う。
 * 旧ブックマークから開いても新しい予約管理設定へ集約する。
 */
export default function EventsListPage() {
  redirect('/booking/settings')
}
