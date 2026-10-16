'use client'
import type { AriaRole, CSSProperties, ReactNode } from 'react'
import { BatteryFull, Signal, Wifi, X, MoreHorizontal } from 'lucide-react'
import styles from './liff-phone-frame.module.css'
export default function LiffPhoneFrame({ children, title = 'ご予約', accountName = '然 - NEN -', caption, role, step, steps = ['メニュー', '担当', '日時', '確認'], footer, accent, label = 'お客さまの予約画面の見本' }: {
  children: ReactNode; role?: AriaRole; title?: string; accountName?: string; caption?: string; step?: number; steps?: string[]; footer?: ReactNode; accent?: string | null; label?: string
}) {
  return <section role={role} className={styles.root} aria-label={label} data-liff-phone-frame>
    {caption ? <p className={styles.caption}>{caption}</p> : null}
    <div className={styles.phone} data-line-preview-part="device-frame" style={accent ? { '--fe-phone-main': accent, '--v8-liff-primary': accent } as CSSProperties : undefined}>
      {/* 本物のスマホの形（LINE の見え方と同じ器：330×690・黒い縁・黒い島。Pen cfVyj・fZrjX）。 */}
      <div className={styles.screen}>
      <div className={styles.status}><span className={styles.time}>9:41</span><span className={styles.island} aria-hidden="true" /><span className={styles.statusIcons} aria-hidden="true"><Signal size={15} strokeWidth={1.8}/><Wifi size={15} strokeWidth={1.8}/><BatteryFull size={20} strokeWidth={1.8}/></span></div>
      <div className={styles.bar}><X size={14} aria-hidden="true"/><span className={styles.barTitle}><span className={styles.barMain}>{title}</span><span className={styles.barShop}>{accountName}</span></span><MoreHorizontal size={18} aria-hidden="true"/></div>
      {step !== undefined ? <div className={styles.steps} aria-label="予約の進み具合">{steps.map((name, i) => <span key={name} className={styles.step} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'idle'} aria-current={i + 1 === step ? 'step' : undefined}><span className={styles.stepLine}/><span className={styles.stepLabel}>{i + 1} {name}</span></span>)}</div> : null}
      <div className={styles.content}>{children}</div>
      {footer}
      <div className={styles.home} aria-hidden="true"><span/></div>
      </div>
    </div>
  </section>
}
