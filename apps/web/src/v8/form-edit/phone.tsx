'use client'

import { jstDateOffset } from '@/lib/jst-datetime'

/*
 * 「お客さまに見える形」のスマホ（m1cWEy・ijxur・XXFT4・tpRRT の右）。
 * 外枠 330×690・黒い島・LINE の上の帯・メニューの帯。中は回答画面の形。
 * 選んでいるページを出す。押せない見本（role="img" ではなく読める文で出す）。
 * 予約を入れる欄の日にち・時刻は形を見せるための見本で、実際の空きではない。
 */
import { useState, type ReactNode } from 'react'
import LiffPhoneFrame from '@/components/shared/liff-phone-frame'
import { PREFECTURES, normalizeRatingValue, FORM_OPTIONS_DEFAULT, type FormBlock, type FormInputBlock, type FormLayout } from '@line-crm/shared'
import { DateYmdField, AddressControls, BookingControls, FormChoiceRow, FormFileControl, FormSelectControl, FormTextControl, RatingStars } from '../../../../liff/src/components/forms/controls'
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
  const main = layout.options.theme?.main ?? null
  const nextLabel = last
    ? (options.submitLabel || '送信する')
    : `${options.nextLabel || '次へ'}（${pageIndex + 1} / ${sections.length}）`

  return (
    <LiffPhoneFrame title="回答フォーム" accountName={accountName} caption="お客さまに見える形" label="お客さまに見える形" accent={main}>
          <div className={styles.phoneForm}>
            {blocks.length === 0 ? <p className={styles.phoneEmpty}>このページにはまだブロックがありません</p> : null}
            {blocks.map((block, index) => (
              <PhoneBlockWithProgress key={block.id} block={block} showProgress={index === progressAt} progress={progress} bookingMenus={bookingMenus} />
            ))}
            {blocks.length === 0 ? progress : null}
            <span className={styles.phoneSpacer} />
            <span className={styles.phoneNext}>{nextLabel}</span>
          </div>
    </LiffPhoneFrame>
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
  const text = block.defaultValue ?? ''
  const selectedChoices = (block.choices ?? []).filter((c) => c.defaultSelected).map((c) => c.label)
  return <div className={styles.phoneQ}>
    <span className={styles.phoneQTitle}>{block.label || '（質問の文）'}{block.required ? <span className={styles.phoneRequired}>必須</span> : null}</span>
    {block.description ? <p className={styles.phoneText}>{block.description}</p> : null}
    {/* inert は見た目を薄くせず、選択・添付・送信とキーボード操作を止める。 */}
    <div inert>
      {(block.type === 'text' || block.type === 'textarea' || block.type === 'date') ? (
        block.type === 'date' && block.dateStyle === 'ymd' ? <DateYmdField value={text} placeholder={block.placeholder} readOnly onChange={() => {}} /> :
          <FormTextControl block={block} value={text} readOnly onChange={() => {}} />
      ) : null}
      {block.type === 'select' || block.type === 'prefecture' ? <FormSelectControl aria-label={block.label} value={text || selectedChoices[0] || (block.type === 'select' ? block.choices?.[0]?.label : '') || ''} onChange={() => {}}>
        <option value="">{block.type === 'prefecture' ? '都道府県を選択' : '選択してください'}</option>
        {(block.type === 'prefecture' ? PREFECTURES : (block.choices ?? []).map((c) => c.label)).map((label) => <option key={label} value={label}>{label}</option>)}
      </FormSelectControl> : null}
      {block.type === 'radio' || block.type === 'checkbox' ? <div className={styles.phoneChoices} data-inline={block.inline || undefined}>
        {(block.choices ?? []).map((choice) => {
          const selected = block.type === 'radio' && text ? text === choice.label : selectedChoices.includes(choice.label)
          return <FormChoiceRow key={choice.id} selected={selected}><input type={block.type} checked={selected} readOnly tabIndex={-1} />{choice.label}</FormChoiceRow>
        })}
      </div> : null}
      {block.type === 'rating' ? <RatingStars name={block.name} current={normalizeRatingValue(text)} onChange={() => {}} /> : null}
      {block.type === 'file' ? <FormFileControl label={block.label} kind={block.fileKind} kinds={block.fileKinds} bothSides={block.fileBothSides} maxCount={block.fileMaxCount} /> : null}
      {block.type === 'address' ? <AddressControls draft={{ postalCode: '', prefecture: '', city: '', addressLine1: '', addressLine2: '' }} placeholder={block.placeholder} onChange={() => {}} /> : null}
      {block.type === 'booking' ? <BookingPreview block={block} bookingMenus={bookingMenus} /> : null}
    </div>
  </div>
}

function BookingPreview({ block, bookingMenus }: { block: FormInputBlock; bookingMenus: Props['bookingMenus'] }) {
  const menu = bookingMenus.find((m) => m.id === block.booking?.menuId)
  const days = Array.from({ length: 5 }, (_, i) => {
    const date = jstDateOffset(i + 1)
    const d = new Date(`${date}T00:00:00Z`)
    return { date, weekday: WEEKDAY[d.getUTCDay()], day: d.getUTCDate(), open: true }
  })
  return <><p className={styles.phoneText}>空き枠の見本（実際の空きではありません）</p><BookingControls preview menuLabel={menu ? `${menu.name}・${menu.durationMinutes}分` : 'メニューを選んでください'} days={days} selectedDate={days[2].date} onDate={() => {}} times={SAMPLE_TIMES.map((start, i) => ({ start, open: i !== 0 && i !== 4, selected: false }))} onTime={() => {}} /></>
}
