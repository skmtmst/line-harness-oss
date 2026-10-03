'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BatteryFull,
  ChevronDown,
  ChevronLeft,
  Menu,
  Phone,
  Search,
  Signal,
  Wifi,
} from 'lucide-react'
import Stepper, { type StepperStep } from '@/components/shared/stepper'
import StickyBar from '@/components/shared/sticky-bar'
import Button from '@/components/shared/button'
import styles from './wizard-v8.module.css'

/*
 * ★V8 リマインダの作る・確かめる・詳細で共用する部品。
 * 板：VE1u5 / YChR6 / p5YuP / T0nis / ltAaq / hjNpJ / rbAig / loVfW。
 * 「data-theme="v8"」の下だけで描く。v7 の reminder-v6-ui は触らない。
 */

/** V8 の作る手順。URL 段（stage）と手順番号の対応はここだけで持つ。 */
export const REMINDER_V8_STEPS = [
  { key: 'basics', label: '基本設定' },
  { key: 'target', label: '対象者と止める条件' },
  { key: 'messages', label: '通知の中身' },
  { key: 'schedule', label: '配信予定' },
  { key: 'confirm', label: '確認' },
] as const

export type ReminderV8StepKey = (typeof REMINDER_V8_STEPS)[number]['key']

/** stage（URL の ?stage=）→ 手順の key。 */
export function stepKeyForStage(stage: string | null): ReminderV8StepKey {
  switch (stage) {
    case 'target':
      return 'target'
    case 'preview':
      return 'schedule'
    case 'test':
    case 'confirm':
      return 'confirm'
    case 'basics':
      return 'basics'
    default:
      // 段なしの /reminders/edit?id=X は通知の中身（手順3）。
      return 'messages'
  }
}

/** 手順の key → 戻る先の URL。reminderId が無い（手順1）ときは null。 */
function stepHref(step: ReminderV8StepKey, reminderId: string | null): string | null {
  if (!reminderId) return null
  const id = encodeURIComponent(reminderId)
  switch (step) {
    case 'basics':
      return `/reminders/edit?id=${id}&stage=basics`
    case 'target':
      return `/reminders/edit?id=${id}&stage=target`
    case 'messages':
      return `/reminders/edit?id=${id}`
    case 'schedule':
      return `/reminders/edit?id=${id}&stage=preview`
    case 'confirm':
      return `/reminders/edit?id=${id}&stage=confirm`
  }
}

/**
 * 手順表示。済んだ段は押すとその手順へ戻れる。
 * 完了（hjNpJ）は current を外して全段 done にする。
 */
export function ReminderV8Stepper({
  current,
  reminderId,
}: {
  current: ReminderV8StepKey | 'done'
  reminderId: string | null
}) {
  const router = useRouter()
  const currentIndex = REMINDER_V8_STEPS.findIndex((step) => step.key === current)
  const steps: StepperStep[] = REMINDER_V8_STEPS.map((step, index) => {
    const done = current === 'done' || index < currentIndex
    const href = done ? stepHref(step.key, reminderId) : null
    return {
      key: step.key,
      label: step.label,
      state: done ? 'done' : index === currentIndex ? 'current' : 'todo',
      onSelect: href ? () => router.push(href) : undefined,
    }
  })
  return (
    <Stepper
      label="リマインダを作る手順"
      steps={steps}
      currentKey={current === 'done' ? undefined : current}
    />
  )
}

/** ページの頭：戻るリンク・題名・手順・下の一行。 */
export function WizardHeadV8({
  title,
  note,
  current,
  reminderId,
}: {
  title: string
  note?: string
  current: ReminderV8StepKey | 'done'
  reminderId: string | null
}) {
  return (
    <>
      <Link href="/reminders" className={styles.backLink}>
        <ChevronLeft size={14} aria-hidden="true" />
        リマインダへ
      </Link>
      <div className={styles.headText}>
        <h1 className={styles.headTitle}>{title}</h1>
        {note ? <p className={styles.headMeta}>{note}</p> : null}
      </div>
      <ReminderV8Stepper current={current} reminderId={reminderId} />
    </>
  )
}

