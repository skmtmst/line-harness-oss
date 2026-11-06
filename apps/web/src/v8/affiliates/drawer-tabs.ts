export type DrawerTab = 'summary' | 'breakdown' | 'friends' | 'payment'

export const DRAWER_TABS: Array<{ key: DrawerTab; label: string }> = [
  { key: 'summary', label: '概要' },
  { key: 'breakdown', label: '内訳' },
  { key: 'friends', label: '友だち' },
  { key: 'payment', label: '支払い' },
]
