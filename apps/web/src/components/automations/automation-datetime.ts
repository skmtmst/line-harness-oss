/**
 * ISO日時を datetime-local 入力の文字（日本時間）へ直す。
 *
 * 保存は `+09:00` 固定で送るので、読みも日本時間に統一する。
 * 端末のタイムゾーンで読むと、海外設定の端末で開いて保存しただけで
 * 実行日時がずれる（R482）。`apps/web/src/app/automations/new/page.tsx`
 * の新規作成と同じ基準。
 */
export function isoToJstDatetimeLocal(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
