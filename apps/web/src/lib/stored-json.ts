/** 保存済みの選択値を読む。壊れた値を「選択なし」に置き換えて保存しない。 */
export function storedStringList(value: string | null | undefined): string[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('保存された選択内容を読み取れませんでした。読み直してからお試しください。')
  }
  return parsed as string[]
}
