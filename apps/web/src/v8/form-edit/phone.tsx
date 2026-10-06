'use client'

/*
 * 「お客さまに見える形」のスマホ（m1cWEy・ijxur・XXFT4・tpRRT の右）。
 * 外枠 330×690・黒い島・LINE の上の帯・メニューの帯。中は回答画面の形。
 * 選んでいるページを出す。押せない見本（role="img" ではなく読める文で出す）。
 * 予約を入れる欄の日にち・時刻は形を見せるための見本で、実際の空きではない。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BatteryFull, ChevronDown, ChevronLeft, Menu, Phone, Search, Signal, Star, Wifi } from 'lucide-react'
import { FORM_OPTIONS_DEFAULT, type FormBlock, type FormInputBlock, type FormLayout } from '@line-crm/shared'
import styles from './edit.module.css'

const WEEKDAY = '日月火水木金土'
const SAMPLE_TIMES = ['10:00', '11:00', '13:00', '14:00', '15:00', '16:00']

type Props = {
  layout: FormLayout
  pageIndex: number
  accountName: string
  bookingMenus: { id: string; name: string; durationMinutes: number }[]
}

export function FormPhone({ layout, pageIndex, accountName, bookingMenus }: Props) {
  const sections = layout.sections
  const section = sections[pageIndex] ?? sections[0]
  const options = { ...FORM_OPTIONS_DEFAULT, ...layout.options }
  const blocks = [...(pageIndex === 0 ? layout.header : []), ...(section?.blocks ?? [])]
  const last = pageIndex >= sections.length - 1
  const progress = (
    <span className={styles.phoneProgress} aria-hidden="true">
      {sections.map((s, i) => <span key={s.id} data-done={i <= pageIndex || undefined} />)}
    </span>
  )
  // 1ページ目は表紙（画像・題・説明）のあとに進み具合、ほかのページは頭に出す。
  const firstInput = blocks.findIndex((b) => b.kind === 'input')
  const progressAt = pageIndex === 0 && firstInput > 0 ? firstInput : 0
  // 色を決めたフォームは、その主の色で見せる（決めていなければ LINE の緑）。
  const phoneRef = useRef<HTMLDivElement>(null)
  const main = layout.options.theme?.main ?? null
  useEffect(() => {
    const el = phoneRef.current
    if (!el) return
    if (main) el.style.setProperty('--fe-phone-main', main)
    else el.style.removeProperty('--fe-phone-main')
  }, [main])
  const nextLabel = last
    ? (options.submitLabel || '送信する')
    : `${options.nextLabel || '次へ'}（${pageIndex + 1} / ${sections.length}）`

  return (
    <section className={styles.phoneWrap} aria-label="お客さまに見える形">
      <p className={styles.phoneTitle}>お客さまに見える形</p>
      <div className={styles.phone} ref={phoneRef}>
        <div className={styles.phoneScreen}>
          <div className={styles.phoneStatus}>
            <span className={styles.phoneClock}>9:41</span>
            <span className={styles.phoneIsland} aria-hidden="true" />
            <span className={styles.phoneIcons} aria-hidden="true">
              <Signal size={15} strokeWidth={1.8} />
              <Wifi size={15} strokeWidth={1.8} />
              <BatteryFull size={20} strokeWidth={1.8} />
            </span>
          </div>
          <div className={styles.phoneHead}>
            <ChevronLeft size={20} aria-hidden="true" />
            <span className={styles.phoneName}>{accountName}</span>
            <Search size={17} aria-hidden="true" />
            <Phone size={17} aria-hidden="true" />
            <Menu size={17} aria-hidden="true" />
          </div>
          <div className={styles.phoneForm}>
            {blocks.length === 0 ? <p className={styles.phoneEmpty}>このページにはまだブロックがありません</p> : null}
            {blocks.map((block, index) => (
              <PhoneBlockWithProgress key={block.id} block={block} showProgress={index === progressAt} progress={progress} bookingMenus={bookingMenus} />
            ))}
            {blocks.length === 0 ? progress : null}
            <span className={styles.phoneSpacer} />
            <span className={styles.phoneNext}>{nextLabel}</span>
          </div>
          <div className={styles.phoneMenu}>
            <span>メニュー</span>
            <ChevronDown size={12} aria-hidden="true" />
          </div>
          <div className={styles.phoneHome}><span aria-hidden="true" /></div>
        </div>
      </div>
    </section>
  )
}

function PhoneBlockWithProgress({ block, showProgress, progress, bookingMenus }: { block: FormBlock; showProgress: boolean; progress: ReactNode; bookingMenus: Props['bookingMenus'] }) {
  return (
    <>
      {showProgress ? progress : null}
      <PhoneBlock block={block} bookingMenus={bookingMenus} />
    </>
  )
}

function PhoneBlock({ block, bookingMenus }: { block: FormBlock; bookingMenus: Props['bookingMenus'] }) {
  switch (block.kind) {
    case 'image':
      return <PhoneImage url={block.mediaUrl} />
    case 'heading':
      return <p className={styles.phoneHeading} data-level={block.level ?? 2}>{block.text}</p>
    case 'text':
      return <p className={styles.phoneText}>{block.text}</p>
    case 'button':
      return <span className={styles.phoneButton}>{block.label}</span>
    default:
      return <PhoneQuestion block={block} bookingMenus={bookingMenus} />
  }
}

/** 読めない画像は壊れた印を出さず、地の色の箱にする。 */
function PhoneImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span className={styles.phoneImage} role="img" aria-label={url ? '画像（読み込めません）' : '画像（未設定）'} />
  return <img className={styles.phoneImage} src={url} alt="" onError={() => setFailed(true)} />
}

