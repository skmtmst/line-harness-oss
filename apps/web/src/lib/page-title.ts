import { canonicalScreenPath } from './canonical-route'
import { HQ_MENU_SECTIONS, MENU_SECTIONS } from './menu'

/** ルート → メニューのラベル。長いほうから当てるので、`/tags/new` は「タグ」になる。 */
const MENU_LABELS: Array<[string, string]> = MENU_SECTIONS
  .flatMap((section) => section.items.map((item): [string, string] => [item.href, item.label]))
  .sort((a, b) => b[0].length - a[0].length)

/** ルートから既定の画面名を引く。当たらなければ空。 */
export function defaultTitleForPath(pathname: string): string {
  const path = canonicalScreenPath(pathname)
  for (const [href, label] of MENU_LABELS) {
    const route = href.split('?')[0]
    if (path === route) return label
    if (route !== '/' && path.startsWith(`${route}/`)) return label
  }
  return ''
}

/**
 * タブの題だけに使う画面名（上の帯の文字は変えない）。統括のメニューと、
 * 左メニューに無い画面。上の帯の名前が無いときだけ使う。
 */
const DOCUMENT_ONLY_LABELS = [
  ['/conversions', 'コンバージョン'],
  ['/ops/dashboard', 'ダッシュボード（運営）'],
  ['/ops/applications', '申込アカウント（運営）'],
  ['/ops/tenants', '契約先アカウント（運営）'],
  ['/ops/support', 'お問い合わせ（運営）'],
  ['/ops/announcements', 'お知らせ（運営）'],
  ['/ops/knowledge', 'ナレッジ（運営）'],
  ['/ops/audit', '監査ログ（運営）'],
  ['/ops/members', 'メンバー管理（運営）'],
  ['/ops/invite', 'メンバーの招待（運営）'],
  ['/ops', '運営コンソール'],
  ...HQ_MENU_SECTIONS.flatMap((section) => section.items.map((item): [string, string] => [item.href, `${item.label}（統括）`])),
  ['/hq/support', 'お問い合わせ'] as [string, string],
  ['/common-actions', '共通アクション'] as [string, string],
  ['/scoring', 'スコアリング'] as [string, string],
  ['/updates', 'アップデート履歴'] as [string, string],
  ['/notifications', '通知'] as [string, string],
] satisfies Array<[string, string]>
DOCUMENT_ONLY_LABELS.sort((a, b) => b[0].length - a[0].length)

/** タブの題に使う画面名。上の帯の名前を先に、無ければ上の表から引く。 */
export function documentTitleForPath(pathname: string, shownTitle: string): string {
  if (shownTitle) return shownTitle
  const path = canonicalScreenPath(pathname)
  for (const [href, label] of DOCUMENT_ONLY_LABELS) {
    if (path === href || path.startsWith(`${href}/`)) return label
  }
  return ''
}
