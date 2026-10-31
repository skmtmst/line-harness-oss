'use client'

import type { AccountStyle } from '@line-crm/shared'
import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import IconButton from '@/components/shared/icon-button'
import StyleDemoPages from './style-demo-pages'
import StyleChooseAction from './style-choose-action'
import { STYLE_EXPERIENCE_SCRIPT, StyleExperiencePlayer } from './style-experience-player'
import styles from './style-choice-step.module.css'

/*
 * スタイルを選ぶ画面（SPEC-11・SPEC-12 の共通節 S）。はじめの質問の 1 問目と登録の画面の④が同じ物を読む。
 * 上の切り替えは「見る」スタイルを変えるだけで、選ぶのは［このスタイルにする］。保存は呼ぶ側の［次へ］だけ。
 * 見るのと選ぶのを分けるのは、見本を見ている途中に選んだつもりのないスタイルで保存しないため。
 */

/** 初回の焦点を上部へ置き、スタイルの切り替えを見える位置に保つ。 */
export const STYLE_CHOICE_START_ID = 'style-choice-can'

export const STYLE_CHOICE_ORDER: readonly AccountStyle[] = STYLE_EXPERIENCE_SCRIPT.order

/** 最初に見せるスタイル。保存済みならそれ、まだなら飲食店。 */
export function initialViewingStyle(saved: { style: AccountStyle; styleSelected: boolean }): AccountStyle {
  return saved.styleSelected ? saved.style : 'restaurant'
}

export type StyleChoiceStepProps = {
  viewing: AccountStyle
  onView: (style: AccountStyle) => void
  chosen: AccountStyle | null
  onChoose: (style: AccountStyle) => void
  disabled?: boolean
  variant?: 'minimal' | 'full'
  switcher?: 'inline' | 'external'
}

/** 窓の固定された帯でも、本文と同じ「見る」切り替えを使う。 */
export function StyleChoiceSwitcher({ viewing, onView, chosen, disabled = false }: Pick<StyleChoiceStepProps, 'viewing' | 'onView' | 'chosen' | 'disabled'>) {
  const script = STYLE_EXPERIENCE_SCRIPT
  return <div className={styles.switcher} data-style-switcher>
    <div className={styles.switcherSegments}>
      <SegmentedControl
        aria-label="見るスタイル"
        value={viewing}
        onChange={onView}
        disabled={disabled}
        options={STYLE_CHOICE_ORDER.map((style) => {
          const name = script.styles[style].label
          return chosen === style
            ? { value: style, label: <span className={styles.option}>{name}<Check aria-hidden="true" className={styles.optionCheck} /></span>, ariaLabel: `${name}（選んでいます）` }
            : { value: style, label: name }
        })}
      />
    </div>
    <div className={styles.switcherSelect}>
      <Select aria-label="見るスタイル" value={viewing} onChange={value => onView(value as AccountStyle)} size="full" disabled={disabled}
        options={STYLE_CHOICE_ORDER.map(style => ({ value: style, label: `${script.styles[style].label}${chosen === style ? '（選んでいます）' : ''}` }))} />
    </div>
  </div>
}

export default function StyleChoiceStep({ viewing, onView, chosen, onChoose, disabled = false, variant = 'minimal', switcher = 'inline' }: StyleChoiceStepProps) {
  const script = STYLE_EXPERIENCE_SCRIPT
  const viewed = script.styles[viewing]
  const [detail, setDetail] = useState(false)
  const [page, setPage] = useState(0)
  const [seenStyle, setSeenStyle] = useState(viewing)
  if (seenStyle !== viewing) { setSeenStyle(viewing); setPage(0) }
  const openRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const previousDetail = useRef(detail)
  useEffect(() => {
    if (previousDetail.current === detail) return
    previousDetail.current = detail
    if (detail) closeRef.current?.focus()
    else if (restoreFocus.current) {
      if (disabled) document.getElementById(STYLE_CHOICE_START_ID)?.focus()
      else openRef.current?.focus()
      restoreFocus.current = false
    }
  }, [detail, disabled])
  const close = () => { restoreFocus.current = true; setDetail(false) }
  useEffect(() => {
    if (!detail) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      const dialog = rootRef.current?.closest('[role=dialog]')
      const target = event.target instanceof Element ? event.target : document.activeElement
      if (dialog && target?.closest('[role=dialog]') !== dialog) return
      event.preventDefault()
      event.stopPropagation()
      restoreFocus.current = true
      setDetail(false)
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [detail])
  return (
    <div ref={rootRef} className={styles.root}>
      {switcher === 'inline' || detail ? <div className={styles.demoSwitcher}>
        {switcher === 'inline' ? <StyleChoiceSwitcher viewing={viewing} onView={onView} chosen={chosen} disabled={disabled} /> : null}
        {detail ? <IconButton ref={closeRef} aria-label="デモを閉じる" onClick={close}><X aria-hidden="true" /></IconButton> : null}
      </div> : null}
      {detail ? <StyleDemoPages viewing={viewing} page={page} onPage={setPage} chosen={chosen} onChoose={onChoose} disabled={disabled} /> : <>
      <section className={styles.can} aria-labelledby={STYLE_CHOICE_START_ID}>
        <h3 id={STYLE_CHOICE_START_ID} tabIndex={-1} className={styles.canTitle}>{`${viewed.label}でできること`}</h3>
        <ul className={styles.canList}>
          {viewed.can.map((item) => <li key={item.text} className={styles.canItem}><Check aria-hidden="true" className={styles.canIcon} />{item.text}</li>)}
        </ul>
      </section>
      <Card surface="muted" layout="block" contentPadding="var(--polish-space-card)" className={styles.frame} aria-label="見本">
        <StyleExperiencePlayer script={script} style={viewing} switcher="external" variant={variant} data="sample" />
      </Card>
      <div className={styles.choose}><StyleChooseAction viewing={viewing} chosen={chosen} onChoose={onChoose} disabled={disabled} /></div>
      <div className={styles.choose}><Button ref={openRef} onClick={() => { setPage(0); setDetail(true) }} disabled={disabled}>詳しく見る</Button></div>
      </>}
    </div>
  )
}

/** 下の帯の 1 行。見ているスタイルではなく、選んでいるスタイルを言う。 */
export function StyleChoiceStatus({ chosen }: { chosen: AccountStyle | null }) {
  return (
    <span className={styles.status} role="status">
      {chosen ? `選んでいるスタイル：${STYLE_EXPERIENCE_SCRIPT.styles[chosen].label}` : 'まだ選んでいません'}
    </span>
  )
}
