import type { FriendField } from '@line-crm/shared'

/** 保存のために送った内容（画面の入力を送信用に整えた形）。 */
export interface SentFieldContent {
  name: string
  folderId: string | null
  options: string[] | null
  defaultValue: string | string[] | null
  isPersonal: boolean
  isStarred: boolean
  ecIsMaster: boolean
  ecFieldPath: string | null
}

/**
 * R517: 送った内容と最新の保存内容が同じか。
 *
 * 同じなら、応答を失った1回目の保存が成功している（再試行の409は
 * 自分の保存との衝突）。違うなら、ほかの担当者が変えている。
 * 選択式の既定値は送るときは選択肢名、保存されるときは選択肢IDなので、
 * 最新の対応表でIDへ戻してから比べる。比べられない形のときは
 * 「違う」に倒す（保存済みと言い切らない）。
 */
export function isSameFieldContent(sent: SentFieldContent, latest: FriendField): boolean {
  if (sent.name !== latest.name) return false
  if ((sent.folderId ?? null) !== (latest.folderId ?? null)) return false
  if (JSON.stringify(sent.options ?? null) !== JSON.stringify(latest.options ?? null)) return false
  if (sent.isPersonal !== latest.isPersonal) return false
  if (sent.isStarred !== latest.isStarred) return false
  if (sent.ecIsMaster !== latest.ecIsMaster) return false
  if ((sent.ecFieldPath ?? null) !== (latest.ecFieldPath ?? null)) return false
  return normalizeSentDefault(sent, latest) === (latest.defaultValue ?? null)
}

function normalizeSentDefault(sent: SentFieldContent, latest: FriendField): string | null {
  const raw = sent.defaultValue
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null
    const definitions = latest.optionDefinitions ?? null
    const ids = raw.map((label) => definitions?.find((item) => item.label === label)?.id ?? label)
    return JSON.stringify(ids)
  }
  if (!raw) return null
  if (latest.type === 'select') {
    return latest.optionDefinitions?.find((item) => item.label === raw)?.id ?? raw
  }
  return raw
}
