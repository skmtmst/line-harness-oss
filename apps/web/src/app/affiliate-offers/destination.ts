/**
 * 旧「案件・承認」ページ（`/affiliate-offers`）の正規の行き先。
 *
 * Issue #708（隠れ動線）: 以前は `/affiliates?tab=offers` を経由する
 * 二段飛ばしだった。正規ルート（`/conversions?tab=offers`）へ直接送る。
 * page.tsx と試験の両方がここを読む（page.tsx から直接 export すると
 * Next のページ型検査に触れるため、別置きにする）。
 */
export const AFFILIATE_OFFERS_DESTINATION = '/conversions?tab=offers'
