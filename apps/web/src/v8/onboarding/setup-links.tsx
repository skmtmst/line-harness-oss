import type { AccountStyle } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'

export function setupLinksFor(style: AccountStyle) {
  if (style === 'ec') return [{ href: '/ec-commerce?tab=connector', label: 'ECのつなぎ先を設定する' }, { href: '/ec-commerce?tab=auto-line', label: '自動のLINEを設定・模擬確認する' }]
  if (style === 'consult') return [{ href: '/booking/menus', label: '面談の会い方・固定URLを設定する' }, { href: '/booking/menus?tab=staff', label: '担当のカレンダーを設定する' }]
  if (style === 'lesson') return [{ href: '/booking/menus?tab=passes', label: '回数券・月謝を設定する' }, { href: '/events', label: 'クラス・振替を設定する' }]
  if (style === 'salon') return [{ href: '/booking/menus?tab=passes', label: '回数券・月謝を設定する' }, { href: '/booking/menus?tab=staff', label: '担当を設定する' }]
  return []
}

export default function SetupLinks({ style }: { style: AccountStyle }) {
  return <>{setupLinksFor(style).map(link => <Notice key={link.href} tone="info" action={<Button href={link.href}>設定する</Button>}>{link.label}</Notice>)}</>
}
