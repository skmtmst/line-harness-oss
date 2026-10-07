import type { HqTemplate } from '@/lib/hq-templates-api'

/**
 * 統括のひな形一覧（絵 LRc93）の行に出す小さい字。
 * 名前の下は内容の要約（例「本文・画像 1」）。要約が無い古い返事・読めない内容は今までどおり説明か種類名。
 */
export function templateSubLine(row: Pick<HqTemplate, 'content_summary' | 'description'>, typeLabel: string): string {
  return row.content_summary || row.description || typeLabel
}

/**
 * 配布先の列の2行目（例「本店・渋谷店・イベント」）。名前が4件以上なら残りを「ほか N」で足す。
 * 配っていない・名前が届かない古い返事のときは出さない（null）。
 */
export function distributedAccountsLine(row: Pick<HqTemplate, 'distributed_account_names' | 'distributed_account_more'>): string | null {
  const names = row.distributed_account_names ?? []
  if (names.length === 0) return null
  const more = row.distributed_account_more ?? 0
  return more > 0 ? `${names.join('・')} ほか ${more}` : names.join('・')
}
