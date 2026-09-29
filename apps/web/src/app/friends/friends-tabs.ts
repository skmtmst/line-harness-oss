import type { MergedTab } from '@/components/layout/merged-tabs'

/**
 * 友だち配下の主タブ（#984 LAY-14）。
 *
 * 友だち一覧・重複検出・統合ユーザー・UID移行を、同じ定義・同じ順・
 * 同じタブ部品（MergedTabs）・同じ選択色で出す。友だち側とUID移行側で
 * 別々のタブ実装を持っていた頃は、選択の色と項目が画面ごとにずれていた。
 *
 * UID移行だけ実体のURLが /accounts 配下にあるため href で飛ばす。
 * 左メニューの所属（UID移行では「友だち」を選ぶ）は
 * lib/menu.ts の SCREEN_MENU_OWNER が持つ。
 */
export const FRIENDS_MERGED_TABS: readonly MergedTab[] = [
  { key: 'list', label: '友だち一覧', href: '/friends' },
  { key: 'duplicates', label: '重複検出', href: '/friends?tab=duplicates' },
  { key: 'merged', label: '統合ユーザー', href: '/friends?tab=merged' },
  { key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' },
]
