'use client'

import Link from 'next/link'
import { Building2, Headset, ReceiptText, Users } from 'lucide-react'
import './hq-settings-nav-v8.css'

export type HqSettingsNavKey = 'members' | 'info' | 'billing' | 'contact'

const ITEMS: { key: HqSettingsNavKey; label: string; href: string; Icon: typeof Users }[] = [
  { key: 'members', label: 'メンバー', href: '/hq/members', Icon: Users },
  { key: 'info', label: '統括の情報', href: '/hq/settings', Icon: Building2 },
  { key: 'billing', label: '請求', href: '/hq/billing', Icon: ReceiptText },
  { key: 'contact', label: 'お問い合わせ', href: '/hq/support', Icon: Headset },
]

/**
 * 統括の設定の中のメニュー（板 JB8V1・yLKwV・BHEl9）。
 * メンバー・請求の板の左に置く、hq 内だけの案内。共通部品ではない。
 */
export default function HqSettingsNav({ active }: { active: HqSettingsNavKey }) {
  return (
    <nav aria-label="統括の設定" className="hq-settings-nav">
      <p className="hq-settings-nav__label">統括の設定</p>
      <ul className="hq-settings-nav__list">
        {ITEMS.map(({ key, label, href, Icon }) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={key === active ? 'page' : undefined}
              className={key === active ? 'hq-settings-nav__item hq-settings-nav__item--active' : 'hq-settings-nav__item'}
            >
              <Icon aria-hidden="true" className="hq-settings-nav__icon" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
