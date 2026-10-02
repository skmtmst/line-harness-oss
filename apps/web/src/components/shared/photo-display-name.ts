export type PhotoPetNameOptions = {
  fallback?: string
  honorific?: boolean
  /** Worker が共通規則で組み立てた完成済みの呼び名。 */
  callName?: unknown
  /** 古い応答に callName が無い場合だけ使う。 */
  gender?: unknown
}

/** 写真審査で使うペット名の欠損時表示と敬称を、画面間で同じ規則にする。 */
export function photoPetDisplayName(
  value: unknown,
  { fallback = 'ペット', honorific = true, callName, gender }: PhotoPetNameOptions = {},
): string {
  const completedName = String(callName ?? '').trim()
  if (completedName) return completedName
  const name = String(value ?? '').trim() || fallback
  if (!honorific || /(?:ちゃん|くん|さん)$/.test(name)) return name
  return `${name}${gender === 'male' ? 'くん' : 'ちゃん'}`
}