/** 右欄の「設定内容」。名まえと値の行を並べる。 */
export function SummaryCardV8({
  title = '設定内容',
  rows,
}: {
  title?: string
  rows: Array<{ key: string; value: ReactNode; strong?: boolean; danger?: boolean }>
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <dl className={styles.kvRows}>
        {rows.map((row) => (
          <div key={row.key} className={styles.kvRow}>
            <dt className={styles.kvKey}>{row.key}</dt>
            <dd
              className={[
                styles.kvVal,
                row.strong ? styles.kvValStrong : null,
                row.danger ? styles.kvValDanger : null,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * 右欄のスマホ。LINE のトーク画面に近い形で届く見本を出す。
 * 枠・時計の帯・部屋名・下のメニューはここで持ち、吹き出しは本文だけ。
 */
export function PhoneMockV8({
  accountName,
  chip,
  message,
  empty,
}: {
  /** 部屋の名（LINE公式アカウントの表示名）。 */
  accountName: string
  /** 吹き出しの上の札。例「10/1（木）18:00」「通知は手順3で作ります」。 */
  chip?: string
  /** 届く本文。差し込みは見本値で置き換えてから渡す。 */
  message?: ReactNode
  /** 本文がまだ無いとき true。吹き出しを出さず札だけにする。 */
  empty?: boolean
}) {
  const initial = accountName.trim().charAt(0) || '然'
  return (
    <div className={styles.phone} aria-label="LINEでの見え方の見本">
      <div className={styles.phoneScreen}>
        <div className={styles.phoneStatus}>
          <span>9:41</span>
          <span className={styles.phoneIsland} aria-hidden="true" />
          <span className={styles.phoneStatusIcons} aria-hidden="true">
            <Signal size={13} />
            <Wifi size={13} />
            <BatteryFull size={15} />
          </span>
        </div>
        <div className={styles.phoneHeader}>
          <ChevronLeft size={18} aria-hidden="true" />
          <span className={styles.phoneName}>{accountName}</span>
          <span className={styles.phoneHeaderIcons} aria-hidden="true">
            <Search size={15} />
            <Phone size={15} />
            <Menu size={15} />
          </span>
        </div>
        <div className={styles.phoneBody}>
          {chip ? <span className={styles.phoneChip}>{chip}</span> : null}
          {empty ? null : (
            <>
              <div className={styles.phoneSender}>
                <span className={styles.phoneAvatar} aria-hidden="true">
                  {initial}
                </span>
                <span className={styles.phoneSenderName}>{accountName}</span>
              </div>
              <div className={styles.phoneBubble}>{message ?? '本文はまだありません'}</div>
            </>
          )}
        </div>
        <div className={styles.phoneFooter}>
          <span>
            メニュー{' '}
            <ChevronDown size={10} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden="true" />
          </span>
          <span className={styles.phoneHome} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

/** 「LINEでの見え方」見出し＋スマホ。右欄に置く。 */
export function PhoneAsideV8(props: Parameters<typeof PhoneMockV8>[0]) {
  return (
    <>
      <h2 className={styles.sideLabel}>LINEでの見え方</h2>
      <PhoneMockV8 {...props} />
    </>
  )
}

/**
 * 選ぶカード（板の形：アイコン左上・丸右上・名まえ・補足）。
 * 共通 RadioCard は丸が左でアイコンの口が無いので、機能内で本物の
 * input[type=radio] を持つ同じ意味の形を作る。
 */
export function ChoiceCardV8({
  name,
  value,
  checked,
  onChange,
  title,
  note,
  icon,
  disabled = false,
}: {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  title: string
  note?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={[styles.choice, checked ? styles.choiceChecked : null].filter(Boolean).join(' ')}>
      <span className={styles.choiceTop}>
        <span className={styles.choiceIcon} aria-hidden="true">
          {icon}
        </span>
        <input
          type="radio"
          className={styles.choiceRadio}
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
        />
      </span>
      <span className={styles.choiceTitle}>{title}</span>
      {note ? <span className={styles.choiceNote}>{note}</span> : null}
    </label>
  )
}

/** 下の操作帯。中央に「キャンセル → 下書き → 次へ・有効にする」。 */
export function WizardFooterV8({
  onCancel,
  cancelDisabled = false,
  draftLabel = '下書きを保存',
  onDraft,
  draftBusy = false,
  nextLabel,
  nextIcon,
  onNext,
  nextDisabled = false,
  nextBusy = false,
}: {
  onCancel: () => void
  cancelDisabled?: boolean
  /** 真ん中のボタン。「下書きを保存」か「下書きのまま保存」。 */
  draftLabel?: string
  onDraft?: () => void
  draftBusy?: boolean
  nextLabel: string
  /** 主ボタンの左の印。例：→・⏻。 */
  nextIcon?: ReactNode
  onNext: () => void
  nextDisabled?: boolean
  nextBusy?: boolean
}) {
  return (
    <StickyBar
      actions={
        <>
          <Button type="button" onClick={onCancel} disabled={cancelDisabled}>
            キャンセル
          </Button>
          {onDraft ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onDraft}
              disabled={draftBusy}
              busy={draftBusy}
              busyLabel="保存中…"
            >
              {draftLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            onClick={onNext}
            disabled={nextDisabled || nextBusy}
            busy={nextBusy}
            busyLabel="処理中…"
          >
            {nextIcon}
            {nextLabel}
          </Button>
        </>
      }
    />
  )
}
