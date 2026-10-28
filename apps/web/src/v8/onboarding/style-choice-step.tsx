'use client'

import type { AccountStyle } from '@line-crm/shared'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SegmentedControl from '@/components/shared/segmented'
import StatusBadge from '@/components/shared/status-badge'
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
}

export default function StyleChoiceStep({ viewing, onView, chosen, onChoose, disabled = false, variant = 'minimal' }: StyleChoiceStepProps) {
  const script = STYLE_EXPERIENCE_SCRIPT
  const viewed = script.styles[viewing]
  return (
    <div className={styles.root}>
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
      <section className={styles.can} aria-labelledby={STYLE_CHOICE_START_ID}>
        <h3 id={STYLE_CHOICE_START_ID} tabIndex={-1} className={styles.canTitle}>{`${viewed.label}でできること`}</h3>
        <ul className={styles.canList}>
          {viewed.can.map((item) => <li key={item.text} className={styles.canItem}><Check aria-hidden="true" className={styles.canIcon} />{item.text}</li>)}
        </ul>
      </section>
      <Card surface="muted" layout="block" contentPadding="var(--polish-space-card)" className={styles.frame} aria-label="見本">
        <StyleExperiencePlayer script={script} style={viewing} switcher="external" variant={variant} data="sample" />
      </Card>
      <div className={styles.choose}>
        {chosen === viewing
          ? <StatusBadge tone="success" dot>選んでいます</StatusBadge>
          : <Button id="style-choice-pick" onClick={() => onChoose(viewing)} disabled={disabled}>このスタイルにする</Button>}
      </div>
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
