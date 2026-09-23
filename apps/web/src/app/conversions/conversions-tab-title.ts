/*
 * タブごとの画面名（Issue #637、監査 D-3「h1とルート名の不一致」）。
 *
 * /conversions の1ページに「成果とアフィリエイト」（V6-16）と
 * 「コンバージョン」（V6-19）の2機能が同居する。サイドバーは2項目に
 * 分かれていて、「成果とアフィリエイト」は `?tab=affiliates`
 * （旧 /affiliates の移転先）、「コンバージョン」は素の `/conversions`
 * （既定は成果地点タブ）を指す。トップバーの題はパスだけでは引けない
 * ため、開いているタブの側の名前を `usePageTitle` で渡す。
 *
 * タブの所属は V6実Node の対応どおり：
 * 成果とアフィリエイト … PouPn（紹介者）・GH8VL（案件）・n5VVTb（成果承認）・njLGA（支払い）
 * コンバージョン ……… ZrpKn（成果地点）・GUxsj（レポート）
 */
export const CONVERSIONS_TAB_TITLES: Record<string, string> = {
  affiliates: '成果とアフィリエイト',
  offers: '成果とアフィリエイト',
  approvals: '成果とアフィリエイト',
  payment: '成果とアフィリエイト',
  points: 'コンバージョン',
  report: 'コンバージョン',
}

/** タブから画面名を引く。知らない値は「コンバージョン」に畳む。 */
export function conversionsTabTitle(tab: string): string {
  return CONVERSIONS_TAB_TITLES[tab] ?? 'コンバージョン'
}
