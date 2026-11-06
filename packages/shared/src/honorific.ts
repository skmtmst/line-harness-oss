/**
 * お客さまの名前に敬称を付ける共通の 1 か所。
 *
 * 名前の側にすでに「さん・様・さま」が入っていることがある（LINE の表示名や
 * 電話受付の手入力）。末尾にあれば重ねない（「マロン さん さん」を出さない）。
 */
export type Honorific = 'さん' | '様' | 'さま'

const ENDS_WITH_HONORIFIC = /(?:さん|様|さま)$/

export function withHonorific(name: string, honorific: Honorific = 'さん', { space = false }: { space?: boolean } = {}): string {
  const trimmed = name.trim()
  if (!trimmed || ENDS_WITH_HONORIFIC.test(trimmed)) return trimmed
  return `${trimmed}${space ? ' ' : ''}${honorific}`
}
