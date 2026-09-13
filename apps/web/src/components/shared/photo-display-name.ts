export type PhotoPetNameOptions = {
  fallback?: string
  honorific?: boolean
}

/** 写真審査で使うペット名の欠損時表示と敬称を、画面間で同じ規則にする。 */
export function photoPetDisplayName(
  value: unknown,
  { fallback = 'ペット', honorific = true }: PhotoPetNameOptions = {},
): string {
  const name = String(value ?? '').trim() || fallback
  if (!honorific || /(?:ちゃん|くん|さん)$/.test(name)) return name
  return `${name}ちゃん`
}
