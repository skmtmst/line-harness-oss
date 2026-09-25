'use client'

import { LifeBuoy } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useBrand } from '@/lib/use-brand'
import styles from './sidebar.module.css'
import identityStyles from './sidebar-identity.module.css'

/** V6 `IwfA0`。停止中はお問い合わせ以外の導線を出さない。 */
export default function SuspendedSidebar() {
  const [name, setName] = useState('—')
  const brand = useBrand()
  const brandName = brand.name || '管理画面'
  const brandInitial = 'm'

  useEffect(() => {
    try { setName(localStorage.getItem('lh_staff_name') || '—') } catch { /* storage なし */ }
  }, [])

  return (
    <>
      <div className={`${styles.mobileHeader} ${styles.mobileOnly}`}>
        <h1 className={styles.mobileTitle}>お問い合わせ</h1>
        <span className="inline-flex h-7 items-center rounded-pill bg-status-danger-soft px-2 text-nano font-bold text-status-danger">利用停止中</span>
      </div>
      <aside className={styles.desktop} aria-label="停止中の管理メニュー">
        <div className={identityStyles.root} data-design-node="J33xq/V2WbXF">
          <span className={identityStyles.mark} aria-hidden="true">{brandInitial}</span>
          <span className={identityStyles.text}>
            <span className={identityStyles.name} title={brandName}>{brandName}</span>
            <span className={identityStyles.version}>musubo 統括コンソール</span>
          </span>
        </div>
        <div className={styles.identityRule} />
        <nav className={styles.nav}>
          <div className={styles.section}>
            <div className={styles.sectionHeading}>統括</div>
            <Link href="/hq/support" className={`${styles.item} ${styles.active}`} aria-current="page">
              <LifeBuoy aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              <span>お問い合わせ</span>
            </Link>
          </div>
        </nav>
        <div className="flex min-h-[76px] items-center gap-3 border-t border-hairline px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink text-label font-bold text-on-accent" aria-hidden="true">
            {name.trim().slice(0, 1).toUpperCase() || '—'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-label font-bold text-ink">{name}</span>
            <span className="inline-flex h-4.5 w-fit items-center rounded-pill bg-status-danger-soft px-2 text-nano font-bold text-status-danger">利用停止中</span>
          </span>
        </div>
      </aside>
    </>
  )
}
