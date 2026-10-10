/** 作る前の検査（今の作る画面と同じ）。問題なければ null。 */
export function tagNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'タグ名を入力してください'
  if (trimmed.length > 80) return 'タグ名は80文字までで入力してください'
  if ([...trimmed].some((ch) => { const code = ch.charCodeAt(0); return code < 32 || code === 127 })) return 'タグ名に使えない文字が含まれています'
  return null
}
