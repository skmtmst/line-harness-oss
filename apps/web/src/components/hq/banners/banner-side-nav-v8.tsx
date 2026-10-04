'use client'

import type { ReactNode } from 'react'
import './banner-side-nav-v8.css'

export type BannerSideNavItem = {
  key: string
  label: string
  /** 数がまだ分からないときは出さない。 */
  count?: number | null
  selected: boolean
  onSelect: () => void
}

/**
 * バナー生成の「見る」案内（板 B9ZAr・W5Wxr）。
 * 一覧・ライブラリの板の左に置く、hq バナー内だけの案内。共通部品ではない。
 */
export default function BannerSideNav({ items }: { items: BannerSideNavItem[] }) {
  return (
    <nav aria-label="見る" className="banner-side-nav">
      <p className="banner-side-nav__label">見る</p>
      <ul className="banner-side-nav__list">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              aria-current={item.selected ? 'true' : undefined}
              onClick={item.onSelect}
              className={item.selected ? 'banner-side-nav__item banner-side-nav__item--active' : 'banner-side-nav__item'}
            >
              <span className="banner-side-nav__name">{item.label}</span>
              {item.count !== null && item.count !== undefined ? (
                <span className="banner-side-nav__count">{item.count}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** 板の左列（操作＋見る）に置く中身。展示面が読み込めるまで操作だけ出す。 */
export type BannerChrome = {
  action: ReactNode
  nav: ReactNode
}
