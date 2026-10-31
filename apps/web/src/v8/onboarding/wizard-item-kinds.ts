import type { AccountStyle } from '@line-crm/shared';



export const KIND_WORD: Record<string, { label: string; icon: string; href: (style: AccountStyle) => string }> = {
  form: {label:'回答フォーム・ご案内',icon:'file',href:()=>'/forms'},
  rich_menu: { label: 'リッチメニュー', icon: 'grid', href: (style) => `/rich-menus/sample?style=${style}` },
  template: { label: 'テンプレート', icon: 'file', href: () => '/templates' },
  booking_menu: { label: '予約メニュー', icon: 'utensils', href: () => '/booking/menus' },
}
