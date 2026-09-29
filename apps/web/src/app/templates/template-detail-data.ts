import type { api } from '@/lib/api'

/** 詳細口（GET /api/templates/:id）が返す1件分の形。 */
export type TemplateDetailData = Extract<
  Awaited<ReturnType<typeof api.templates.get>>,
  { success: true }
>['data']

/*
 * D007/D008: 詳細口の応答の形。**success:true でも本文が無い応答がある。**
 *
 * 存在しないIDへ一覧形 `{items:[]}` が返るなど、型どおりでない応答を
 * 確かめずに使うと、編集は見本づくりで落ち、詳細は無いものを「ある」
 * ように見せて編集・削除の口まで出す。名前・種類・本文の3つが文字列の
 * ときだけ、中身として受け取る。利用先は無くてもよい（未取得は null
 * として扱う）が、有るときは利用先の数え上げで使う表が配列でないと
 * 落ちるので、表でなければ捨てる。
 */
export function isTemplateDetailData(data: unknown): data is TemplateDetailData {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (
    typeof record.name !== 'string' ||
    typeof record.messageType !== 'string' ||
    typeof record.messageContent !== 'string'
  ) {
    return false
  }
  const usedBy = record.usedBy
  if (usedBy === undefined || usedBy === null) return true
  if (typeof usedBy !== 'object') return false
  const lists = usedBy as Record<string, unknown>
  // 昔の応答に無いことがある表は、来ているときだけ見る。
  for (const key of ['broadcasts', 'reminderEnrollments'] as const) {
    const value = lists[key]
    if (value !== undefined && !Array.isArray(value)) return false
  }
  for (
    const key of [
      'autoReplies',
      'automations',
      'scenarioSteps',
      'reminderSteps',
      'richMenuAreas',
      'trackedLinks',
    ] as const
  ) {
    if (!Array.isArray(lists[key])) return false
  }
  return true
}
