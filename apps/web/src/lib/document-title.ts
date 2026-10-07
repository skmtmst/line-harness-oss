/**
 * ブラウザのタブの題（リリース前点検 2026-10-07・オーナー依頼）。
 *
 * タブを並べても見分けられるよう「<画面名> | musubo」にする。画面名は上の帯
 * （左メニューの画面名・usePageTitle で渡した名前）と同じ言葉。分からないときは
 * 「musubo」だけ。画面に LINE Harness は出さない（サービス名は musubo）。
 */
export const PRODUCT_NAME = 'musubo'

export function formatDocumentTitle(screenName?: string | null): string {
  const name = screenName?.trim()
  return name ? `${name} | ${PRODUCT_NAME}` : PRODUCT_NAME
}

/** 描いたあとに題を合わせる（書き出しの時点の題は layout.tsx の既定）。 */
export function setDocumentTitle(screenName?: string | null): void {
  if (typeof document === 'undefined') return
  const next = formatDocumentTitle(screenName)
  if (document.title !== next) document.title = next
}
