import type { ReactNode } from 'react'
import { PageFrame, PageHeading, type PageHeadingProps } from './page-frame'
import styles from './page-templates.module.css'
import dayStyles from './booking-day-layout.module.css'
import PreviewLauncher from './preview-launcher'
import TextLink from '@/components/shared/text-link'

/** ・：題と主操作の直下に数の帯を置く予約の型。 */
export function BookingPage({ children, stats, aside, ...heading }: PageHeadingProps & { children: ReactNode; stats?: ReactNode; aside?: ReactNode }) {
  if (aside) return <PageFrame kind="booking" boardId="acRIl">
    <div className={dayStyles.layout}>
      <div className={dayStyles.main}>
        <PageHeading {...heading} titleAccessory={<span className={dayStyles.launcher}><PreviewLauncher label="次の予約・内訳" title="次の予約・内訳">{aside}</PreviewLauncher></span>} />
        {stats ? <div data-template-region="stats">{stats}</div> : null}
        <div className={dayStyles.content} data-template-region="content">{children}</div>
      </div>
      <aside className={dayStyles.aside} aria-label="次の予約・内訳">{aside}</aside>
    </div>
  </PageFrame>
  return <PageFrame kind="booking" boardId="acRIl">
    <div className={styles.bookingHeading}><PageHeading {...heading} /></div>
    {children}
  </PageFrame>
}

export function BookingPageStats({ children }: { children: ReactNode }) {
  return <div className={styles.bookingStats} data-template-region="stats" data-blank-ok="数の帯を予定の列幅にそろえ、右の予約詳細欄の幅を残す">{children}</div>
}

export function BookingPageContent({ children }: { children: ReactNode }) {
  return <div className={styles.bookingContent} data-template-region="content">{children}</div>
}

/** 予約の補助欄の区画。画面は題と実データだけを渡す。 */
export function BookingSidebarSection({ title, action, children }: { title: ReactNode; action?: { href: string; label: string }; children: ReactNode }) {
  return <section className={dayStyles.sidebarSection}>
    {action ? <div className={dayStyles.sidebarHead}><h3>{title}</h3><TextLink href={action.href}>{action.label}</TextLink></div> : <h3>{title}</h3>}
    {children}
  </section>
}

/** 補助欄の「気をつけること」：印・題・補足の行。 */
export function BookingSidebarNotes({ items }: { items: { icon: ReactNode; title: ReactNode; detail?: ReactNode }[] }) {
  return <ul className={dayStyles.sidebarNotes}>{items.map((item, index) => <li key={index}><span className={dayStyles.sidebarNoteIcon}>{item.icon}</span><span><strong>{item.title}</strong>{item.detail ? <small>{item.detail}</small> : null}</span></li>)}</ul>
}

/** 補助欄の「つながる先」：行き先（→）と、そこで何をするかの1行。 */
export function BookingSidebarLinks({ links }: { links: { href: string; label: string; note: string }[] }) {
  return <ul className={dayStyles.sidebarLinks}>{links.map((link) => <li key={link.href}><TextLink href={link.href}>{link.label}</TextLink><span>{link.note}</span></li>)}</ul>
}