function PhoneQuestion({ block, bookingMenus }: { block: FormInputBlock; bookingMenus: Props['bookingMenus'] }) {
  if (block.hidden) return null
  const title = (
    <span className={styles.phoneQTitle}>
      {block.label || '（質問の文）'}
      {block.required ? <span className={styles.phoneRequired}>必須</span> : null}
    </span>
  )
  if (block.type === 'radio' || block.type === 'checkbox') {
    return (
      <div className={styles.phoneQ}>
        {title}
        {(block.choices ?? []).map((choice, i) => (
          <span key={choice.id} className={styles.phoneChoice} data-on={i === 0 || undefined} data-kind={block.type}>
            <span className={styles.phoneDot} aria-hidden="true" />
            {choice.label}
          </span>
        ))}
      </div>
    )
  }
  if (block.type === 'rating') {
    return (
      <div className={styles.phoneQ}>
        {title}
        <span className={styles.phoneStars} aria-label="5段階">
          {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={18} aria-hidden="true" data-on={i < 4 || undefined} />)}
        </span>
      </div>
    )
  }
  if (block.type === 'booking') {
    const menu = bookingMenus.find((m) => m.id === block.booking?.menuId)
    const days = Array.from({ length: 5 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i + 1)
      return d
    })
    const picked = days[2]
    return (
      <div className={styles.phoneQ} data-kind="booking">
        {title}
        <span className={styles.phoneMenuName}>{menu ? `${menu.name}・${menu.durationMinutes}分` : 'メニューを選んでください'}</span>
        <span className={styles.phoneDays}>
          {days.map((d, i) => (
            <span key={i} className={styles.phoneDay} data-on={i === 2 || undefined}>
              <span className={styles.phoneDayWeek}>{WEEKDAY[d.getDay()]}</span>
              <span className={styles.phoneDayNum}>{d.getDate()}</span>
            </span>
          ))}
        </span>
        <span className={styles.phoneTimes}>
          {SAMPLE_TIMES.map((t, i) => <span key={t} className={styles.phoneTime} data-on={i === 2 || undefined} data-off={i === 0 || i === 4 || undefined}>{t}</span>)}
        </span>
        <span className={styles.phonePicked}>{`${picked.getMonth() + 1}月${picked.getDate()}日（${WEEKDAY[picked.getDay()]}）13:00〜14:00 を選んでいます`}</span>
      </div>
    )
  }
  return (
    <div className={styles.phoneQ}>
      {title}
      <span className={styles.phoneInput} data-tall={block.type === 'textarea' || block.type === 'address' || undefined}>{block.placeholder ?? ''}</span>
    </div>
  )
}
