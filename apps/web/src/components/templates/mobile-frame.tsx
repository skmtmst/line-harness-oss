'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import SearchField from '@/components/shared/search-field'
import SegmentedControl from '@/components/shared/segmented'
import styles from './mobile-frame.module.css'

/*
 * 電話の専用の画面（/m）の外枠の型。上の帯・本文・下のタブを持つ。
 *
 * - 余白・高さ・文字の段・押せる大きさはこの型が持つ（画面で数字を書かない）。
 * - 戻るは上の帯の左の＜だけ（ページの中に「← 〇〇へ」を置かない決まりは PC と同じ）。
 * - 下のタブは作った画面だけを渡す。選んでいるタブは色だけでなく aria-current で伝える。
 * - 入力欄の文字は 16px（iPhone が入力時に画面を拡大しないため）。電話の外枠の中だけの値。
 */

export type MobileFrameTab = {
  href: string
  label: string
  icon: ReactNode
  current: boolean
  /** 数を知らせる丸。0・未取得は出さない。 */
  badge?: number | null
}

export type MobileFrameBack = { href: string; label: string }

export function MobileFrame({
  title,
  back,
  headerEnd,
  banner,
  band,
  tabs,
  hideTabs = false,
  footer,
  children,
}: {
  /** 画面の名前。1 行で、入らないときは「…」と全文の title。 */
  title: string
  /** 2 段目の画面だけ。1 段目（タブの画面）では渡さない。 */
  back?: MobileFrameBack | null
  /** 上の帯の右（アカウントの切り替えなど）。 */
  headerEnd?: ReactNode
  /** 上の帯のさらに上に固定する帯（代理ログイン・セッション切れなど）。 */
  banner?: ReactNode
  /** 上の帯のすぐ下の 1 行（閲覧のみの帯など）。 */
  band?: ReactNode
  tabs: MobileFrameTab[]
  /** 返信を書く画面など、下のタブを隠すとき。 */
  hideTabs?: boolean
  /** 下のタブの代わりに画面の下に固定するもの（返信欄）。 */
  footer?: ReactNode
  children: ReactNode
}) {
  const showTabs = !hideTabs && tabs.length > 0
  return (
    <div className={styles.frame} data-phone-frame="" data-phone-tabs={showTabs ? '' : undefined} data-phone-footer={footer ? '' : undefined}>
      <header className={styles.bar}>
        {banner}
        <div className={styles.barRow}>
          {back ? (
            <Link href={back.href} className={styles.back} aria-label={`${back.label}へ戻る`} data-phone-back="">
              <ChevronLeft aria-hidden="true" className={styles.backIcon} />
            </Link>
          ) : (
            <span className={styles.brand} aria-hidden="true">musubo</span>
          )}
          <h1 className={styles.title} title={title}>{title}</h1>
          {headerEnd ? <div className={styles.headerEnd}>{headerEnd}</div> : null}
        </div>
        {band ? <div className={styles.band}>{band}</div> : null}
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      {footer ? <div className={styles.footer} data-phone-footer-part="">{footer}</div> : null}
      {showTabs ? (
        <nav className={styles.tabs} aria-label="電話のメニュー">
          {tabs.map((tab) => (
            <Link key={tab.href} href={tab.href} className={styles.tab} aria-current={tab.current ? 'page' : undefined} data-phone-tab="">
              <span className={styles.tabIcon} aria-hidden="true">
                {tab.icon}
                {tab.badge ? <span className={styles.tabBadge}>{tab.badge > 99 ? '99+' : tab.badge}</span> : null}
              </span>
              <span className={styles.tabLabel}>{tab.label}</span>
              {tab.badge ? <span className="sr-only">{`${tab.badge}件`}</span> : null}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

/** 1 段目の画面の中の段（題と中身）。段の題は 15/700。 */
export function MobileSection({ title, count, action, children }: { title: string; count?: number | null; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle} title={title}>{title}</h2>
        {typeof count === 'number' ? <span className={styles.sectionCount} data-count="">{`${count} 件`}</span> : null}
        {action ? <span className={styles.sectionAction}>{action}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** 電話の画面のカード 1 列。押すと開くカードは MobileCardLink、押せない物は MobileCard。 */
export function MobileCardList({ label, children }: { label: string; children: ReactNode }) {
  return <ul className={styles.cards} aria-label={label}>{children}</ul>
}

export function MobileCardLink({ href, onClick, children, label }: { href: string; onClick?: () => void; children: ReactNode; label?: string }) {
  return (
    <li className={styles.cardItem}>
      <Link href={href} onClick={onClick} className={styles.card} data-pressable-card="" aria-label={label}>{children}</Link>
    </li>
  )
}

export function MobileCard({ children }: { children: ReactNode }) {
  return <li className={styles.cardItem}><div className={styles.card}>{children}</div></li>
}

/**
 * 1 段目の一覧の上の道具（名前で探す欄と、表示の切り替え）。電話の画面では縦に積み、どちらも指で押せる大きさ。
 * 探す・切り替えの値と動きは画面が持つ。
 */
export function MobileListTools<T extends string>({ searchLabel, searchPlaceholder, query, onQuery, choiceLabel, choice, choices, onChoice }: {
  searchLabel: string
  searchPlaceholder: string
  query: string
  onQuery: (value: string) => void
  choiceLabel: string
  choice: T
  choices: { value: T; label: string }[]
  onChoice: (value: T) => void
}) {
  return (
    <div className={styles.tools}>
      <SearchField aria-label={searchLabel} placeholder={searchPlaceholder} value={query} onChange={onQuery} onClear={() => onQuery('')} />
      <SegmentedControl<T> aria-label={choiceLabel} equalWidth value={choice} onChange={onChoice} options={choices} />
    </div>
  )
}
