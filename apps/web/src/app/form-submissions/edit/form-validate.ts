export { validateFormLayoutForSave as validateLayoutForSave } from '@/components/forms/form-definition-validation'

/*
 * カードの画像URL（FORM-18）。
 *
 * 欄の注記は「https で始まるURLだけ使えます」と約束しているのに、
 * `http://…` がそのまま保存できて残っていた。テーマの背景画像と同じ
 * 決めごとにそろえる（packages/shared の normalizeFormTheme も https のみ）。
 */
const HTTPS_URL_PATTERN = /^https:\/\//i

export const OG_IMAGE_URL_ERROR = 'カードの画像URLは https:// で始まるURLを入れてください'

/**
 * 空なら問題なし（カード画像を使わない）。
 * 入力があるのに https:// で始まらないときだけ、直し方の理由を返す。
 */
export function ogImageUrlError(url: string | null | undefined): string {
  const trimmed = (url ?? '').trim()
  if (!trimmed) return ''
  return HTTPS_URL_PATTERN.test(trimmed) ? '' : OG_IMAGE_URL_ERROR
}
